"""一次性授权只测试原发布器的合成候选，无外网或生产目录。"""
from datetime import datetime, timedelta, timezone
import json
import unittest
from unittest.mock import Mock, patch
from maintenance import test_publish as fixtures

p = fixtures.publish


class MigrationPublicationTest(unittest.TestCase):
    def setUp(self):
        self.fixture = fixtures.PublicationTest()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.time = datetime(2026, 9, 23, tzinfo=timezone.utc)
        self.approval = self.fixture.base / 'approval.json'
        self.value = {
            'schemaVersion': 'idol-migration-publication-approval-v1', 'status': 'approved',
            'transactionId': 'migration-20260923-synthetic',
            'issuedAt': self.time.isoformat(), 'expiresAt': (self.time + timedelta(minutes=10)).isoformat(),
            'requestSha256': p.digest(self.fixture.pending.read_bytes()),
            **{name: self.fixture.plan[name] for name in ('previous', 'previousManifestSha256', 'source', 'manifestSha256', 'newSha', 'release')},
        }

    def authorization(self, **changes):
        self.approval.write_bytes(p.encode({**self.value, **changes}))
        return p.MigrationAuthorization(p.digest(self.approval.read_bytes()), approval=self.approval, now=lambda: self.time, read=p.read_regular, control=lambda: 'paused')

    def runner(self, approval, fetch=None):
        f = self.fixture
        return p.create_publisher(base=f.base, config=f.config, fetch=fetch or f.fetch, lock=fixtures.synthetic_lock, migration=approval)

    def test_exact_request_once_and_expired_replay_does_not_publish_again(self):
        auth = self.authorization()
        self.assertEqual(self.runner(auth)()['status'], 'published')
        self.assertTrue(auth.intent.is_file())
        self.assertTrue(auth.result.is_file())
        requests = len(self.fixture.requests)
        self.time += timedelta(hours=1)
        self.assertEqual(self.runner(auth)()['status'], 'already_published')
        self.assertEqual(len(self.fixture.requests), requests)

    def test_expiry_binding_and_existing_intent_prevent_new_release(self):
        auth = self.authorization(requestSha256='0' * 64)
        with self.assertRaisesRegex(RuntimeError, 'request_binding'):
            self.runner(auth)()
        auth = self.authorization()
        self.time += timedelta(minutes=11)
        with self.assertRaisesRegex(RuntimeError, 'expired'):
            self.runner(auth)()
        self.time -= timedelta(minutes=11)
        auth.begin(self.fixture.plan, self.value['requestSha256'], self.fixture.base / 'current')
        with self.assertRaisesRegex(RuntimeError, 'started_requires_review'):
            self.runner(auth)()
        self.assertFalse((self.fixture.base / 'releases' / self.fixture.plan['release']).exists())

    def test_expiry_after_switch_cannot_block_safe_rollback(self):
        auth = self.authorization()
        def fail_new(name, release):
            if release == self.fixture.plan['release']:
                self.time += timedelta(hours=1)
                raise RuntimeError('synthetic_https_failure')
            return self.fixture.fetch(name, release)
        with self.assertRaisesRegex(RuntimeError, 'post_switch_verification_failed'):
            self.runner(auth, fail_new)()
        self.assertEqual(self.fixture.receipt()['status'], 'rolled_back')
        self.assertEqual(json.loads(auth.result.read_bytes())['receipt']['status'], 'rolled_back')

    def test_default_entry_stays_paused_and_tampered_authorization_refused(self):
        auth = self.authorization()
        def paused():
            raise RuntimeError('maintenance_paused')
        with self.assertRaisesRegex(RuntimeError, 'maintenance_paused'):
            p.create_publisher(base=self.fixture.base, guard=paused)()
        self.approval.write_bytes(b'{}')
        with self.assertRaisesRegex(RuntimeError, 'approval_changed'):
            self.runner(auth)()
        self.assertEqual(self.fixture.requests, [])

    def test_migration_default_uses_local_tls_with_real_hostname(self):
        context = Mock()
        context.wrap_socket.return_value = Mock()
        with patch.object(p.socket, 'create_connection', return_value=Mock()) as dial:
            connection = p.LocalHTTPSConnection('idol.hi-veblen.com', 443, timeout=25, context=context)
            connection.connect()
        dial.assert_called_once_with(('127.0.0.1', 443), 25, None)
        self.assertEqual(context.wrap_socket.call_args.kwargs['server_hostname'], 'idol.hi-veblen.com')
        self.assertEqual(p.ssl.create_default_context().verify_mode, p.ssl.CERT_REQUIRED)
        auth = self.authorization()
        with patch.object(p, 'fetch_loopback_https', side_effect=self.fixture.fetch) as local:
            result = p.create_publisher(base=self.fixture.base, config=self.fixture.config, lock=fixtures.synthetic_lock, migration=auth)()
        self.assertEqual(result['status'], 'published')
        self.assertGreater(local.call_count, 0)


if __name__ == '__main__':
    unittest.main()
