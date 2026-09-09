"""使用临时静态候选和 HTTPS 替身验证发布助手，不接触服务器。"""

from contextlib import contextmanager
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location("idol_publish", Path(__file__).with_name("publish.py"))
publish = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(publish)


@contextmanager
def synthetic_lock(_directory):
    yield


class PublicationTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="idol-publish-")
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name).resolve() / "site"
        self.repo = self.base / "maintenance" / "repo"
        self.state = self.base / "maintenance" / "state"
        self.source = self.repo / ".build" / "site"
        self.old = self.base / "releases" / "previous-release"
        self.config = self.base / "nginx.conf"
        (self.base / "deployments").mkdir(parents=True)
        (self.base / "maintenance-receipts").mkdir()
        self.config.write_bytes(b"synthetic nginx configuration\n")
        self.make_site(self.old, "old")
        self.make_site(self.source, "new")
        (self.base / "current").symlink_to("releases/previous-release", target_is_directory=True)
        self.plan = {
            "schemaVersion": "idol-publish-request-v1", "runId": "synthetic-20260910",
            "release": "auto-2026-09-10-" + "b" * 12, "source": str(self.source),
            "repoRoot": str(self.repo), "baseSha": "a" * 40, "newSha": "b" * 40,
            "manifestSha256": publish.digest((self.source / "manifest.sha256").read_bytes()),
            "publicFileCount": len(publish.REQUIRED), "previous": "releases/previous-release",
            "previousManifestSha256": publish.digest((self.old / "manifest.sha256").read_bytes()),
            "configSha256": publish.digest(self.config.read_bytes()),
        }
        verified = {key: self.plan[key] for key in ("runId", "newSha", "baseSha", "manifestSha256", "source", "repoRoot")}
        verified.update(schemaVersion="idol-publication-verified-v1", gitPushVerified=True, browserVerified=True)
        raw = publish.encode(verified)
        self.verified_path = self.state / "publish" / "verified" / (self.plan["runId"] + ".json")
        self.verified_path.parent.mkdir(parents=True)
        self.verified_path.write_bytes(raw)
        self.plan["verificationSha256"] = publish.digest(raw)
        self.pending = self.state / "publish" / "pending.json"
        self.pending.write_bytes(publish.encode(self.plan))
        self.requests = []

    def make_site(self, directory, value):
        for name in publish.REQUIRED:
            target = directory / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes((value + ":" + name).encode())
        self.rebuild_manifest(directory)

    def rebuild_manifest(self, directory):
        lines = []
        for name in sorted(publish.REQUIRED):
            lines.append(publish.digest((directory / name).read_bytes()) + "  " + name)
        (directory / "manifest.sha256").write_text("\n".join(lines) + "\n", encoding="utf-8")

    def fetch(self, name, release):
        self.requests.append((name, release))
        current = self.base / os.readlink(self.base / "current")
        return (current / name).read_bytes()

    def runner(self, fetch=None):
        return publish.create_publisher(base=self.base, config=self.config, fetch=fetch or self.fetch, lock=publish.deployment_lock if os.name == "posix" else synthetic_lock)

    def receipt(self):
        return json.loads((self.base / "maintenance-receipts" / (self.plan["release"] + ".json")).read_bytes())

    def test_publish_exact_bytes_receipt_and_idempotence(self):
        result = self.runner()()
        self.assertEqual(result["status"], "published")
        self.assertEqual(os.readlink(self.base / "current"), "releases/" + self.plan["release"])
        self.assertEqual(len(self.requests), 5)
        receipt = self.receipt()
        self.assertEqual(receipt["requestSha256"], publish.digest(self.pending.read_bytes()))
        self.assertEqual(receipt["status"], "published")
        self.assertTrue(self.old.is_dir())
        self.assertTrue(self.pending.is_file())
        self.assertEqual(self.runner()()["status"], "already_published")

    def test_no_pending_is_successful_noop(self):
        self.pending.unlink()
        self.assertEqual(self.runner()(), {"status": "noop"})
        self.assertEqual(self.requests, [])

    def test_manifest_tamper_stops_before_switch(self):
        (self.source / "assets/site.js").write_bytes(b"tampered")
        with self.assertRaisesRegex(RuntimeError, "candidate_hash_or_total"):
            self.runner()()
        self.assertEqual(os.readlink(self.base / "current"), self.plan["previous"])

    def test_pending_drift_stops_before_switch(self):
        original = publish.read_regular
        changed = False
        def drift(target, limit=publish.MAX_FILE):
            nonlocal changed
            result = original(target, limit)
            if target == self.source / "assets/site.js" and not changed:
                changed = True
                self.pending.write_bytes(self.pending.read_bytes() + b" ")
            return result
        with patch.object(publish, "read_regular", side_effect=drift):
            with self.assertRaisesRegex(RuntimeError, "pending_changed"):
                self.runner()()
        self.assertEqual(os.readlink(self.base / "current"), self.plan["previous"])

    def test_symlink_escape_and_hardlink_stop(self):
        target = self.source / "assets/site.js"
        outside = self.base / "outside.js"
        outside.write_bytes(target.read_bytes())
        target.unlink()
        target.symlink_to(outside)
        with self.assertRaises((RuntimeError, OSError)):
            self.runner()()
        target.unlink()
        os.link(outside, target)
        with self.assertRaisesRegex(RuntimeError, "file_type_or_size"):
            self.runner()()
        self.assertEqual(os.readlink(self.base / "current"), self.plan["previous"])

    def test_parent_directory_link_stops(self):
        outside = self.base / "outside-assets"
        (self.source / "assets").rename(outside)
        (self.source / "assets").symlink_to(outside, target_is_directory=True)
        with self.assertRaises((RuntimeError, OSError)):
            self.runner()()

    def test_https_failure_rolls_back_and_verifies_previous(self):
        def failure(name, release):
            if release == self.plan["release"]:
                raise OSError("synthetic HTTPS failure")
            return self.fetch(name, release)
        with self.assertRaisesRegex(RuntimeError, "post_switch_verification_failed"):
            self.runner(failure)()
        self.assertEqual(os.readlink(self.base / "current"), self.plan["previous"])
        self.assertEqual(self.receipt()["status"], "rolled_back")
        self.assertEqual(len(self.requests), 5)

    def test_https_rollback_failure_is_explicit(self):
        def failure(_name, _release):
            raise OSError("synthetic permanent failure")
        with self.assertRaisesRegex(RuntimeError, "rollback_requires_review"):
            self.runner(failure)()
        self.assertEqual(os.readlink(self.base / "current"), self.plan["previous"])
        self.assertEqual(self.receipt()["status"], "rollback_unverified")

    def test_unknown_files_source_override_and_config_drift_stop(self):
        (self.source / "private.json").write_bytes(b"private")
        with self.assertRaisesRegex(RuntimeError, "candidate_file_set"):
            self.runner()()
        (self.source / "private.json").unlink()
        self.plan["source"] = str(self.old)
        self.pending.write_bytes(publish.encode(self.plan))
        with self.assertRaisesRegex(RuntimeError, "source_not_fixed_repo"):
            self.runner()()
        self.plan["source"] = str(self.source)
        self.pending.write_bytes(publish.encode(self.plan))
        self.config.write_bytes(b"changed config")
        with self.assertRaisesRegex(RuntimeError, "config_changed"):
            self.runner()()

    def test_existing_release_is_never_overwritten(self):
        target = self.base / "releases" / self.plan["release"]
        target.mkdir()
        (target / "sentinel.txt").write_bytes(b"existing")
        with self.assertRaisesRegex(RuntimeError, "release_already_exists"):
            self.runner()()
        self.assertEqual((target / "sentinel.txt").read_bytes(), b"existing")

    @unittest.skipUnless(os.name == "posix", "flock 是 Linux 发布入口契约")
    def test_existing_deployment_lock_stops(self):
        with publish.deployment_lock(self.base / "deployments"):
            with self.assertRaises(BlockingIOError):
                self.runner()()
        self.assertEqual(os.readlink(self.base / "current"), self.plan["previous"])

    @unittest.skipUnless(os.name == "posix", "发布权限是 Linux 入口契约")
    def test_restrictive_umask_keeps_public_release_and_receipt_readable(self):
        previous = os.umask(0o077)
        try:
            self.runner()()
        finally:
            os.umask(previous)
        release = self.base / "releases" / self.plan["release"]
        self.assertEqual(release.stat().st_mode & 0o777, 0o755)
        self.assertEqual((release / "assets").stat().st_mode & 0o777, 0o755)
        self.assertEqual((release / "assets/site.js").stat().st_mode & 0o777, 0o644)
        receipt = self.base / "maintenance-receipts" / (self.plan["release"] + ".json")
        self.assertEqual(receipt.stat().st_mode & 0o777, 0o644)


if __name__ == "__main__":
    unittest.main()
