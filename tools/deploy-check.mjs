#!/usr/bin/env node
/* Гейт порядка выкатки: страница и её CSP обязаны меняться так, чтобы браузер ни в какой момент
   не получил новую страницу под старым заголовком. 03.10.2026 вход через VK вернулся посреди чужой
   выкатки: зеркало уже отдавало новый index.html, а nginx ещё держал прошлый CSP — скрипт игры молча
   не запустился, обмена входа не было. Гейт читает deploy-pozerkalam.sh и проверяет порядок шагов,
   а tools/csp-hashes.py — по хэшу, посчитанному в Node так же, как его считает браузер.
     node tools/deploy-check.mjs
     DEPLOY_SCRIPT=<путь> node tools/deploy-check.mjs   # проверить другую версию скрипта
   Вывод: строка на проверку (ok/ПРОВАЛ) и итоговый JSON; код 1, если хоть одна провалена. */
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = process.env.DEPLOY_SCRIPT || path.join(ROOT, 'deploy-pozerkalam.sh');
const lines = fs.readFileSync(SCRIPT, 'utf8').split('\n');

const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); console.log((ok ? '  ok   ' : 'ПРОВАЛ ') + name + (detail ? ' — ' + detail : '')); };
/* номер первой строки (с 1), где есть подстрока, начиная с from; -1 — нет; комментарии не в счёт */
const at = (needle, from = 0) => {
  for (let i = from; i < lines.length; i++) if (!lines[i].trim().startsWith('#') && lines[i].includes(needle)) return i + 1;
  return -1;
};
const order = (...xs) => xs.every(x => x > 0) && xs.every((x, i) => i === 0 || xs[i - 1] < x);

/* прод: заголовок на бокс → reload → дождались нового CSP → только потом файлы игры */
const mirrorStart = at('==> зарубежное зеркало');
const pHeaders = at('pozerkalam-headers.conf "$HOST:/etc/nginx/snippets/pozerkalam-headers.conf"');
const pReload = at('systemctl reload nginx');
const pWait = at('csp_header_wait "$PROD_IP"');
const pFiles = at('scpr build/play/index.html');
check('прод: новый CSP применён и отдаётся раньше, чем льются файлы игры (@dist-csp-before-files)',
  order(pHeaders, pReload, pWait, pFiles) && pFiles < mirrorStart,
  JSON.stringify({ заголовок: pHeaders, reload: pReload, ожидание: pWait, файлы: pFiles }));

/* зеркало: тот же порядок, rsync — последним */
const mHeaders = at('pz-headers.conf /etc/nginx/snippets/pozerkalam-headers.conf', mirrorStart);
const mReload = at('sudo systemctl reload nginx', mirrorStart);
const mWait = at('csp_header_wait "$MIRROR_IP"', mirrorStart);
const mFiles = at('mirror_rsync "заливка на зеркало"', mirrorStart);
check('зеркало: конфиг, reload и новый CSP раньше rsync страниц (@dist-csp-before-files)',
  order(mHeaders, mReload, mWait, mFiles), JSON.stringify({ заголовок: mHeaders, reload: mReload, ожидание: mWait, rsync: mFiles }));

/* заголовок пускает и живые страницы, и новые: на время замены файлов годны обе версии */
const unionProd = at('csp_union $CSP_HASHES $LIVE_PROD');
const unionMirror = at('csp_union $CSP_PROD $LIVE_MIRROR', mirrorStart);
const writes = at('write_headers build/pozerkalam-headers.conf "$CSP_PROD"');
check('CSP — объединение хэшей живых и новых страниц на обоих боксах (@dist-csp-union)',
  unionProd > 0 && writes > unionProd && unionMirror > mirrorStart, JSON.stringify({ прод: unionProd, запись: writes, зеркало: unionMirror }));

/* scp пишет на месте — страница игры уходит в .next и встаёт на место переименованием */
const nextUp = at('"$HOST:$DOCROOT/play/.next/"');
const mv = at('mv -f .next/*');
check('страница игры на проде заменяется атомарно: .next и mv, не scp поверх (@dist-game-upload-atomic)',
  nextUp > 0 && mv > nextUp && at('"$HOST:$DOCROOT/play/"') < 0, JSON.stringify({ '.next': nextUp, mv }));

/* хэш скрипта считается так же, как браузер: sha256 тела между тегами, base64 */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pz-csp-'));
const body = 'window.A = "ё";\n';
fs.writeFileSync(path.join(tmp, 'a.html'), `<script>${body}</script><script src="/x.js"></script>`
  + '<script type="application/ld+json">{"a":1}</script>');
fs.writeFileSync(path.join(tmp, 'b.html'), `<script>${body}</script><script>b()</script>`);
const got = execFileSync('python3', [path.join(ROOT, 'tools', 'csp-hashes.py'), path.join(tmp, 'a.html'),
  path.join(tmp, 'b.html'), path.join(tmp, 'нет.html')], { encoding: 'utf8' }).trim().split(/\s+/);
const want = [body, 'b()'].map(s => "'sha256-" + crypto.createHash('sha256').update(s, 'utf8').digest('base64') + "'");
/* фото профиля: браузер грузит его по ссылке, которую пропустил сервис (AVATAR_HOSTS / AVATAR_EXACT в account.py)
   и игра (AV_RE в index.html). Хост, которого нет в img-src, CSP молча режет — в кружке осталась бы буква */
{
  const acc = fs.readFileSync(path.join(ROOT, 'server', 'account.py'), 'utf8');
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const tuple = (name) => ((acc.match(new RegExp('^' + name + " = \\(([^)]*)\\)", 'm')) || [])[1] || '').match(/'([^']+)'/g) || [];
  const hosts = [...tuple('AVATAR_HOSTS').map(h => '*' + h.slice(1, -1)), ...tuple('AVATAR_EXACT').map(h => h.slice(1, -1))];
  const csp = (lines.find(l => l.includes('Content-Security-Policy') && l.includes('img-src')) || '').match(/img-src ([^;]*);/);
  const img = csp ? csp[1].split(/\s+/) : [];
  const avRe = (html.match(/const AV_RE=(\/.*\/i);/) || [])[1] || '';
  const re = avRe ? new Function('return ' + avRe)() : null;
  const sample = (h) => 'https://' + h.replace('*', 'sun9-1') + '/a.jpg';
  const miss = hosts.filter(h => !img.includes('https://' + h));
  /* и обратно: лишний хост в img-src — дыра, которую не просил ни сервис, ни игра (Метрика — своя статья) */
  const extra = img.filter(x => /^https:/.test(x) && x !== 'https://mc.yandex.ru' && !hosts.includes(x.slice(8)));
  const reMiss = hosts.filter(h => !(re && re.test(sample(h))));
  check('хосты фото профиля одни и те же в сервисе, в игре и в img-src CSP (@dist-csp-avatar-hosts)',
    hosts.length >= 3 && miss.length === 0 && reMiss.length === 0 && extra.length === 0,
    JSON.stringify({ hosts, нет_в_csp: miss, нет_в_игре: reMiss, лишние_в_csp: extra }));
}

check('tools/csp-hashes.py считает хэши как браузер: без src и JSON-LD, без повторов, пропуская отсутствующие файлы (@dist-csp-hashes)',
  JSON.stringify(got) === JSON.stringify(want), JSON.stringify({ got, want }));
fs.rmSync(tmp, { recursive: true, force: true });

const failed = results.filter(r => !r.ok);
console.log(JSON.stringify({ total: results.length, failed: failed.length, names: failed.map(f => f.name) }));
process.exit(failed.length ? 1 : 0);
