#!/usr/bin/env python3
"""Тесты сервиса аккаунтов: python3 -m unittest server/test_account.py (из корня репозитория).

Без сети и зависимостей: VK ID и Яндекс ID заменяет локальная заглушка, которая отвечает их
контрактом и проверяет то, что проверил бы настоящий провайдер — PKCE-verifier против
challenge из адреса авторизации и секрет клиента Яндекса.
"""

import argparse
import base64
import hashlib
import io
import json
import logging
import os
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import account  # noqa: E402


def b64u(raw):
    return base64.urlsafe_b64encode(raw).rstrip(b'=').decode()


class FakeProviders:
    """Заглушка id.vk.ru, oauth.yandex.ru и login.yandex.ru на одном порту."""

    def __init__(self):
        self.challenges = set()
        self.calls = []
        fake = self

        class H(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def reply(self, status, obj):
                body = json.dumps(obj).encode()
                self.send_response(status)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def do_POST(self):
                n = int(self.headers.get('Content-Length') or 0)
                form = dict(urllib.parse.parse_qsl(self.rfile.read(n).decode()))
                fake.calls.append((self.path, form))
                if self.path == '/oauth2/auth':
                    ch = b64u(hashlib.sha256(form.get('code_verifier', '').encode()).digest())
                    if form.get('code') != 'vk-ok' or ch not in fake.challenges or not form.get('device_id'):
                        return self.reply(400, {'error': 'invalid_grant'})
                    return self.reply(200, {'access_token': 'vk-at', 'user_id': 12345})
                if self.path == '/oauth2/user_info':
                    if form.get('access_token') != 'vk-at':
                        return self.reply(401, {'error': 'invalid_token'})
                    return self.reply(200, {'user': {'user_id': 12345, 'first_name': 'Егор', 'last_name': 'Тестов'}})
                if self.path == '/token':
                    if form.get('client_secret') != 'ya-secret':
                        return self.reply(400, {'error': 'invalid_client'})
                    if form.get('code') != 'ya-ok':
                        return self.reply(400, {'error': 'invalid_grant'})
                    return self.reply(200, {'access_token': 'ya-at'})
                self.reply(404, {'error': 'nope'})

            def do_GET(self):
                fake.calls.append((self.path, {}))
                if self.path.startswith('/info'):
                    if self.headers.get('Authorization') != 'OAuth ya-at':
                        return self.reply(401, {'error': 'invalid_token'})
                    return self.reply(200, {'id': '777', 'first_name': 'Аня', 'login': 'anya'})
                self.reply(404, {'error': 'nope'})

        self.srv = ThreadingHTTPServer(('127.0.0.1', 0), H)
        self.srv.daemon_threads = True
        self.base = 'http://127.0.0.1:%d' % self.srv.server_address[1]
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


OPENER = urllib.request.build_opener(NoRedirect, urllib.request.ProxyHandler({}))


class AccountTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fake = FakeProviders()
        cls.log = io.StringIO()
        h = logging.StreamHandler(cls.log)
        h.setLevel(logging.DEBUG)
        account.log.addHandler(h)
        account.log.setLevel(logging.DEBUG)
        account.log.propagate = False

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        env = {'ACCT_DB': os.path.join(self.tmp.name, 'a.db'), 'JWT_SECRET': 's' * 40,
               'VK_CLIENT_ID': 'vk-app', 'YANDEX_CLIENT_ID': 'ya-app', 'YANDEX_CLIENT_SECRET': 'ya-secret',
               'VK_BASE': self.fake.base, 'YA_OAUTH_BASE': self.fake.base, 'YA_LOGIN_BASE': self.fake.base,
               'OAUTH_CALLBACK_URL': 'https://pozerkalam.space/api/v1/auth/callback',
               'PLAY_URL': 'https://pozerkalam.space/play/', 'PROVIDER_TIMEOUT': '3'}
        self.app = account.App(account.Config(env))
        self.srv = account.make_server(self.app, port=0)
        self.base = 'http://127.0.0.1:%d' % self.srv.server_address[1]
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()
        self.ip = 0

    def tearDown(self):
        self.srv.shutdown()
        self.srv.server_close()
        self.app.store.release()
        self.tmp.cleanup()

    def call(self, method, path, body=None, token=None, ip='10.0.0.1'):
        data = json.dumps(body).encode() if body is not None else None
        h = {'X-Real-IP': ip}
        if data is not None:
            h['Content-Type'] = 'application/json'
        if token:
            h['Authorization'] = 'Bearer ' + token
        req = urllib.request.Request(self.base + path, data=data, headers=h, method=method)
        try:
            with OPENER.open(req, timeout=5) as r:
                raw = r.read().decode()
                return r.status, (json.loads(raw) if 'json' in r.headers.get('Content-Type', '') else raw), r.headers
        except urllib.error.HTTPError as e:
            with e:
                raw = e.read().decode()
            try:
                return e.code, json.loads(raw), e.headers
            except json.JSONDecodeError:
                return e.code, raw, e.headers

    def nonce(self):
        return b64u(os.urandom(32))

    def start(self, provider='vk', mode='redirect', nonce=None):
        nonce = nonce or self.nonce()
        st, body, _ = self.call('POST', '/auth/start', {'provider': provider, 'mode': mode, 'nonce': nonce})
        self.assertEqual(st, 200, body)
        q = dict(urllib.parse.parse_qsl(urllib.parse.urlsplit(body['authUrl']).query))
        if 'code_challenge' in q:
            self.fake.challenges.add(q['code_challenge'])
        return body['sid'], q, nonce

    def callback(self, q, **params):
        p = {'state': q['state']}
        p.update(params)
        return self.call('GET', '/auth/callback?' + urllib.parse.urlencode(p))

    def login(self, provider='vk'):
        sid, q, nonce = self.start(provider, 'poll')
        code = {'vk': {'code': 'vk-ok', 'device_id': 'dev1'}, 'yandex': {'code': 'ya-ok'}}[provider]
        self.callback(q, **code)
        st, body, _ = self.call('POST', '/auth/claim', {'sid': sid, 'nonce': nonce})
        self.assertEqual((st, body['status']), (200, 'ok'), body)
        return body

    def test_vk_redirect_flow(self):
        sid, q, nonce = self.start('vk', 'redirect')
        self.assertEqual((q['client_id'], q['code_challenge_method'], q['redirect_uri']),
                         ('vk-app', 'S256', 'https://pozerkalam.space/api/v1/auth/callback'))
        st, _, h = self.callback(q, code='vk-ok', device_id='dev1')
        self.assertEqual(st, 302)
        self.assertEqual(h['Location'], 'https://pozerkalam.space/play/#auth=' + sid)
        st, body, _ = self.call('POST', '/auth/claim', {'sid': sid, 'nonce': nonce})
        self.assertEqual(body['status'], 'ok')
        self.assertEqual(body['account']['name'], 'Егор Т.')
        self.assertEqual(body['account']['providers'], ['vk'])
        self.assertTrue(body['is_new'])
        st, me, _ = self.call('GET', '/me', token=body['access'])
        self.assertEqual((st, me['account']['id']), (200, body['account']['id']))
        st, again, _ = self.call('POST', '/auth/claim', {'sid': sid, 'nonce': nonce})
        self.assertEqual(st, 404, 'токены выдаются ровно один раз')

    def test_yandex_poll_flow_and_same_account(self):
        sid, q, nonce = self.start('yandex', 'poll')
        self.assertEqual(q['scope'], 'login:info')
        st, body, _ = self.call('POST', '/auth/claim', {'sid': sid, 'nonce': nonce})
        self.assertEqual(body, {'status': 'pending'})
        st, page, _ = self.callback(q, code='ya-ok')
        self.assertEqual(st, 200)
        self.assertIn('Вход выполнен', page)
        self.assertNotIn('<script', page)
        st, first, _ = self.call('POST', '/auth/claim', {'sid': sid, 'nonce': nonce})
        self.assertEqual((first['status'], first['account']['name'], first['provider']), ('ok', 'Аня', 'yandex'))
        second = self.login('yandex')
        self.assertFalse(second['is_new'])
        self.assertEqual(second['account']['id'], first['account']['id'])

    def test_wrong_nonce_is_forbidden(self):
        sid, q, nonce = self.start('vk', 'redirect')
        self.callback(q, code='vk-ok', device_id='d')
        st, _, _ = self.call('POST', '/auth/claim', {'sid': sid, 'nonce': self.nonce()})
        self.assertEqual(st, 403)
        st, body, _ = self.call('POST', '/auth/claim', {'sid': sid, 'nonce': nonce})
        self.assertEqual(body['status'], 'ok', 'чужой nonce не сжигает вход хозяина')

    def test_callback_replay_is_noop(self):
        sid, q, nonce = self.start('vk', 'poll')
        self.callback(q, code='vk-ok', device_id='d')
        n_calls = len(self.fake.calls)
        st, page, _ = self.callback(q, code='vk-ok', device_id='d')
        self.assertEqual(st, 200)
        self.assertEqual(len(self.fake.calls), n_calls, 'повторный callback не ходит к провайдеру')
        c = self.app.store.conn()
        self.assertEqual(c.execute('SELECT COUNT(*) FROM accounts').fetchone()[0], 1)

    def test_denied_and_provider_errors(self):
        sid, q, nonce = self.start('yandex', 'poll')
        self.callback(q, error='access_denied')
        self.assertEqual(self.call('POST', '/auth/claim', {'sid': sid, 'nonce': nonce})[1],
                         {'status': 'failed', 'reason': 'denied'})
        sid, q, nonce = self.start('vk', 'poll')
        st, page, _ = self.callback(q, code='vk-bad', device_id='d')
        self.assertIn('Вход не удался', page)
        self.assertEqual(self.call('POST', '/auth/claim', {'sid': sid, 'nonce': nonce})[1]['reason'], 'provider')
        sid, q, nonce = self.start('vk', 'poll')
        self.callback(q, code='vk-ok')
        self.assertEqual(self.call('POST', '/auth/claim', {'sid': sid, 'nonce': nonce})[1]['reason'], 'nodevice')
        self.assertEqual(self.call('GET', '/health')[1]['ok'], True)

    def test_yandex_bad_secret_fails_cleanly(self):
        self.app.cfg.ya_secret = 'wrong'
        sid, q, nonce = self.start('yandex', 'redirect')
        st, _, h = self.callback(q, code='ya-ok')
        self.assertEqual(st, 302)
        self.assertEqual(self.call('POST', '/auth/claim', {'sid': sid, 'nonce': nonce})[1]['reason'], 'provider')

    def test_stale_and_expired(self):
        st, page, _ = self.call('GET', '/auth/callback?state=nope&code=x')
        self.assertEqual(st, 400)
        self.assertIn('устарела', page)
        sid, q, nonce = self.start('vk', 'poll')
        self.app.cfg.pending_ttl = -1
        self.assertEqual(self.call('POST', '/auth/claim', {'sid': sid, 'nonce': nonce})[0], 410)

    def test_start_validation(self):
        for body in ({'provider': 'google', 'mode': 'poll', 'nonce': self.nonce()},
                     {'provider': 'vk', 'mode': 'popup', 'nonce': self.nonce()},
                     {'provider': 'vk', 'mode': 'poll', 'nonce': 'short'}):
            self.assertEqual(self.call('POST', '/auth/start', body)[0], 400, body)
        self.app.cfg.vk_id = ''
        self.assertEqual(self.call('POST', '/auth/start', {'provider': 'vk', 'mode': 'poll', 'nonce': self.nonce()})[1],
                         {'error': 'provider'})

    def test_rate_limit_on_start(self):
        codes = [self.call('POST', '/auth/start', {'provider': 'vk', 'mode': 'poll', 'nonce': self.nonce()},
                           ip='10.9.9.9')[0] for _ in range(11)]
        self.assertEqual(codes[:10], [200] * 10)
        self.assertEqual(codes[10], 429)
        self.assertEqual(self.call('POST', '/auth/start', {'provider': 'vk', 'mode': 'poll', 'nonce': self.nonce()},
                                   ip='10.9.9.8')[0], 200, 'лимит считается по X-Real-IP, а не на всех')

    def test_refresh_rotation_and_reuse(self):
        s = self.login()
        st, r2, _ = self.call('POST', '/auth/refresh', {'refresh': s['refresh']})
        self.assertEqual(st, 200)
        self.assertNotEqual(r2['refresh'], s['refresh'])
        self.assertEqual(self.call('POST', '/auth/refresh', {'refresh': s['refresh']})[0], 409, 'гонка вкладок')
        c = self.app.store.conn()
        c.execute('UPDATE sessions SET rotated_at=rotated_at-120 WHERE rotated_at IS NOT NULL')
        self.assertEqual(self.call('POST', '/auth/refresh', {'refresh': s['refresh']})[1], {'error': 'reuse'})
        self.assertEqual(self.call('POST', '/auth/refresh', {'refresh': r2['refresh']})[0], 401,
                         'повтор старого refresh отзывает всю семью')

    def test_refresh_keeps_absolute_expiry(self):
        s = self.login()
        c = self.app.store.conn()
        exp0 = c.execute('SELECT expires_at FROM sessions').fetchone()[0]
        r2 = self.call('POST', '/auth/refresh', {'refresh': s['refresh']})[1]
        exp1 = c.execute('SELECT expires_at FROM sessions WHERE rotated_at IS NULL').fetchone()[0]
        self.assertEqual(exp0, exp1)
        c.execute('UPDATE sessions SET expires_at=1')
        self.assertEqual(self.call('POST', '/auth/refresh', {'refresh': r2['refresh']})[1], {'error': 'expired'})

    def test_logout(self):
        s = self.login()
        self.assertEqual(self.call('POST', '/auth/logout', {'refresh': s['refresh']})[0], 200)
        self.assertEqual(self.call('POST', '/auth/refresh', {'refresh': s['refresh']})[0], 401)

    def test_bearer_rejects_tampered_and_expired(self):
        s = self.login()
        head, body, sig = s['access'].split('.')
        forged = b64u(json.dumps({'sub': 'someone', 'iat': 0, 'exp': 2 ** 40, 'v': 1}).encode())
        self.assertEqual(self.call('GET', '/me', token=head + '.' + forged + '.' + sig)[0], 401)
        self.app.cfg.access_ttl = -1
        self.assertEqual(self.call('GET', '/me', token=account.jwt_encode(self.app.cfg, s['account']['id']))[0], 401)
        self.assertEqual(self.call('GET', '/me')[0], 401)

    def test_short_secret_refuses_to_start(self):
        with self.assertRaises(SystemExit):
            account.App(account.Config({'ACCT_DB': os.path.join(self.tmp.name, 'b.db'), 'JWT_SECRET': 'short'}))

    def test_api_prefix_is_accepted(self):
        self.assertEqual(self.call('GET', '/api/v1/health')[1]['vk'], True)

    def test_progress_sync_merges_and_is_idempotent(self):
        s = self.login()
        tok = s['access']
        phone = {'1 · Параллельная': {'n': 3, 'clean': 1, 'best': 40.2, 'bestHits': 1}}
        pc = {'1 · Параллельная': {'n': 2, 'clean': 2, 'best': 35.0, 'bestHits': 2},
              '14 · Габарит спереди': {'n': 1, 'clean': 0, 'best': 9.0, 'bestErr': 12}}
        self.assertEqual(self.call('PUT', '/progress', {'data': phone}, tok)[1]['rev'], 1)
        st, out, _ = self.call('PUT', '/progress', {'data': pc}, tok)
        self.assertEqual(out['data']['1 · Параллельная'], {'n': 3, 'clean': 2, 'best': 35.0, 'bestHits': 1})
        self.assertEqual(out['data']['14 · Габарит спереди']['bestErr'], 12)
        again = self.call('PUT', '/progress', {'data': pc}, tok)[1]
        self.assertEqual(again['data'], out['data'])
        self.assertEqual(again['rev'], 3)
        self.assertEqual(self.call('GET', '/progress', token=tok)[1]['data'], out['data'])

    def test_progress_validation(self):
        tok = self.login()['access']
        self.assertEqual(self.call('PUT', '/progress', {'data': [1, 2]}, tok)[0], 400)
        many = {('L%d' % i): {'n': 1} for i in range(account.MAX_LEVELS + 1)}
        self.assertEqual(self.call('PUT', '/progress', {'data': many}, tok)[0], 400)
        self.assertEqual(self.call('PUT', '/progress', {'data': {'x': {'n': 1}}})[0], 401)

    def test_merge_rules(self):
        m = account.merge
        a = {'L': {'n': 4, 'clean': 0, 'best': 50.5, 'bestErr': None,
                   'real': {'n': 2, 'passed': 1, 'routes': [1, 0, 0], 'bestScore': 3}}}
        b = {'L': {'n': 1, 'clean': 1, 'best': 60.0, 'bestErr': 8, 'passed': 1,
                   'real': {'n': 5, 'passed': 0, 'routes': [0, 2], 'bestScore': 5}},
             'junk': 5, 'arr': [1]}
        ab = m(a, b)
        self.assertEqual(ab, {'L': {'n': 4, 'clean': 1, 'best': 50.5, 'bestErr': 8, 'passed': 1,
                                    'real': {'n': 5, 'passed': 1, 'routes': [1, 2, 0], 'bestScore': 3}}})
        self.assertEqual(m(a, ab), ab, 'идемпотентно')
        self.assertEqual(m(b, a), ab, 'порядок устройств не важен')
        self.assertEqual(m('мусор', a), m({}, a))
        self.assertEqual(m({'L': {'best': True}}, {'L': {'best': 7}}), {'L': {'best': 7}})

    def test_delete_account(self):
        s = self.login()
        acc = s['account']['id']
        self.call('PUT', '/progress', {'data': {'L': {'n': 1}}}, s['access'])
        c = self.app.store.conn()
        c.execute("INSERT INTO entitlements VALUES (?, 'course', 'robokassa', 'ord-1', 1, NULL, NULL)", (acc,))
        account.cli_grant(self.app, argparse.Namespace(account=acc, product='pilot', days=0, ref=''))
        self.assertEqual(self.call('DELETE', '/me', token=s['access'])[0], 200)
        self.assertEqual(self.call('GET', '/me', token=s['access'])[0], 401)
        one = lambda sql, *p: c.execute(sql, p).fetchone()[0]
        self.assertEqual(one('SELECT COUNT(*) FROM identities'), 0)
        self.assertEqual(one('SELECT COUNT(*) FROM progress'), 0)
        self.assertEqual(one('SELECT COUNT(*) FROM sessions'), 0)
        self.assertEqual(one("SELECT COUNT(*) FROM entitlements WHERE account_id LIKE 'deleted:%' AND product='course'"), 1)
        self.assertEqual(one("SELECT COUNT(*) FROM entitlements WHERE product='pilot'"), 0)
        self.assertTrue(self.login()['is_new'], 'после удаления тот же VK — новый аккаунт')

    def test_entitlements_in_me(self):
        s = self.login()
        acc, tok = s['account']['id'], s['access']
        account.cli_grant(self.app, argparse.Namespace(account=acc, product='course', days=0, ref=''))
        account.cli_grant(self.app, argparse.Namespace(account=acc, product='trial', days=7, ref='t'))
        ent = {e['product']: e['expires_at'] for e in self.call('GET', '/me', token=tok)[1]['entitlements']}
        self.assertIsNone(ent['course'])
        self.assertGreater(ent['trial'], time.time() + 6 * 86400)
        account.cli_revoke(self.app, argparse.Namespace(account=acc, product='course'))
        c = self.app.store.conn()
        c.execute("UPDATE entitlements SET expires_at=? WHERE product='trial'", (int(time.time()) - 5,))
        self.assertEqual(self.call('GET', '/me', token=tok)[1]['entitlements'], [])

    def test_no_secrets_in_log(self):
        self.log.truncate(0)
        self.log.seek(0)
        sid, q, nonce = self.start('vk', 'redirect')
        self.callback(q, code='vk-ok', device_id='dev1')
        s = self.call('POST', '/auth/claim', {'sid': sid, 'nonce': nonce})[1]
        r2 = self.call('POST', '/auth/refresh', {'refresh': s['refresh']})[1]
        text = self.log.getvalue()
        self.assertIn('auth claim', text)
        for secret in (nonce, sid, q['state'], 'vk-ok', s['refresh'], s['access'], r2['refresh'], 'ya-secret', 'vk-at'):
            self.assertNotIn(secret, text)


if __name__ == '__main__':
    unittest.main()
