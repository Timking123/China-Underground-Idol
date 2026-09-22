"""同代与回退测试只在系统临时目录操作合成 SQLite/账本，不使用生产凭据。"""
import importlib.util
import json
from pathlib import Path
import sqlite3
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


if __name__ == '__main__':
    unittest.main()
