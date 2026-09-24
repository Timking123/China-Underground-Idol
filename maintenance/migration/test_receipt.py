"""只用合成站点验证迁移生产者到现有 root 消费者的原始字节合同。"""
import json
import os
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from maintenance import test_publish as fixtures
from maintenance.migration import receipt as r

p = fixtures.publish


class ReceiptTest(unittest.TestCase):
    def setUp(self):
        self.f = f = fixtures.PublicationTest()
        f.setUp()
        self.addCleanup(f.doCleanups)
        f.pending.unlink()
        f.verified_path.unlink()
        self.evidence = f.base / 'evidence'
        self.evidence.mkdir(mode=0o700)
        self.probe = self.evidence / 'probe.mjs'
        self.probe.write_bytes(b'synthetic reviewed browser collector\n')
        self.browser = self.evidence / 'c5-site-browser-verification-v5.json'
        self.browser.write_bytes(p.encode({'site': str(self.evidence / 'site-2b920-c3'),
            'status': 'passed', 'workerExit': 0, 'uid': 995, 'published': False,
            'manifestSha256': f.plan['manifestSha256'], 'checks': ['synthetic'] * 19,
            'errors': [], 'externalRequests': []}))
        self.values = {'ANCHOR': 'b' * 40, 'ANCHOR_TREE': 'c' * 40, 'BASE_SHA': 'a' * 40,
            'MANIFEST': f.plan['manifestSha256'], 'OLD_MANIFEST': f.plan['previousManifestSha256'],
            'CONFIG_SHA': p.digest(f.config.read_bytes()), 'PREVIOUS': 'releases/previous-release',
            'BROWSER_SHA': p.digest(self.browser.read_bytes()), 'PROBE_SHA': p.digest(self.probe.read_bytes()),
            'PUBLIC_COUNT': len(p.REQUIRED), 'OLD_COUNT': len(p.REQUIRED)}
        for key, value in self.values.items():
            ctx = patch.object(r, key, value);ctx.start();self.addCleanup(ctx.stop)
        ctx = patch.object(p, 'maintenance_mode', return_value='paused');ctx.start();self.addCleanup(ctx.stop)
        self.push = {'schemaVersion': 'idol-git-push-evidence-v1', 'repository': r.ORIGIN,
                     'remoteRef': 'refs/heads/main', 'remoteBefore': 'a' * 40,
                     'sourceCommit': 'b' * 40, 'localCommitAtPush': 'b' * 40,
                     'pushExitCode': 0, 'remoteAfter': 'b' * 40}
        self.push_path = self.evidence / 'git-push-evidence.json'
        self.push_path.write_bytes(p.encode(self.push))

    def git(self, repo, *args):
        if args[0] == 'rev-parse':return 'c' * 40 if args[1].endswith('^{tree}') else 'b' * 40
        if args[0] == 'branch':return 'main'
        if args[0] == 'remote':return r.ORIGIN
        if args[0] == 'write-tree':return 'c' * 40
        if args[0] == 'ls-remote':return 'b' * 40 + '\trefs/heads/main'
        return ''

    def collect(self):
        return r.collect(p, 'migration-20260924-synthetic', base=self.f.base,
                         evidence=self.evidence, config=self.f.config, probe=self.probe, run_git=self.git)

    def bound(self):
        return r.bind_push(p, self.collect(), self.evidence, p.digest(self.push_path.read_bytes()))

    def test_raw_contract_consumed_by_existing_publisher(self):
        request, verified, sidecar = self.bound()
        self.assertEqual(set(json.loads(request)), p.REQUEST_KEYS)
        self.assertEqual(len(json.loads(verified)), 9)
        self.assertEqual(json.loads(request)['verificationSha256'], p.digest(verified))
        self.assertEqual(sidecar['requestSha256'], p.digest(request))
        r.install_records(p, self.f.state, (request, verified, sidecar), lambda: None)
        result = p.create_publisher(base=self.f.base, config=self.f.config, fetch=self.f.fetch,
            lock=fixtures.synthetic_lock, guard=lambda: None)()
        self.assertEqual(result['status'], 'published')

    def test_evidence_and_preimage_mutations_refused(self):
        for path, expected in [(self.browser, 'browser_evidence_hash'), (self.probe, 'browser_probe_identity'),
                               (self.f.config, 'config_drift'), (self.f.source/'manifest.sha256', 'manifest_hash_mismatch')]:
            with self.subTest(path=path.name):
                raw = path.read_bytes();path.write_bytes(raw+b' ')
                with self.assertRaisesRegex(RuntimeError, expected):self.collect()
                path.write_bytes(raw)
        self.f.base.joinpath('current').unlink()
        with self.assertRaisesRegex(RuntimeError, 'current_drift'):self.collect()

    def test_remote_mismatch_and_missing_objects(self):
        for operation, response, code in [('ls-remote', 'd'*40+'\trefs/heads/main', 'git_remote_drift'),
                                          ('rev-list', '?'+ 'a'*40, 'git_missing_objects')]:
            with self.subTest(operation=operation):
                def changed(repo, *args):return response if args[0] == operation else self.git(repo, *args)
                with self.assertRaisesRegex(RuntimeError, code):r.git_evidence(self.f.repo, changed)

    def test_push_binding_and_equal_base_are_rejected(self):
        for changes, code in [({'pushExitCode': 1}, 'push_evidence_binding'),
                              ({'remoteBefore': 'b'*40}, 'base_equals_new'), ({'remoteBefore': 'd'*40}, 'push_preimage')]:
            self.push_path.write_bytes(p.encode({**self.push, **changes}))
            with self.assertRaisesRegex(RuntimeError, code):self.bound()

    def test_existing_pending_preparing_and_dangling_link(self):
        root = self.f.state/'publish'
        for name in ('pending.json', 'preparing.json', '.prepare.lock'):
            path = root/name;path.write_bytes(b'existing')
            with self.assertRaisesRegex(RuntimeError, 'publication_already_exists'):self.collect()
            path.unlink()
        path = root/'pending.json';path.symlink_to('absent')
        with self.assertRaisesRegex(RuntimeError, 'publication_already_exists'):self.collect()

    def test_partial_write_preserved_and_duplicate_refused(self):
        bundle = self.bound()
        root = self.evidence/'dry';root.mkdir(mode=0o700)
        output = root/'one'
        def changed():raise RuntimeError('preimage_drift')
        with self.assertRaisesRegex(RuntimeError, 'preimage_drift'):
            r.write_records(p, output, *bundle, changed)
        self.assertTrue((output/'verified.json').is_file())
        self.assertFalse((output/'pending.json').exists())
        with self.assertRaisesRegex(RuntimeError, 'run_already_exists'):
            r.write_records(p, output, *bundle, lambda:None)

    def test_link_and_writable_parent_refused(self):
        link = self.evidence/'linked';link.symlink_to(self.probe)
        with self.assertRaisesRegex(RuntimeError, 'path_link'):r.checked_path(link)
        if os.name == 'posix':
            self.evidence.chmod(0o777)
            with self.assertRaisesRegex(RuntimeError, 'path_permissions'):r.checked_path(self.probe)
            self.evidence.chmod(0o700)

    def test_restore_missing_or_initial_never_creates_state(self):
        package = self.evidence/'final-package';package.mkdir(mode=0o700)
        generation = '00000000-0000-0000-0000-000000000000'
        with self.assertRaises(FileNotFoundError):
            r.restore_evidence(p, package, generation, package_parent=self.evidence)
        (package/'snapshot.json').write_bytes(p.encode({'generation': generation, 'phase': 'initial',
                                                       'origin': 'old', 'restorable': False}))
        restore = self.evidence/('restore-'+generation+'.json')
        restore.write_bytes(p.encode({'schemaVersion': 'idol-migration-restore-v1', 'generation': generation,
            'direction': 'forward', 'status': 'verified-offline', 'servicesStarted': False,
            'ownership': [{'accessVerified': True}]}))
        with self.assertRaisesRegex(RuntimeError, 'final_snapshot_required'):
            r.restore_evidence(p, package, generation, package_parent=self.evidence)
        self.assertFalse(self.f.pending.exists())

    def test_verified_then_preimage_failure_never_creates_pending(self):
        request, verified, sidecar = self.bound()
        def changed():raise RuntimeError('preimage_drift')
        with self.assertRaisesRegex(RuntimeError, 'preimage_drift'):
            r.install_records(p, self.f.state, (request, verified, sidecar), changed)
        self.assertFalse(self.f.pending.exists())
        self.assertTrue((self.f.state/'publish/verified'/('migration-20260924-synthetic.json')).is_file())

    @unittest.skipUnless(os.name == 'posix', '正式入口固定Linux/root')
    def test_main_prepare_existing_dry_output_has_no_intent_or_state(self):
        tools = self.evidence/'tools';tools.mkdir(mode=0o700)
        script = tools/'receipt.py';script.write_bytes(b'synthetic installed path')
        outputs = tools/'receipt-dry-runs';outputs.mkdir(mode=0o700)
        run_id = 'migration-20260924-synthetic'
        destination = outputs/run_id
        base = self.evidence/'runtime';base.mkdir(mode=0o700)
        flags = SimpleNamespace(**{name: getattr(r.sys.flags, name) for name in dir(r.sys.flags)
                                   if name != 'isolated' and isinstance(getattr(r.sys.flags, name), int)}, isolated=1)
        for dangling in (False, True):
            if dangling:destination.symlink_to('absent')
            else:destination.mkdir(mode=0o700)
            with patch.object(r, 'TOOLS', tools), patch.object(r, 'BASE', base), \
                 patch.object(r, '__file__', str(script)), patch.object(r, 'load_publisher', return_value=p), \
                 patch.object(r.sys, 'flags', flags), \
                 patch.object(r.sys, 'argv', [str(script), 'prepare', '--run-id', run_id,
                     '--push-evidence-sha256', 'a'*64, '--package', str(self.evidence/'final'),
                     '--generation', '00000000-0000-0000-0000-000000000000']):
                with self.assertRaisesRegex(RuntimeError, 'run_already_exists'):r.main()
            self.assertFalse((tools/'receipt-intent.json').exists())
            self.assertFalse((base/'maintenance/state').exists())
            if dangling:destination.unlink()
            else:destination.rmdir()

    @unittest.skipUnless(os.name == 'posix', '真实flock只在Linux验证')
    def test_lock_replacement_is_detected(self):
        for name in ('.maintenance.lock', '.release.lock'):
            path = self.f.base/'deployments'/name;path.touch(mode=0o600)
        with self.assertRaisesRegex(RuntimeError, 'lock_drift'):
            with r.locks(self.f.base) as check:
                path = self.f.base/'deployments/.release.lock'
                path.rename(path.with_name('.release-preserved'))
                path.touch(mode=0o600)
                check()


if __name__ == '__main__':
    unittest.main()
