"""从 root 持有的审核快照安装固定 systemd 服务，不执行运行用户目录中的代码。"""

import argparse
import hashlib
import json
import os
from pathlib import Path
import stat
import subprocess

TARGETS = {
    "supervisor.sh": ("/usr/local/libexec/idol-maintenance-supervisor.sh", 0o755),
    "publish.py": ("/usr/local/libexec/idol-maintenance-publish.py", 0o644),
    "systemd/idol-maintenance@.service": ("/etc/systemd/system/idol-maintenance@.service", 0o644),
    **{f"systemd/idol-maintenance-{kind}.timer": (f"/etc/systemd/system/idol-maintenance-{kind}.timer", 0o644) for kind in ("daily", "weekly", "health")},
}


def trusted(path, directory=False):
    info = path.lstat()
    if info.st_uid != 0 or info.st_mode & 0o022 or stat.S_ISLNK(info.st_mode):
        raise RuntimeError("root_owned_nonwritable_path_required")
    if directory and not stat.S_ISDIR(info.st_mode):
        raise RuntimeError("directory_required")
    if not directory and (not stat.S_ISREG(info.st_mode) or info.st_nlink != 1):
        raise RuntimeError("single_regular_file_required")


def trusted_ancestors(path):
    for parent in reversed(path.parents):
        trusted(parent, directory=True)


def install(source, expected):
    if os.geteuid() != 0:
        raise RuntimeError("root_required")
    for name in ("LD_PRELOAD", "LD_LIBRARY_PATH", "PYTHONPATH", "PYTHONHOME", "NODE_OPTIONS", "BASH_ENV", "ENV"):
        os.environ.pop(name, None)
    source = source.absolute()
    trusted_ancestors(source)
    trusted(source, directory=True)
    manifest_path = source / "install-manifest.json"
    trusted(manifest_path)
    raw = manifest_path.read_bytes()
    if hashlib.sha256(raw).hexdigest() != expected:
        raise RuntimeError("manifest_sha_mismatch")
    manifest = json.loads(raw)
    if set(manifest) != set(TARGETS):
        raise RuntimeError("manifest_file_set_mismatch")
    entries = []
    for relative, (destination, mode) in TARGETS.items():
        origin = source / relative
        trusted_ancestors(origin)
        trusted(origin)
        data = origin.read_bytes()
        if hashlib.sha256(data).hexdigest() != manifest[relative]:
            raise RuntimeError("source_sha_mismatch")
        target = Path(destination)
        if not target.parent.exists() and str(target.parent) == "/usr/local/libexec":
            trusted_ancestors(target.parent)
            target.parent.mkdir(mode=0o755)
        trusted_ancestors(target)
        if target.exists() or target.is_symlink():
            trusted(target)
            if target.read_bytes() != data:
                raise RuntimeError("existing_service_differs_requires_versioned_upgrade")
        entries.append((target, data, mode))
    receipt_root = Path("/srv/china-underground-idol/maintenance-receipts")
    trusted_ancestors(receipt_root)
    if not receipt_root.exists():
        receipt_root.mkdir(mode=0o755)
        receipt_root.chmod(0o755)
    trusted(receipt_root, directory=True)
    if receipt_root.stat().st_mode & 0o005 != 0o005:
        raise RuntimeError("receipt_directory_not_readable")
    for parent in receipt_root.parents:
        if parent.stat().st_mode & 0o001 != 0o001:
            raise RuntimeError("receipt_parent_not_traversable")
    for target, data, mode in entries:
        if target.exists():
            continue
        descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
    environment = {"PATH": "/usr/sbin:/usr/bin:/sbin:/bin", "LANG": "C.UTF-8"}
    subprocess.run(["/usr/bin/systemd-analyze", "verify", "/etc/systemd/system/idol-maintenance@.service", *[f"/etc/systemd/system/idol-maintenance-{kind}.timer" for kind in ("daily", "weekly", "health")]], check=True, env=environment)
    subprocess.run(["/usr/bin/systemctl", "daemon-reload"], check=True, env=environment)
    return {"installed": len(entries), "timersEnabled": False, "manifestSha256": expected}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--sha256", required=True)
    args = parser.parse_args()
    print(json.dumps(install(args.source, args.sha256)))
