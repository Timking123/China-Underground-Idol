"""私有迁移的完整性、重跑与零覆盖反例。"""

import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("seed", Path(__file__).with_name("install-seed.py"))
seed = importlib.util.module_from_spec(spec)
spec.loader.exec_module(seed)


class SeedTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)

    def bundle(self, entries):
        target = self.root / "seed.tar.gz"
        manifest = {"schemaVersion": "idol-private-seed-v1", "files": [{"path": name, "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()} for name, raw in entries.items()]}
        with tarfile.open(target, "w:gz") as archive:
            for name, raw in {**entries, "seed-manifest.json": json.dumps(manifest).encode()}.items():
                info = tarfile.TarInfo(name)
                info.size = len(raw)
                archive.addfile(info, io.BytesIO(raw))
        return target, hashlib.sha256(target.read_bytes()).hexdigest()

    def install(self, archive, digest):
        return seed.install_seed(archive, self.root / "workspace", self.root / "seed", digest)

    def test_same_archive_is_idempotent(self):
        name = f"{seed.STAGE}/private/store/synthetic.json"
        archive, digest = self.bundle({name: b'{"synthetic":true}'})
        self.assertEqual(self.install(archive, digest)["writes"], 3)
        self.assertEqual(self.install(archive, digest)["writes"], 0)

    def test_wrong_hash_writes_nothing(self):
        archive, _ = self.bundle({f"{seed.STAGE}/private/store/synthetic.json": b"{}"})
        with self.assertRaisesRegex(RuntimeError, "SHA"):
            self.install(archive, "0" * 64)
        self.assertFalse((self.root / "workspace").exists())

    def test_conflict_stops_before_first_write(self):
        first = f"{seed.STAGE}/private/store/first.json"
        second = f"{seed.STAGE}/private/store/second.json"
        archive, digest = self.bundle({first: b"first", second: b"second"})
        previous = self.root / "workspace" / second
        previous.parent.mkdir(parents=True)
        previous.write_bytes(b"existing")
        with self.assertRaisesRegex(RuntimeError, "停止覆盖"):
            self.install(archive, digest)
        self.assertFalse((self.root / "workspace" / first).exists())
        self.assertEqual(previous.read_bytes(), b"existing")

    def test_private_allowlist_blocks_escape_and_site(self):
        for path in ["../outside", "work/phase3-20260909/site/data.js", "work/phase3-20260909/private/store/../bad"]:
            archive, digest = self.bundle({path: b"{}"})
            with self.assertRaises(RuntimeError):
                self.install(archive, digest)
            self.assertFalse((self.root / "workspace").exists())


if __name__ == "__main__":
    unittest.main()
