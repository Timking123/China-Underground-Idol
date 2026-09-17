"""Linux 隔离目录中的只读安装核验器回归；不触碰生产目录或服务。"""

import hashlib
import importlib.util
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location("verify_release", Path(__file__).with_name("verify-release.py"))
release = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(release)


class VerifyReleaseTest(unittest.TestCase):
    def setUp(self):
        self.assertEqual(os.getuid(), 0, "在隔离 Linux 环境以 root 测试真实 root 目录权限")
        self.root = Path(tempfile.mkdtemp(prefix="idol-console-verify-", dir="/run"))
        self.addCleanup(lambda: shutil.rmtree(self.root))
        self.package = self.root / "candidate"
        self.package.mkdir()
        (self.package / "public").mkdir()
        for name in release.FILES:
            (self.package / name).write_text("合成发行物\n", encoding="utf-8")
        self.refresh()

    def refresh(self):
        raw = "".join(hashlib.sha256((self.package / name).read_bytes()).hexdigest() + "  " + name + "\n" for name in sorted(release.FILES))
        (self.package / "manifest.sha256").write_text(raw, encoding="utf-8")
        self.expected = hashlib.sha256(raw.encode()).hexdigest()

    def test_valid_and_cli_are_readonly(self):
        before = {str(p): p.stat().st_mtime_ns for p in self.package.rglob("*")}
        self.assertEqual(release.verify(self.package, self.expected), 6)
        run = subprocess.run(["python3", str(Path(release.__file__)), str(self.package), "--manifest-sha256", self.expected], capture_output=True, text=True)
        self.assertEqual(run.returncode, 0, run.stderr)
        self.assertIn("6 个固定发行文件", run.stdout)
        self.assertEqual(before, {str(p): p.stat().st_mtime_ns for p in self.package.rglob("*")})

    def test_unknown_and_missing_files(self):
        for name in ["master.key", "console.sqlite", "arbitrary.js"]:
            target = self.package / name
            target.write_bytes(b"synthetic")
            with self.assertRaises(ValueError):
                release.verify(self.package, self.expected)
            target.unlink()
        (self.package / "server.mjs").unlink()
        with self.assertRaises(ValueError):
            release.verify(self.package, self.expected)

    def test_manifest_hash_and_payload_tamper(self):
        with self.assertRaises(ValueError):
            release.verify(self.package, "0" * 64)
        (self.package / "server.mjs").write_text("篡改", encoding="utf-8")
        with self.assertRaises(ValueError):
            release.verify(self.package, self.expected)

    def test_links_and_world_writable_parent(self):
        server = self.package / "server.mjs"
        outside = self.root / "outside"
        outside.write_bytes(server.read_bytes())
        server.unlink()
        server.symlink_to(outside)
        with self.assertRaises(ValueError):
            release.verify(self.package, self.expected)
        server.unlink()
        os.link(outside, server)
        with self.assertRaises(ValueError):
            release.verify(self.package, self.expected)
        server.unlink()
        server.write_bytes(outside.read_bytes())
        self.root.chmod(0o777)
        with self.assertRaises(ValueError):
            release.verify(self.package, self.expected)
        self.root.chmod(0o700)
        server.chmod(0o666)
        with self.assertRaises(ValueError):
            release.verify(self.package, self.expected)

    def test_duplicate_and_unknown_manifest_paths(self):
        manifest = self.package / "manifest.sha256"
        original = manifest.read_text(encoding="utf-8")
        for line in [original.splitlines()[0], "0" * 64 + "  ../outside", "0" * 64 + "  public/arbitrary.js"]:
            raw = (original + line + "\n").encode()
            manifest.write_bytes(raw)
            with self.assertRaises(ValueError):
                release.verify(self.package, hashlib.sha256(raw).hexdigest())


if __name__ == "__main__":
    unittest.main()
