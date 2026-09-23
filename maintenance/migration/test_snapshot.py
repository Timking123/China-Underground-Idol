"""同代与回退测试只在系统临时目录操作合成 SQLite/账本，不使用生产凭据。"""
import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location('migration', Path(__file__).with_name('snapshot.py'))
migration = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(migration)


class SnapshotTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='idol-migration-')
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        self.sources = {name: self.root / ('live-' + name) for name in migration.SOURCES}
        for directory in self.sources.values():
            directory.mkdir(mode=0o700)
        with sqlite3.connect(self.sources['console'] / 'console.sqlite') as db:
            db.execute('CREATE TABLE synthetic (value TEXT)')
            db.execute("INSERT INTO synthetic VALUES ('encrypted-placeholder')")
        db.close()
        for name in migration.LEDGERS:
            (self.sources[name] / 'receipt.json').write_bytes(b'{"dedupe":"synthetic-preserve"}\n')
        self.verify = lambda directory: {'status': 'verified', 'initialized': False}
        self.frozen = lambda: None

    def snapshot(self, phase='final', origin='old'):
        package = self.root / ('package-' + phase + '-' + origin)
        receipt = migration.snapshot(package, self.sources, phase=phase, origin=origin, verify=self.verify, frozen=self.frozen)
        return package, receipt

    def test_initial_cannot_restore_and_same_generation_required(self):
        package, receipt = self.snapshot('initial')
        with self.assertRaisesRegex(RuntimeError, 'initial_snapshot_not_restorable'):
            migration.validate_package(package, receipt['generation'], 'forward', self.verify)
        package, receipt = self.snapshot()
        with self.assertRaisesRegex(RuntimeError, 'generation_mismatch'):
            migration.validate_package(package, 'wrong-generation', 'forward', self.verify)
        (package / 'weekly/receipt.json').write_bytes(b'{}')
        with self.assertRaisesRegex(RuntimeError, 'manifest_drift'):
            migration.validate_package(package, receipt['generation'], 'forward', self.verify)

    def test_reverse_requires_new_origin_and_restore_stays_offline(self):
        package, receipt = self.snapshot()
        with self.assertRaisesRegex(RuntimeError, 'reverse_snapshot_required'):
            migration.validate_package(package, receipt['generation'], 'reverse', self.verify)
        package, receipt = self.snapshot(origin='new')
        targets = {name: self.root / ('restored-' + name) for name in migration.SOURCES}
        result = migration.restore(package, targets, generation=receipt['generation'], direction='reverse', verify=self.verify, frozen=self.frozen, receipt_path=self.root / 'restore.json', handoff=lambda _targets: [])
        self.assertEqual(result['status'], 'verified-offline')
        self.assertFalse(result['servicesStarted'])
        for name in migration.LEDGERS:
            self.assertEqual((targets[name] / 'receipt.json').read_bytes(), (self.sources[name] / 'receipt.json').read_bytes())
        with self.assertRaisesRegex(RuntimeError, 'destination_exists'):
            migration.restore(package, targets, generation=receipt['generation'], direction='reverse', verify=self.verify, frozen=self.frozen, receipt_path=self.root / 'second.json')

    def test_stop_failure_precedes_snapshot_creation(self):
        target = self.root / 'blocked'
        def refuse():
            raise RuntimeError('writer_still_active')
        with self.assertRaisesRegex(RuntimeError, 'writer_still_active'):
            migration.snapshot(target, self.sources, phase='final', origin='old', verify=self.verify, frozen=refuse)
        self.assertFalse(target.exists())

    def test_ambiguous_parent_segments_rejected_before_following_paths(self):
        with self.assertRaisesRegex(RuntimeError, 'absolute_unambiguous_path_required'):
            migration.ordinary(self.root / 'live-state' / '..' / 'live-console', True)
        with self.assertRaisesRegex(RuntimeError, 'private_migration_root_required'):
            migration.private_package_path(Path('/var/lib/idol-migration/../other/package'))
        self.assertEqual(
            migration.private_package_path(Path('/var/lib/idol-migration/final')),
            Path('/var/lib/idol-migration/final'),
        )

    def test_rehearsal_entry_remounts_sysfs_only_inside_private_isolation(self):
        package = Path('/var/lib/idol-migration/initial-fixture')
        generation = '12345678-1234-1234-1234-123456789abc'
        manifest = 'a' * 64
        command = migration.rehearsal_launch_command(package, generation, manifest)
        self.assertEqual(command[:7], ['/usr/bin/unshare', '--mount', '--net', '--propagation', 'private', '/bin/sh', '-c'])
        shell = command[7]
        self.assertIn('/usr/bin/mount -t sysfs sysfs /sys', shell)
        self.assertIn('/usr/sbin/ip link set lo up', shell)
        self.assertIn('test "$(/usr/bin/ls /sys/class/net)" = lo', shell)
        self.assertLess(shell.index('/usr/bin/mount'), shell.index('/usr/sbin/ip'))
        self.assertLess(shell.index('/usr/sbin/ip'), shell.index('test "$('))
        self.assertEqual(command[8:], ['rehearsal', '/usr/bin/python3', '-I', str(migration.TOOLS / 'snapshot.py'), 'rehearsal-worker', '--package', str(package), '--generation', generation, '--console-manifest-sha256', manifest])

    @unittest.skipUnless(sys.platform.startswith('linux') and os.geteuid() == 0, '需要 Linux root 命名空间')
    def test_rehearsal_launcher_sees_only_loopback_in_linux(self):
        probe = subprocess.run(['/usr/bin/unshare', '--mount', '--net', '--propagation', 'private', '/usr/bin/true'], capture_output=True, timeout=10)
        if probe.returncode != 0:
            self.skipTest('当前离线环境不授予命名空间能力')
        command = migration.rehearsal_launch_command('/var/lib/idol-migration/fixture', '12345678-1234-1234-1234-123456789abc', 'a' * 64)
        check = 'import os; assert set(os.listdir("/sys/class/net")) == {"lo"}; assert set(x.split(":", 1)[0].strip() for x in open("/proc/net/dev").read().splitlines()[2:]) == {"lo"}'
        result = subprocess.run([*command[:8], 'rehearsal', '/usr/bin/python3', '-c', check], capture_output=True, timeout=15)
        self.assertEqual(result.returncode, 0, result.stderr.decode(errors='replace')[:200])


if __name__ == '__main__':
    unittest.main()
