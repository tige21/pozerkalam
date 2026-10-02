#!/usr/bin/env python3
"""Сервис аккаунтов «По зеркалам»: вход через VK ID и Яндекс ID, сессии, синк прогресса, покупки.

Живёт на 127.0.0.1, наружу его выставляет nginx (location /api/v1/ → /). Флоу входа один для
всех поверхностей (веб, PWA, iframe VK и Telegram) и повторяет серверный флоу spark для Mini App
(api/internal/service/auth/oauth_flow_service.go): sid и state чеканит сервер, PKCE-verifier и
секрет Яндекса не покидают сервис, токены выдаются в момент claim и в БД не лежат. Отличие от
spark: claim требует nonce вкладки, начавшей вход, — sid виден в адресе возврата /play/#auth=<sid>.

Запуск: python3 account.py [serve]; обслуживание: grant | revoke | list | stats (см. --help).
"""

import argparse
import base64
import binascii
import hashlib
import hmac
import json
import logging
import os
import re
import secrets
import sqlite3
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from collections import defaultdict, deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

log = logging.getLogger('account')

MAX_BODY = 128 * 1024
MAX_PROGRESS = 64 * 1024
MAX_LEVELS = 200
NONCE_RE = re.compile(r'^[A-Za-z0-9_-]{32,128}$')
PROVIDERS = ('vk', 'yandex')
MODES = ('redirect', 'poll')
# Повтор старого refresh в течение этой минуты — гонка двух вкладок, которые обновляют сессию
# одновременно, а не кража: семью не отзываем, клиент перечитывает свежий refresh из хранилища.
REUSE_GRACE = 60


class Config:
    def __init__(self, env=None):
        e = os.environ if env is None else env
        state_dir = e.get('STATE_DIRECTORY', '').split(':')[0] or '.'
        self.port = int(e.get('ACCT_PORT', '8788'))
        self.db = e.get('ACCT_DB') or os.path.join(state_dir, 'account.db')
        self.jwt_secret = e.get('JWT_SECRET', '').encode()
        self.vk_id = e.get('VK_CLIENT_ID', '').strip()
        self.ya_id = e.get('YANDEX_CLIENT_ID', '').strip()
        self.ya_secret = e.get('YANDEX_CLIENT_SECRET', '').strip()
        self.callback = e.get('OAUTH_CALLBACK_URL', 'https://pozerkalam.space/api/v1/auth/callback')
        self.play_url = e.get('PLAY_URL', 'https://pozerkalam.space/play/')
        self.vk_base = e.get('VK_BASE', 'https://id.vk.ru').rstrip('/')
        self.ya_oauth = e.get('YA_OAUTH_BASE', 'https://oauth.yandex.ru').rstrip('/')
        self.ya_login = e.get('YA_LOGIN_BASE', 'https://login.yandex.ru').rstrip('/')
        self.access_ttl = int(e.get('ACCESS_TTL', '3600'))
        self.refresh_ttl = int(e.get('REFRESH_TTL', str(90 * 86400)))
        self.pending_ttl = int(e.get('PENDING_TTL', '600'))
        self.http_timeout = float(e.get('PROVIDER_TIMEOUT', '10'))
        self.trust_xff = e.get('TRUST_X_REAL_IP', '1') == '1'

    @property
    def vk_on(self):
        return bool(self.vk_id)

    @property
    def ya_on(self):
        return bool(self.ya_id and self.ya_secret)

    def enabled(self, provider):
        return self.vk_on if provider == 'vk' else self.ya_on if provider == 'yandex' else False


def now():
    return int(time.time())


def b64u(raw):
    return base64.urlsafe_b64encode(raw).rstrip(b'=').decode()


def b64u_dec(s):
    return base64.urlsafe_b64decode(s + '=' * (-len(s) % 4))


def sha256_hex(s):
    return hashlib.sha256(s.encode()).hexdigest()


def mask(s):
    """sid, id аккаунта и прочие идентификаторы в журнал — только первые 6 знаков."""
    s = str(s or '')
    return s[:6] + '…' if len(s) > 6 else s


def jwt_encode(cfg, sub):
    t = now()
    head = b64u(json.dumps({'alg': 'HS256', 'typ': 'JWT'}, separators=(',', ':')).encode())
    body = b64u(json.dumps({'sub': sub, 'iat': t, 'exp': t + cfg.access_ttl, 'v': 1},
                           separators=(',', ':')).encode())
    sig = hmac.new(cfg.jwt_secret, (head + '.' + body).encode(), hashlib.sha256).digest()
    return head + '.' + body + '.' + b64u(sig)


def jwt_decode(cfg, token):
    try:
        head, body, sig = token.split('.')
        if json.loads(b64u_dec(head)).get('alg') != 'HS256':
            return None
        want = hmac.new(cfg.jwt_secret, (head + '.' + body).encode(), hashlib.sha256).digest()
        if not hmac.compare_digest(want, b64u_dec(sig)):
            return None
        claims = json.loads(b64u_dec(body))
        if claims.get('v') != 1 or int(claims.get('exp', 0)) <= now():
            return None
        return claims
    except (ValueError, TypeError, json.JSONDecodeError, binascii.Error):
        return None


def _num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and v == v and abs(v) != float('inf')


def merge_value(key, a, b):
    """Правило слияния одного поля прогресса двух устройств.

    Идемпотентно (merge(a, merge(a, b)) == merge(a, b)) и коммутативно для чисел, поэтому
    повторный PUT того же устройства ничего не меняет. Числа с именем best* — рекорды, берётся
    min; остальные числа — счётчики, берётся max. Сумма точнее (3 прохождения на телефоне и 2 на
    ПК дали бы 5, а не 3), но не идемпотентна без счётчиков по устройствам, а готовность к
    экзамену читает только clean>0 и bestErr — ей хватает max.
    """
    if a is None:
        return clean_value(key, b)
    if b is None:
        return clean_value(key, a)
    if isinstance(a, dict) and isinstance(b, dict):
        return merge_dict(a, b)
    if isinstance(a, list) and isinstance(b, list):
        n = max(len(a), len(b))
        return [merge_value(key, a[i] if i < len(a) else None, b[i] if i < len(b) else None)
                for i in range(n)]
    if _num(a) and _num(b):
        return min(a, b) if key.startswith('best') else max(a, b)
    for v in (b, a):
        if isinstance(v, dict) or _num(v):
            return clean_value(key, v)
    return clean_value(key, b)


def clean_value(key, v):
    if isinstance(v, dict):
        return merge_dict(v, {})
    if isinstance(v, list):
        return [clean_value(key, x) for x in v[:16]]
    if _num(v) or isinstance(v, (str, bool)) or v is None:
        return v[:120] if isinstance(v, str) else v
    return None


def merge_dict(a, b):
    out = {}
    for k in list(a.keys()) + [k for k in b.keys() if k not in a]:
        if not isinstance(k, str) or len(k) > 120:
            continue
        out[k] = merge_value(k, a.get(k), b.get(k))
    return out


def merge(stored, incoming):
    """Прогресс целиком: {имя уровня: запись}. Не-объектные записи отбрасываются — так же их
    чистит progAll() в игре, иначе мусор одного устройства разносился бы на все."""
    def records(x):
        if not isinstance(x, dict):
            return {}
        return {k: v for k, v in x.items() if isinstance(k, str) and isinstance(v, dict)}
    return merge_dict(records(stored), records(incoming))


def progress_ok(data):
    if not isinstance(data, dict) or len(data) > MAX_LEVELS:
        return False

    def depth(v, d=0):
        if d > 4:
            return False
        if isinstance(v, dict):
            return all(depth(x, d + 1) for x in v.values())
        if isinstance(v, list):
            return len(v) <= 16 and all(depth(x, d + 1) for x in v)
        return True
    return depth(data) and len(json.dumps(data, ensure_ascii=False).encode()) <= MAX_PROGRESS


MIGRATIONS = [
    """
    CREATE TABLE accounts(id TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL);
    CREATE TABLE identities(provider TEXT NOT NULL, provider_user_id TEXT NOT NULL,
        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL, PRIMARY KEY(provider, provider_user_id));
    CREATE INDEX identities_account ON identities(account_id);
    CREATE TABLE sessions(id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        family TEXT NOT NULL, refresh_hash TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL, rotated_at INTEGER, revoked_at INTEGER);
    CREATE INDEX sessions_family ON sessions(family);
    CREATE TABLE oauth_pending(sid TEXT PRIMARY KEY, state TEXT NOT NULL UNIQUE,
        provider TEXT NOT NULL, mode TEXT NOT NULL, verifier TEXT, nonce_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
        account_id TEXT, is_new INTEGER NOT NULL DEFAULT 0, error TEXT);
    CREATE TABLE progress(account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
        data TEXT NOT NULL, rev INTEGER NOT NULL, updated_at INTEGER NOT NULL);
    -- без внешнего ключа: оплаченная покупка переживает удаление аккаунта обезличенной,
    -- запись о платеже нужна для учёта и возвратов
    CREATE TABLE entitlements(account_id TEXT NOT NULL, product TEXT NOT NULL,
        source TEXT NOT NULL, ref TEXT NOT NULL DEFAULT '', granted_at INTEGER NOT NULL,
        expires_at INTEGER, revoked_at INTEGER, PRIMARY KEY(account_id, product, ref));
    """,
]


class Store:
    def __init__(self, path):
        self.path = path
        self._local = threading.local()
        d = os.path.dirname(os.path.abspath(path))
        os.makedirs(d, exist_ok=True)
        self.migrate()

    def conn(self):
        c = getattr(self._local, 'c', None)
        if c is None:
            c = sqlite3.connect(self.path, timeout=10, isolation_level=None)
            c.row_factory = sqlite3.Row
            c.execute('PRAGMA journal_mode=WAL')
            c.execute('PRAGMA foreign_keys=ON')
            c.execute('PRAGMA busy_timeout=10000')
            self._local.c = c
        return c

    def release(self):
        """ThreadingHTTPServer заводит поток на запрос: соединение потока закрывается в конце
        запроса, а не копится до сборщика мусора."""
        c = getattr(self._local, 'c', None)
        if c is not None:
            self._local.c = None
            c.close()

    def migrate(self):
        c = self.conn()
        c.execute('CREATE TABLE IF NOT EXISTS schema_version(v INTEGER NOT NULL)')
        row = c.execute('SELECT v FROM schema_version').fetchone()
        v = row['v'] if row else 0
        for i in range(v, len(MIGRATIONS)):
            c.execute('BEGIN IMMEDIATE')
            try:
                sql = '\n'.join(ln for ln in MIGRATIONS[i].splitlines() if not ln.strip().startswith('--'))
                for stmt in sql.split(';'):
                    if stmt.strip():
                        c.execute(stmt)
                c.execute('DELETE FROM schema_version')
                c.execute('INSERT INTO schema_version(v) VALUES (?)', (i + 1,))
                c.execute('COMMIT')
            except Exception:
                c.execute('ROLLBACK')
                raise
            log.info('db: миграция %d применена', i + 1)

    def tx(self):
        return Tx(self.conn())


class Tx:
    """BEGIN IMMEDIATE берёт блокировку записи сразу: claim и refresh читают строку и тут же её
    меняют, и два параллельных запроса не должны оба увидеть «ещё не использовано»."""

    def __init__(self, c):
        self.c = c

    def __enter__(self):
        self.c.execute('BEGIN IMMEDIATE')
        return self.c

    def __exit__(self, et, ev, tb):
        self.c.execute('ROLLBACK' if et else 'COMMIT')
        return False


class ProviderError(Exception):
    def __init__(self, op, status, code=''):
        super().__init__('%s: http %s %s' % (op, status, code))
        self.op, self.status, self.code = op, status, code


# Своя цепочка без прокси: соседний приёмник отзывов ходит в Telegram через HTTPS_PROXY, а VK и
# Яндекс с РФ-бокса доступны напрямую — унаследованный прокси только добавил бы точку отказа.
_opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def http_call(op, url, cfg, form=None, headers=None):
    data = urllib.parse.urlencode(form).encode() if form is not None else None
    h = {'Accept': 'application/json'}
    if data is not None:
        h['Content-Type'] = 'application/x-www-form-urlencoded'
    h.update(headers or {})
    req = urllib.request.Request(url, data=data, headers=h, method='POST' if data is not None else 'GET')
    t0 = time.time()
    try:
        with _opener.open(req, timeout=cfg.http_timeout) as r:
            body = r.read(256 * 1024)
            log.debug('%s: http %s за %d мс, %d байт', op, r.status, (time.time() - t0) * 1000, len(body))
            return json.loads(body.decode() or '{}')
    except urllib.error.HTTPError as e:
        code = ''
        try:
            code = str(json.loads(e.read(8192).decode()).get('error', ''))[:60]
        except Exception:
            pass
        raise ProviderError(op, e.code, code)
    except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError) as e:
        raise ProviderError(op, 'net', type(e).__name__)


def vk_authorize_url(cfg, state, challenge):
    q = {'response_type': 'code', 'client_id': cfg.vk_id, 'redirect_uri': cfg.callback,
         'state': state, 'code_challenge': challenge, 'code_challenge_method': 'S256'}
    return cfg.vk_base + '/authorize?' + urllib.parse.urlencode(q)


def ya_authorize_url(cfg, state):
    q = {'response_type': 'code', 'client_id': cfg.ya_id, 'redirect_uri': cfg.callback,
         'state': state, 'scope': 'login:info', 'force_confirm': 'no'}
    return cfg.ya_oauth + '/authorize?' + urllib.parse.urlencode(q)


def vk_profile(cfg, code, device_id, verifier, state):
    tok = http_call('vk.exchange', cfg.vk_base + '/oauth2/auth', cfg, form={
        'grant_type': 'authorization_code', 'code': code, 'code_verifier': verifier,
        'device_id': device_id, 'client_id': cfg.vk_id, 'redirect_uri': cfg.callback, 'state': state})
    access = tok.get('access_token')
    if not access:
        raise ProviderError('vk.exchange', 200, 'no_token')
    info = http_call('vk.user_info', cfg.vk_base + '/oauth2/user_info', cfg,
                     form={'access_token': access, 'client_id': cfg.vk_id})
    u = info.get('user') or {}
    uid = str(u.get('user_id') or tok.get('user_id') or '').strip()
    if not uid:
        raise ProviderError('vk.user_info', 200, 'no_user_id')
    first, last = str(u.get('first_name') or '').strip(), str(u.get('last_name') or '').strip()
    return uid, (first + (' ' + last[:1] + '.' if last else '')).strip()


def ya_profile(cfg, code):
    tok = http_call('yandex.exchange', cfg.ya_oauth + '/token', cfg, form={
        'grant_type': 'authorization_code', 'code': code, 'client_id': cfg.ya_id,
        'client_secret': cfg.ya_secret, 'redirect_uri': cfg.callback})
    access = tok.get('access_token')
    if not access:
        raise ProviderError('yandex.exchange', 200, 'no_token')
    info = http_call('yandex.info', cfg.ya_login + '/info?format=json', cfg,
                     headers={'Authorization': 'OAuth ' + access})
    uid = str(info.get('id') or '').strip()
    if not uid:
        raise ProviderError('yandex.info', 200, 'no_id')
    name = info.get('first_name') or info.get('display_name') or info.get('real_name') or info.get('login') or ''
    return uid, str(name).strip()


class Rate:
    LIMITS = {'start': (10, 600), 'claim': (200, 600), 'any': (120, 60)}

    def __init__(self):
        self._hits = defaultdict(deque)
        self._lock = threading.Lock()

    def allow(self, ip, bucket):
        n, window = self.LIMITS[bucket]
        t = time.time()
        with self._lock:
            q = self._hits[(ip, bucket)]
            while q and t - q[0] > window:
                q.popleft()
            if len(q) >= n:
                return False
            q.append(t)
            if len(self._hits) > 8000:
                for k in [k for k, v in self._hits.items() if not v]:
                    del self._hits[k]
            return True


class App:
    def __init__(self, cfg):
        if len(cfg.jwt_secret) < 32:
            raise SystemExit('JWT_SECRET короче 32 байт — сервис не стартует')
        self.cfg = cfg
        self.store = Store(cfg.db)
        self.rate = Rate()
        if cfg.ya_id and not cfg.ya_secret:
            log.warning('CONFIG WARNING: YANDEX_CLIENT_ID задан без YANDEX_CLIENT_SECRET — вход через Яндекс выключен')
        log.info('CONFIG: vk=%s yandex=%s db=%s callback=%s', cfg.vk_on, cfg.ya_on, cfg.db, cfg.callback)


    def account_json(self, c, acc_id):
        a = c.execute('SELECT id, name FROM accounts WHERE id=?', (acc_id,)).fetchone()
        if not a:
            return None
        provs = [r['provider'] for r in c.execute(
            'SELECT provider FROM identities WHERE account_id=? ORDER BY created_at', (acc_id,))]
        return {'id': a['id'], 'name': a['name'], 'providers': provs}

    def entitlements(self, c, acc_id):
        t = now()
        rows = c.execute('SELECT product, MAX(COALESCE(expires_at, 0)) AS exp, '
                         'MAX(expires_at IS NULL) AS forever FROM entitlements '
                         'WHERE account_id=? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>?) '
                         'GROUP BY product ORDER BY product', (acc_id, t))
        return [{'product': r['product'], 'expires_at': None if r['forever'] else r['exp']} for r in rows]

    def new_session(self, c, acc_id, family=None, expires_at=None):
        raw = b64u(secrets.token_bytes(32))
        c.execute('INSERT INTO sessions(id, account_id, family, refresh_hash, created_at, expires_at) '
                  'VALUES (?,?,?,?,?,?)', (uuid.uuid4().hex, acc_id, family or uuid.uuid4().hex,
                                           sha256_hex(raw), now(), expires_at or now() + self.cfg.refresh_ttl))
        return raw

    def tokens(self, c, acc_id, family=None, expires_at=None):
        refresh = self.new_session(c, acc_id, family, expires_at)
        return {'access': jwt_encode(self.cfg, acc_id), 'refresh': refresh,
                'account': self.account_json(c, acc_id), 'entitlements': self.entitlements(c, acc_id)}

    def refresh(self, raw):
        with self.store.tx() as c:
            s = c.execute('SELECT * FROM sessions WHERE refresh_hash=?', (sha256_hex(raw),)).fetchone()
            if not s or s['revoked_at']:
                return 401, {'error': 'invalid'}
            if s['rotated_at']:
                if now() - s['rotated_at'] <= REUSE_GRACE:
                    log.info('refresh: гонка вкладок acct=%s — свежий refresh уже выдан', mask(s['account_id']))
                    return 409, {'error': 'rotated'}
                c.execute('UPDATE sessions SET revoked_at=? WHERE family=? AND revoked_at IS NULL', (now(), s['family']))
                log.warning('refresh reuse: семья %s acct=%s отозвана', mask(s['family']), mask(s['account_id']))
                return 401, {'error': 'reuse'}
            if s['expires_at'] <= now():
                return 401, {'error': 'expired'}
            c.execute('UPDATE sessions SET rotated_at=? WHERE id=?', (now(), s['id']))
            c.execute('UPDATE accounts SET last_seen_at=? WHERE id=?', (now(), s['account_id']))
            # срок сессии фиксируется при входе и ротацией не сдвигается — как в spark
            out = self.tokens(c, s['account_id'], s['family'], s['expires_at'])
        log.info('refresh: acct=%s', mask(s['account_id']))
        return 200, out

    def logout(self, raw):
        with self.store.tx() as c:
            s = c.execute('SELECT family, account_id FROM sessions WHERE refresh_hash=?', (sha256_hex(raw),)).fetchone()
            if s:
                c.execute('UPDATE sessions SET revoked_at=? WHERE family=? AND revoked_at IS NULL', (now(), s['family']))
        if s:
            log.info('logout: acct=%s', mask(s['account_id']))
        return 200, {'ok': True}

    def delete_account(self, acc_id):
        with self.store.tx() as c:
            anon = 'deleted:' + sha256_hex(acc_id)[:16]
            paid = c.execute("UPDATE entitlements SET account_id=? WHERE account_id=? AND source!='manual'",
                             (anon, acc_id)).rowcount
            c.execute("DELETE FROM entitlements WHERE account_id=?", (acc_id,))
            c.execute('DELETE FROM oauth_pending WHERE account_id=?', (acc_id,))
            c.execute('DELETE FROM accounts WHERE id=?', (acc_id,))
        log.info('account delete: acct=%s, платных покупок обезличено: %d', mask(acc_id), paid)
        return 200, {'ok': True}


    def start(self, provider, mode, nonce):
        cfg = self.cfg
        if provider not in PROVIDERS or not cfg.enabled(provider):
            return 400, {'error': 'provider'}
        if mode not in MODES:
            return 400, {'error': 'mode'}
        if not isinstance(nonce, str) or not NONCE_RE.match(nonce):
            return 400, {'error': 'nonce'}
        sid, state = b64u(secrets.token_bytes(32)), b64u(secrets.token_bytes(32))
        verifier = b64u(secrets.token_bytes(48)) if provider == 'vk' else None
        with self.store.tx() as c:
            c.execute('INSERT INTO oauth_pending(sid, state, provider, mode, verifier, nonce_hash, created_at) '
                      'VALUES (?,?,?,?,?,?,?)', (sid, state, provider, mode, verifier, sha256_hex(nonce), now()))
        if provider == 'vk':
            url = vk_authorize_url(cfg, state, b64u(hashlib.sha256(verifier.encode()).digest()))
        else:
            url = ya_authorize_url(cfg, state)
        log.info('auth start: provider=%s mode=%s sid=%s', provider, mode, mask(sid))
        return 200, {'authUrl': url, 'sid': sid}

    def callback(self, q):
        """→ (статус, тело-или-None, Location-или-None, mode)."""
        state = q.get('state', '')
        with self.store.tx() as c:
            p = c.execute('SELECT * FROM oauth_pending WHERE state=?', (state,)).fetchone() if state else None
            if not p or now() - p['created_at'] > self.cfg.pending_ttl:
                log.warning('auth callback: state не найден или устарел')
                return 400, 'stale', None, 'poll'
            if p['status'] != 'pending':
                log.info('auth callback: повтор sid=%s status=%s — no-op', mask(p['sid']), p['status'])
                return self._callback_reply(p['sid'], p['mode'], p['status'] == 'authorized')
        sid, mode, provider = p['sid'], p['mode'], p['provider']
        err = None
        if q.get('error'):
            err = 'denied' if q.get('error') == 'access_denied' else 'provider'
        elif not q.get('code'):
            err = 'nocode'
        elif provider == 'vk' and not q.get('device_id'):
            err = 'nodevice'
        uid = name = None
        if not err:
            t0 = time.time()
            try:
                if provider == 'vk':
                    uid, name = vk_profile(self.cfg, q['code'], q['device_id'], p['verifier'], state)
                else:
                    uid, name = ya_profile(self.cfg, q['code'])
                log.debug('auth callback: обмен %s за %d мс', provider, (time.time() - t0) * 1000)
            except ProviderError as e:
                log.warning('auth callback: провайдер %s отказал (%s) sid=%s', provider, e, mask(sid))
                err = 'provider'
        with self.store.tx() as c:
            cur = c.execute('SELECT status FROM oauth_pending WHERE sid=?', (sid,)).fetchone()
            if not cur or cur['status'] != 'pending':
                return self._callback_reply(sid, mode, bool(cur and cur['status'] == 'authorized'))
            if err:
                c.execute("UPDATE oauth_pending SET status='failed', error=? WHERE sid=?", (err, sid))
                log.info('auth callback: provider=%s sid=%s → failed (%s)', provider, mask(sid), err)
                return self._callback_reply(sid, mode, False)
            acc_id, is_new = self.upsert(c, provider, uid, name)
            c.execute("UPDATE oauth_pending SET status='authorized', account_id=?, is_new=? WHERE sid=?",
                      (acc_id, int(is_new), sid))
        log.info('auth callback: provider=%s sid=%s → acct=%s%s', provider, mask(sid), mask(acc_id),
                 ' (новый)' if is_new else '')
        return self._callback_reply(sid, mode, True)

    def _callback_reply(self, sid, mode, ok):
        if mode == 'redirect':
            return 302, None, self.cfg.play_url + '#auth=' + sid, mode
        return 200, 'ok' if ok else 'fail', None, mode

    def upsert(self, c, provider, uid, name):
        name = (name or '')[:64]
        row = c.execute('SELECT account_id FROM identities WHERE provider=? AND provider_user_id=?',
                        (provider, uid)).fetchone()
        if row:
            c.execute('UPDATE accounts SET name=?, last_seen_at=? WHERE id=?', (name, now(), row['account_id']))
            return row['account_id'], False
        acc_id = uuid.uuid4().hex
        c.execute('INSERT INTO accounts(id, name, created_at, last_seen_at) VALUES (?,?,?,?)', (acc_id, name, now(), now()))
        c.execute('INSERT INTO identities(provider, provider_user_id, account_id, created_at) VALUES (?,?,?,?)',
                  (provider, uid, acc_id, now()))
        return acc_id, True

    def claim(self, sid, nonce):
        if not isinstance(sid, str) or not isinstance(nonce, str):
            return 400, {'error': 'bad'}
        with self.store.tx() as c:
            p = c.execute('SELECT * FROM oauth_pending WHERE sid=?', (sid,)).fetchone()
            if not p:
                return 404, {'status': 'unknown'}
            if not hmac.compare_digest(p['nonce_hash'], sha256_hex(nonce)):
                log.warning('auth claim: nonce не сошёлся sid=%s', mask(sid))
                return 403, {'status': 'forbidden'}
            if now() - p['created_at'] > self.cfg.pending_ttl:
                c.execute('DELETE FROM oauth_pending WHERE sid=?', (sid,))
                return 410, {'status': 'expired'}
            if p['status'] == 'pending':
                return 200, {'status': 'pending'}
            c.execute('DELETE FROM oauth_pending WHERE sid=?', (sid,))
            if p['status'] != 'authorized':
                return 200, {'status': 'failed', 'reason': p['error'] or 'provider'}
            out = self.tokens(c, p['account_id'])
        out.update(status='ok', provider=p['provider'], is_new=bool(p['is_new']))
        log.info('auth claim: provider=%s acct=%s выдана сессия', p['provider'], mask(p['account_id']))
        return 200, out


    def progress_get(self, acc_id):
        r = self.store.conn().execute('SELECT data, rev FROM progress WHERE account_id=?', (acc_id,)).fetchone()
        return 200, {'data': json.loads(r['data']) if r else {}, 'rev': r['rev'] if r else 0}

    def progress_put(self, acc_id, data):
        if not progress_ok(data):
            return 400, {'error': 'progress'}
        with self.store.tx() as c:
            r = c.execute('SELECT data, rev FROM progress WHERE account_id=?', (acc_id,)).fetchone()
            stored = json.loads(r['data']) if r else {}
            merged = merge(stored, data)
            body = json.dumps(merged, ensure_ascii=False, separators=(',', ':'))
            if len(body.encode()) > MAX_PROGRESS * 2:
                return 413, {'error': 'too-big'}
            rev = (r['rev'] if r else 0) + 1
            c.execute('INSERT INTO progress(account_id, data, rev, updated_at) VALUES (?,?,?,?) '
                      'ON CONFLICT(account_id) DO UPDATE SET data=excluded.data, rev=excluded.rev, '
                      'updated_at=excluded.updated_at', (acc_id, body, rev, now()))
            c.execute('UPDATE accounts SET last_seen_at=? WHERE id=?', (now(), acc_id))
        log.info('sync: acct=%s уровней %d→%d, %.1f КБ, rev %d', mask(acc_id), len(stored), len(merged),
                 len(body.encode()) / 1024, rev)
        return 200, {'data': merged, 'rev': rev}


    def sweep(self):
        with self.store.tx() as c:
            p = c.execute('DELETE FROM oauth_pending WHERE created_at<?', (now() - self.cfg.pending_ttl,)).rowcount
            s = c.execute('DELETE FROM sessions WHERE expires_at<? OR revoked_at<?',
                          (now() - 86400, now() - 30 * 86400)).rowcount
        if p or s:
            log.info('sweep: строк входа %d, сессий %d', p, s)


PAGE = """<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>По зеркалам · вход</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
background:#0d1620;color:#e8eef4;font:17px/1.45 system-ui,sans-serif;text-align:center;padding:24px}
h1{font-size:22px;margin:0 0 8px}p{margin:0;color:#93a7bd}</style></head>
<body><div><h1>%s</h1><p>%s</p></div></body></html>"""

PAGES = {
    'ok': ('Вход выполнен', 'Закрой эту вкладку и вернись в игру.'),
    'fail': ('Вход не удался', 'Закрой эту вкладку и попробуй ещё раз в игре.'),
    'stale': ('Ссылка входа устарела', 'Вернись в игру и начни вход заново.'),
}


def make_handler(app):
    class H(BaseHTTPRequestHandler):
        server_version = 'pz-account'
        sys_version = ''

        def log_message(self, fmt, *args):
            # без query: в адресе callback лежат state и code провайдера
            status = args[1] if len(args) > 1 and fmt.startswith('"%s"') else ''
            log.debug('%s %s %s %s', self.client_ip(), self.command, urllib.parse.urlsplit(self.path).path, status)

        def client_ip(self):
            if app.cfg.trust_xff:
                ip = self.headers.get('X-Real-IP', '').strip()
                if ip:
                    return ip
            return self.client_address[0]

        def path_parts(self):
            u = urllib.parse.urlsplit(self.path)
            p = u.path
            if p.startswith('/api/v1/'):
                p = p[len('/api/v1'):]
            return p.rstrip('/') or '/', dict(urllib.parse.parse_qsl(u.query))

        def send_json(self, status, obj):
            body = json.dumps(obj, ensure_ascii=False).encode()
            self.send_response(status)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def send_page(self, status, kind):
            title, text = PAGES[kind]
            body = (PAGE % (title, text)).encode()
            self.send_response(status)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def body_json(self):
            n = int(self.headers.get('Content-Length') or 0)
            if n > MAX_BODY:
                return None, (413, {'error': 'too-big'})
            raw = self.rfile.read(n) if n else b''
            try:
                return (json.loads(raw.decode() or '{}'), None)
            except (json.JSONDecodeError, UnicodeDecodeError):
                return None, (400, {'error': 'json'})

        def bearer(self):
            h = self.headers.get('Authorization', '')
            if not h.startswith('Bearer '):
                return None
            claims = jwt_decode(app.cfg, h[7:].strip())
            if not claims:
                return None
            acc = app.store.conn().execute('SELECT id FROM accounts WHERE id=?', (claims['sub'],)).fetchone()
            return acc['id'] if acc else None

        def limited(self, bucket):
            ip = self.client_ip()
            if app.rate.allow(ip, 'any') and (bucket == 'any' or app.rate.allow(ip, bucket)):
                return False
            log.warning('rate: %s %s', bucket, ip)
            self.send_json(429, {'error': 'rate'})
            return True

        def handle_any(self, method):
            path, q = self.path_parts()
            try:
                self.route(method, path, q)
            except Exception:
                log.exception('ошибка обработки %s %s', method, path)
                try:
                    self.send_json(500, {'error': 'internal'})
                except Exception:
                    pass
            finally:
                app.store.release()

        def route(self, method, path, q):
            if method == 'GET' and path == '/health':
                return self.send_json(200, {'ok': True, 'vk': app.cfg.vk_on, 'yandex': app.cfg.ya_on})
            if method == 'GET' and path == '/auth/callback':
                if self.limited('any'):
                    return
                status, kind, location, _ = app.callback(q)
                if location:
                    self.send_response(302)
                    self.send_header('Location', location)
                    self.send_header('Cache-Control', 'no-store')
                    self.send_header('Content-Length', '0')
                    return self.end_headers()
                return self.send_page(status, kind)
            if method == 'POST' and path in ('/auth/start', '/auth/claim', '/auth/refresh', '/auth/logout'):
                bucket = {'/auth/start': 'start', '/auth/claim': 'claim'}.get(path, 'any')
                if self.limited(bucket):
                    return
                data, err = self.body_json()
                if err:
                    return self.send_json(*err)
                if not isinstance(data, dict):
                    return self.send_json(400, {'error': 'json'})
                if path == '/auth/start':
                    return self.send_json(*app.start(data.get('provider'), data.get('mode'), data.get('nonce')))
                if path == '/auth/claim':
                    return self.send_json(*app.claim(data.get('sid'), data.get('nonce')))
                raw = data.get('refresh')
                if not isinstance(raw, str) or not raw:
                    return self.send_json(400, {'error': 'refresh'})
                return self.send_json(*(app.refresh(raw) if path == '/auth/refresh' else app.logout(raw)))
            if path in ('/me', '/progress'):
                if self.limited('any'):
                    return
                acc = self.bearer()
                if not acc:
                    return self.send_json(401, {'error': 'auth'})
                if path == '/me' and method == 'GET':
                    c = app.store.conn()
                    return self.send_json(200, {'account': app.account_json(c, acc), 'entitlements': app.entitlements(c, acc)})
                if path == '/me' and method == 'DELETE':
                    return self.send_json(*app.delete_account(acc))
                if path == '/progress' and method == 'GET':
                    return self.send_json(*app.progress_get(acc))
                if path == '/progress' and method == 'PUT':
                    data, err = self.body_json()
                    if err:
                        return self.send_json(*err)
                    return self.send_json(*app.progress_put(acc, (data or {}).get('data') if isinstance(data, dict) else None))
            return self.send_json(404, {'error': 'not-found'})

        def do_GET(self):
            self.handle_any('GET')

        def do_POST(self):
            self.handle_any('POST')

        def do_PUT(self):
            self.handle_any('PUT')

        def do_DELETE(self):
            self.handle_any('DELETE')
    return H


def make_server(app, host='127.0.0.1', port=None):
    srv = ThreadingHTTPServer((host, app.cfg.port if port is None else port), make_handler(app))
    srv.daemon_threads = True
    return srv


def sweeper(app, every=300):
    while True:
        time.sleep(every)
        try:
            app.sweep()
        except Exception:
            log.exception('sweep упал')


def cli_grant(app, a):
    with app.store.tx() as c:
        if not c.execute('SELECT 1 FROM accounts WHERE id=?', (a.account,)).fetchone():
            raise SystemExit('нет аккаунта ' + a.account)
        exp = now() + a.days * 86400 if a.days else None
        c.execute('INSERT INTO entitlements(account_id, product, source, ref, granted_at, expires_at) '
                  'VALUES (?,?,?,?,?,?) ON CONFLICT(account_id, product, ref) DO UPDATE SET '
                  'expires_at=excluded.expires_at, revoked_at=NULL, granted_at=excluded.granted_at',
                  (a.account, a.product, 'manual', a.ref, now(), exp))
    log.info('grant: acct=%s product=%s days=%s ref=%s', mask(a.account), a.product, a.days or '∞', a.ref)
    print('выдано: %s → %s%s' % (a.account, a.product, ' на %d дн.' % a.days if a.days else ' навсегда'))


def cli_revoke(app, a):
    with app.store.tx() as c:
        n = c.execute('UPDATE entitlements SET revoked_at=? WHERE account_id=? AND product=? AND revoked_at IS NULL',
                      (now(), a.account, a.product)).rowcount
    log.info('revoke: acct=%s product=%s строк %d', mask(a.account), a.product, n)
    print('отозвано строк: %d' % n)


def cli_list(app, a):
    c = app.store.conn()
    rows = c.execute('SELECT a.id, a.name, a.created_at, a.last_seen_at, GROUP_CONCAT(i.provider) AS provs '
                     'FROM accounts a LEFT JOIN identities i ON i.account_id=a.id '
                     'WHERE a.name LIKE ? GROUP BY a.id ORDER BY a.last_seen_at DESC LIMIT ?',
                     ('%' + (a.name or '') + '%', a.last))
    for r in rows:
        print('%s  %-20s  %-10s  создан %s  был %s' % (r['id'], r['name'][:20], r['provs'] or '',
              time.strftime('%Y-%m-%d', time.localtime(r['created_at'])),
              time.strftime('%Y-%m-%d %H:%M', time.localtime(r['last_seen_at']))))


def cli_stats(app, a):
    c, t = app.store.conn(), now()
    one = lambda sql, *p: c.execute(sql, p).fetchone()[0]
    print('аккаунтов: %d' % one('SELECT COUNT(*) FROM accounts'))
    for r in c.execute('SELECT provider, COUNT(*) n FROM identities GROUP BY provider'):
        print('  %s: %d' % (r['provider'], r['n']))
    print('активны за 7 дней: %d, за 30: %d' % (one('SELECT COUNT(*) FROM accounts WHERE last_seen_at>?', t - 7 * 86400),
                                                one('SELECT COUNT(*) FROM accounts WHERE last_seen_at>?', t - 30 * 86400)))
    print('живых сессий: %d' % one('SELECT COUNT(*) FROM sessions WHERE revoked_at IS NULL AND rotated_at IS NULL AND expires_at>?', t))
    print('с прогрессом на сервере: %d' % one('SELECT COUNT(*) FROM progress'))
    for r in c.execute("SELECT product, source, COUNT(*) n FROM entitlements WHERE revoked_at IS NULL "
                       "AND (expires_at IS NULL OR expires_at>?) GROUP BY product, source", (t,)):
        print('покупка %s (%s): %d' % (r['product'], r['source'], r['n']))


def main(argv=None):
    ap = argparse.ArgumentParser(description='Сервис аккаунтов «По зеркалам»')
    sub = ap.add_subparsers(dest='cmd')
    sub.add_parser('serve', help='поднять HTTP-сервис (по умолчанию)')
    g = sub.add_parser('grant', help='выдать покупку вручную (тестеры, пилоты, возвраты)')
    g.add_argument('account')
    g.add_argument('product')
    g.add_argument('--days', type=int, default=0, help='срок; 0 — навсегда')
    g.add_argument('--ref', default='', help='метка гранта: номер заказа, имя пилота')
    r = sub.add_parser('revoke', help='отозвать покупку')
    r.add_argument('account')
    r.add_argument('product')
    ls = sub.add_parser('list', help='последние аккаунты')
    ls.add_argument('--name', default='')
    ls.add_argument('--last', type=int, default=20)
    sub.add_parser('stats', help='сводка по аккаунтам и покупкам')
    a = ap.parse_args(argv)

    lvl = os.environ.get('LOG_LEVEL', 'info').upper()
    logging.basicConfig(level=getattr(logging, lvl, logging.INFO), stream=sys.stderr,
                        format='%(asctime)s %(levelname)s %(message)s')
    app = App(Config())
    if a.cmd in (None, 'serve'):
        srv = make_server(app)
        threading.Thread(target=sweeper, args=(app,), daemon=True).start()
        log.info('слушаю 127.0.0.1:%d', app.cfg.port)
        srv.serve_forever()
    else:
        {'grant': cli_grant, 'revoke': cli_revoke, 'list': cli_list, 'stats': cli_stats}[a.cmd](app, a)


if __name__ == '__main__':
    main()
