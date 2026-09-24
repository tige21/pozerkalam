#!/usr/bin/env node
/* Гейт service worker'а без браузера: sw.js исполняется в песочнице vm с фейковыми caches/fetch,
   обработчики install/activate/fetch дёргаются напрямую. Гоняется дважды — исходный sw.js и
   вариант /play/, полученный теми же строковыми заменами, что делает deploy-pozerkalam.sh
   (пары читаются из самого скрипта: правка sw.js, ломающая якорь деплоя, падает здесь, а не
   на сервере).
     node tools/sw-check.mjs
   Вывод: строка на проверку (ok/ПРОВАЛ) и итоговый JSON; код 1, если хоть одна провалена. */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8').replaceAll('__BUILD__', 'test');
const deploy = fs.readFileSync(path.join(ROOT, 'deploy-pozerkalam.sh'), 'utf8');

const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); console.log((ok ? '  ok   ' : 'ПРОВАЛ ') + name + (detail ? ' — ' + detail : '')); };

/* якоря замен из блока `for a, b in [("…", "…"), …]` деплой-скрипта */
/* в деплое два таких блока — для index.html и для sw.js; нужен тот, что после open('sw.js') */
const tail = deploy.slice(deploy.indexOf("open('sw.js')"));
const block = (tail.match(/for a, b in \[([\s\S]*?)\]:/) || [])[1] || '';
const pairs = [...block.matchAll(/\((["'])(.*?)\1,\s*(["'])(.*?)\3\)/g)].map((m) => [m[2], m[4]]);
const missing = pairs.filter(([a]) => !src.includes(a)).map(([a]) => a);
check('все якоря замен из deploy-pozerkalam.sh есть в sw.js (@dist-sw-deploy-anchors)',
  pairs.length > 0 && missing.length === 0, 'пар ' + pairs.length + (missing.length ? ', нет: ' + missing.join(' | ') : ''));

function makeWorld(code, origin) {
  const handlers = {};
  const store = new Map();
  const routes = new Map();
  const log = [];
  const keyOf = (r) => typeof r === 'string' ? r : new URL(r.url).pathname;
  const fetchImpl = async (r) => {
    const p = keyOf(r); log.push(p);
    const rt = routes.get(p) || { status: 404, body: 'missing ' + p };
    return new Response(rt.body, { status: rt.status });
  };
  class FakeCache {
    constructor() { this.m = new Map(); }
    async put(r, res) { this.m.set(keyOf(r), res); }
    async add(u) { const r = await fetchImpl(new Request(origin + u)); if (!r.ok) throw new TypeError('add ' + u + ' → ' + r.status); this.m.set(u, r); }
    async addAll(us) { for (const u of us) await this.add(u); }
    async match(r) { return this.m.get(keyOf(r)); }
  }
  const caches = {
    open: async (n) => { if (!store.has(n)) store.set(n, new FakeCache()); return store.get(n); },
    keys: async () => [...store.keys()],
    delete: async (k) => store.delete(k),
    match: async (r) => { for (const c of store.values()) { const hit = await c.match(r); if (hit) return hit; } return undefined; },
  };
  const self = { addEventListener: (t, fn) => { handlers[t] = fn; }, skipWaiting: async () => { log.push('skipWaiting'); }, clients: { claim: async () => { log.push('claim'); } } };
  const sandbox = { self, caches, fetch: fetchImpl, location: { origin }, URL, Request, Response, Promise, console };
  vm.runInNewContext(code, sandbox);
  /* обработчик может бросить или отвергнуть промис — это провал проверки, не краш гейта */
  const fire = async (type, ev) => { try { handlers[type](ev); if (ev.w) await ev.w; return ev.p ? await ev.p : undefined; } catch (e) { log.push('throw:' + type + ':' + e.message); return undefined; } };
  /* Request из Node не принимает mode 'navigate' — SW читает только url/method/mode, хватает объекта */
  const evt = (p, mode) => ({ request: { url: origin + p, method: 'GET', mode }, respondWith(x) { this.p = x; }, waitUntil(x) { this.w = x; } });
  return { routes, store, log, fire, evt, cacheOf: (n) => store.get(n) };
}

async function suite(label, code, PAGE) {
  const origin = 'https://pozerkalam.space';
  const w = makeWorld(code, origin);
  const CACHE = 'pz-test';
  const ico1 = PAGE + 'icon-192.png', ico2 = PAGE + 'icon-512.png', man = PAGE + 'manifest.webmanifest';
  w.routes.set(PAGE, { status: 200, body: 'v1' }); w.routes.set(man, { status: 200, body: '{}' });
  w.routes.set(ico2, { status: 200, body: 'png' });   /* icon-192 нарочно отсутствует → 404 */

  await w.fire('install', w.evt(PAGE, 'navigate'));
  /* на sw.js без PAGE/allSettled кэша может не быть вовсе — проверки тогда падают, а не крашат гейт */
  const c = w.cacheOf(CACHE) || { m: new Map(), match: async () => undefined };
  const has = async (k) => !!(await c.match(k));
  const cachedText = async () => { const h = await c.match(PAGE); return h ? await h.clone().text() : 'нет'; };
  check(`${label}: install переживает 404 одной иконки, остальные CORE в кэше, skipWaiting вызван (@dist-sw-install-tolerates-404)`,
    w.cacheOf(CACHE) && await has(PAGE) && await has(man) && await has(ico2) && !(await has(ico1)) && w.log.includes('skipWaiting'),
    'кэш: ' + (c ? [...c.m.keys()].join(',') : 'нет'));

  w.routes.set(PAGE, { status: 200, body: 'v2' });
  const r2 = await w.fire('fetch', w.evt(PAGE, 'navigate'));
  await new Promise((r) => setImmediate(r));
  const cached2 = await cachedText();
  check(`${label}: страница 200 отдаётся и ложится в кэш под PAGE (@dist-sw-page-ok-cached)`,
    r2 && r2.status === 200 && await r2.clone().text() === 'v2' && cached2 === 'v2', 'ответ ' + (r2 && r2.status) + ', кэш ' + cached2);

  w.routes.set(PAGE, { status: 502, body: 'bad gateway' });
  const r3 = await w.fire('fetch', w.evt(PAGE, 'navigate'));
  await new Promise((r) => setImmediate(r));
  const cached3 = await cachedText();
  check(`${label}: страница 502 не кэшируется, игроку уходит кэшированная копия (@dist-sw-page-not-ok-not-cached)`,
    r3 && r3.status === 200 && await r3.clone().text() === 'v2' && cached3 === 'v2', 'ответ ' + (r3 && r3.status) + ', кэш ' + cached3);

  const w2 = makeWorld(code, origin);
  w2.routes.set(PAGE, { status: 502, body: 'bad gateway' });
  const r3b = await w2.fire('fetch', w2.evt(PAGE, 'navigate'));
  check(`${label}: страница 502 без кэша отдаётся честно (@dist-sw-page-not-ok-not-cached)`,
    r3b && r3b.status === 502, 'ответ ' + (r3b && r3b.status));

  w.routes.set(PAGE + 'nope.png', { status: 404, body: 'no' });
  const r4 = await w.fire('fetch', w.evt(PAGE + 'nope.png', 'no-cors'));
  await new Promise((r) => setImmediate(r));
  const r5 = await w.fire('fetch', w.evt(ico2, 'no-cors'));
  const fetches = w.log.filter((x) => x === ico2).length;
  check(`${label}: ресурс 404 не кэшируется, ресурс 200 отдаётся из кэша без сети (@dist-sw-asset-not-ok-not-cached)`,
    r4 && r4.status === 404 && !(await c.match(PAGE + 'nope.png')) && r5 && r5.status === 200 && fetches === 1,
    'nope ' + (r4 && r4.status) + ', в кэше ' + !!(await c.match(PAGE + 'nope.png')) + ', сеть за icon-512: ' + fetches);
}

await suite('sw.js', src, '/');
let play = src;
for (const [a, b] of pairs) play = play.split(a).join(b);
await suite('/play/', play, '/play/');

const failed = results.filter((r) => !r.ok);
console.log(JSON.stringify({ total: results.length, failed: failed.length, names: failed.map((f) => f.name) }));
process.exit(failed.length ? 1 : 0);
