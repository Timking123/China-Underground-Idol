"""固定本站的 root 发布助手：只复制静态白名单，不执行仓库代码。"""

from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys
import urllib.request
import uuid

BASE = Path("/srv/china-underground-idol")
CONFIG = Path("/etc/nginx/sites-available/idol.hi-veblen.com.conf")
ORIGIN = "https://idol.hi-veblen.com"
REQUIRED = frozenset([
    "index.html", "discover.html", "groups.html", "group.html", "events.html",
    "guide.html", "contribute.html", "about.html", "app.css", "app.js", "data.js",
    "styles/site.css", "styles/events.css", "styles/content.css", "styles/groups.css",
    "styles/discover.css", "assets/groups-data.js", "assets/site.js", "assets/events.js",
    "assets/contribute.js", "assets/groups.js", "assets/group.js", "assets/discover.js",
])
CRITICAL = ("assets/site.js", "assets/events.js", "assets/groups.js", "assets/groups-data.js")
IMAGE = re.compile(r"assets/(?:avatars|posters|group-visuals|profile-covers|weibo-api-avatar-candidates|weibo-avatars|weibo-cached-visuals)/g\d{3}[a-zA-Z0-9.-]*\.(?:png|jpe?g|webp|svg)")
EVENT_IMAGE = re.compile(r"assets/event-posters/[a-z0-9][a-z0-9_-]{0,95}\.(?:png|jpe?g|webp)")
MAX_FILE = 20_000_000
MAX_TOTAL = 512_000_000
REQUEST_KEYS = frozenset([
    "schemaVersion", "runId", "release", "source", "repoRoot", "baseSha", "newSha",
    "manifestSha256", "publicFileCount", "previous", "previousManifestSha256",
    "configSha256", "verificationSha256",
])


def require(condition, code):
    if not condition:
        raise RuntimeError(code)


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def encode(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode()


def ordinary_directory(path):
    require(path.is_absolute(), "absolute_path_required")
    for part in [*reversed(path.parents), path]:
        st = part.lstat()
        require(stat.S_ISDIR(st.st_mode) and not stat.S_ISLNK(st.st_mode), "directory_link_or_type")


def read_regular(path, limit=MAX_FILE):
    """Linux 使用目录描述符逐层 O_NOFOLLOW，避免 root 跟随可写父目录链接。"""
    require(path.is_absolute() and ".." not in path.parts, "path_escape")
    if os.name == "posix":
        fd = os.open(path.anchor, os.O_RDONLY | os.O_DIRECTORY)
        try:
            for component in path.parts[1:-1]:
                next_fd = os.open(component, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
                os.close(fd)
                fd = next_fd
            target = os.open(path.name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=fd)
        finally:
            os.close(fd)
    else:
        # 非生产宿主仅供同一套离线测试；正式 CLI 要求 Linux。
        ordinary_directory(path.parent)
        require(not path.is_symlink(), "file_link")
        target = os.open(path, os.O_RDONLY)
    with os.fdopen(target, "rb") as stream:
        st = os.fstat(stream.fileno())
        require(stat.S_ISREG(st.st_mode) and st.st_nlink == 1 and st.st_size <= limit, "file_type_or_size")
        raw = stream.read(limit + 1)
        require(len(raw) <= limit, "file_too_large")
        return raw


def names_below(root):
    ordinary_directory(root)
    result = set()
    def visit(directory):
        with os.scandir(directory) as entries:
            for entry in entries:
                require(not entry.is_symlink(), "candidate_link")
                if entry.is_dir(follow_symlinks=False):
                    visit(Path(entry.path))
                else:
                    require(entry.is_file(follow_symlinks=False), "candidate_special_file")
                    result.add(Path(entry.path).relative_to(root).as_posix())
    visit(root)
    return result


def parse_manifest(raw, expected, count=None):
    require(digest(raw) == expected, "manifest_hash_mismatch")
    records = {}
    for line in raw.decode("utf-8").splitlines():
        match = re.fullmatch(r"([a-f0-9]{64})  ([A-Za-z0-9_./-]+)", line)
        require(match is not None, "invalid_manifest")
        checksum, name = match.groups()
        require(all(part not in ("", ".", "..") for part in name.split("/")), "manifest_path_escape")
        require(name in REQUIRED or IMAGE.fullmatch(name) or EVENT_IMAGE.fullmatch(name), "nonpublic_file")
        require(name not in records, "duplicate_manifest_file")
        records[name] = checksum
    require(REQUIRED.issubset(records) and len(records) <= 10000, "manifest_missing_entry")
    require(count is None or len(records) == count, "manifest_count_mismatch")
    return records


def verify_site(root, expected, count=None):
    raw = read_regular(root / "manifest.sha256", 2_000_000)
    records = parse_manifest(raw, expected, count)
    require(names_below(root) == set(records) | {"manifest.sha256"}, "candidate_file_set")
    total = 0
    for name, checksum in records.items():
        contents = read_regular(root / name)
        total += len(contents)
        require(total <= MAX_TOTAL and digest(contents) == checksum, "candidate_hash_or_total")
    return raw, records


def write_exclusive(target, raw, mode=0o644):
    ordinary_directory(target.parent)
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
    fd = os.open(target, flags, mode)
    with os.fdopen(fd, "wb") as stream:
        stream.write(raw)
        stream.flush()
        os.fchmod(stream.fileno(), mode)
        os.fsync(stream.fileno())


def fsync_directory(directory):
    if os.name == "posix":
        fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)


@contextmanager
def deployment_lock(directory):
    import fcntl
    ordinary_directory(directory)
    fd = os.open(directory / ".release.lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        require(os.fstat(fd).st_nlink == 1, "lock_hardlink")
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield
    finally:
        os.close(fd)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_args, **_kwargs):
        raise RuntimeError("https_redirect_rejected")


def fetch_https(name, release):
    # 名称只能来自已经通过独立白名单的清单；域名与协议不可由请求指定。
    url = f"{ORIGIN}/{name}?deployment={release}"
    request = urllib.request.Request(url, headers={"Cache-Control": "no-cache"})
    with urllib.request.build_opener(NoRedirect()).open(request, timeout=25) as response:
        require(response.status == 200, "https_status")
        raw = response.read(MAX_FILE + 1)
        require(len(raw) <= MAX_FILE, "https_too_large")
        return raw


def create_publisher(*, base=BASE, config=CONFIG, fetch=fetch_https, lock=deployment_lock):
    """路径/网络注入只供导入后的测试使用；CLI 无任何可变路径入口。"""
    base, config = Path(base), Path(config)
    repo = base / "maintenance" / "repo"
    state_root = base / "maintenance" / "state"
    pending = state_root / "publish" / "pending.json"
    deployments = base / "deployments"
    receipts = base / "maintenance-receipts"

    def run():
        if not pending.exists() and not pending.is_symlink():
            return {"status": "noop"}
        ordinary_directory(base)
        ordinary_directory(deployments)
        ordinary_directory(receipts)
        with lock(deployments):
            raw = read_regular(pending, 64_000)
            request_hash = digest(raw)
            plan = json.loads(raw)
            require(isinstance(plan, dict) and set(plan) == REQUEST_KEYS, "request_schema")
            require(plan["schemaVersion"] == "idol-publish-request-v1", "request_version")
            require(isinstance(plan["runId"], str) and re.fullmatch(r"[a-z0-9][a-z0-9-]{0,90}", plan["runId"]), "run_id")
            require(re.fullmatch(r"auto-\d{4}-\d{2}-\d{2}-[a-f0-9]{12}", plan["release"]), "release_name")
            for field in ("baseSha", "newSha"):
                require(isinstance(plan[field], str) and re.fullmatch(r"[a-f0-9]{40}", plan[field]), "git_sha")
            require(plan["release"].endswith(plan["newSha"][:12]) and plan["baseSha"] != plan["newSha"], "release_head_binding")
            require(re.fullmatch(r"releases/[a-z0-9][a-z0-9-]{1,90}", plan["previous"]), "previous_name")
            require(plan["previous"] != "releases/" + plan["release"], "same_release")
            for field in ("manifestSha256", "previousManifestSha256", "configSha256", "verificationSha256"):
                require(isinstance(plan[field], str) and re.fullmatch(r"[a-f0-9]{64}", plan[field]), "invalid_hash")
            require(type(plan["publicFileCount"]) is int and 1 <= plan["publicFileCount"] <= 10000, "file_count")
            source = repo / ".build" / "site"
            require(plan["source"] == str(source) and plan["repoRoot"] == str(repo), "source_not_fixed_repo")
            verification_path = state_root / "publish" / "verified" / (plan["runId"] + ".json")
            verified_raw = read_regular(verification_path, 64_000)
            require(digest(verified_raw) == plan["verificationSha256"], "verification_hash")
            verified = json.loads(verified_raw)
            require(verified.get("schemaVersion") == "idol-publication-verified-v1", "verification_schema")
            for field in ("runId", "newSha", "baseSha", "manifestSha256", "source", "repoRoot"):
                require(verified.get(field) == plan[field], "verification_binding")
            require(verified.get("gitPushVerified") is True and verified.get("browserVerified") is True, "verification_incomplete")
            receipt_path = receipts / (plan["release"] + ".json")
            if receipt_path.exists() or receipt_path.is_symlink():
                receipt = json.loads(read_regular(receipt_path, 64_000))
                require(receipt.get("requestSha256") == request_hash, "existing_receipt_conflict")
                if receipt.get("status") == "published":
                    require(os.readlink(base / "current") == "releases/" + plan["release"], "completed_release_drift")
                    return {"status": "already_published", "receiptPath": str(receipt_path)}
                raise RuntimeError("previous_publication_failed")

            old = base / plan["previous"]
            new = base / "releases" / plan["release"]
            ordinary_directory(base / "releases")
            def check_preimage(expected_current):
                require(read_regular(pending, 64_000) == raw, "pending_changed")
                require(read_regular(verification_path, 64_000) == verified_raw, "verification_changed")
                require(digest(read_regular(config, 2_000_000)) == plan["configSha256"], "config_changed")
                require((base / "current").is_symlink() and os.readlink(base / "current") == expected_current, "current_changed")

            check_preimage(plan["previous"])
            old_raw, old_records = verify_site(old, plan["previousManifestSha256"])
            candidate_raw, records = verify_site(source, plan["manifestSha256"], plan["publicFileCount"])
            require(not new.exists() and not new.is_symlink(), "release_already_exists")
            new.mkdir(mode=0o755)
            new.chmod(0o755)
            for name, checksum in records.items():
                contents = read_regular(source / name)
                require(digest(contents) == checksum, "source_changed_during_copy")
                directory = new
                for component in Path(name).parts[:-1]:
                    directory = directory / component
                    directory.mkdir(exist_ok=True, mode=0o755)
                    ordinary_directory(directory)
                    directory.chmod(0o755)
                write_exclusive(new / name, contents)
            write_exclusive(new / "manifest.sha256", candidate_raw)
            verify_site(new, plan["manifestSha256"], plan["publicFileCount"])
            check_preimage(plan["previous"])

            def switch(expected, destination):
                require(os.readlink(base / "current") == expected, "switch_current_changed")
                temporary = base / (".current-maintenance-" + uuid.uuid4().hex)
                temporary.symlink_to(destination)
                try:
                    require(os.readlink(base / "current") == expected, "switch_preimage_changed")
                    os.replace(temporary, base / "current")
                    fsync_directory(base)
                finally:
                    if temporary.is_symlink():
                        temporary.unlink()

            def check_https(manifest_hash, checksums, release):
                require(digest(fetch("manifest.sha256", release)) == manifest_hash, "https_manifest_mismatch")
                for name in CRITICAL:
                    require(digest(fetch(name, release)) == checksums[name], "https_bundle_mismatch")

            target = "releases/" + plan["release"]
            switch(plan["previous"], target)
            status, error_code = "published", None
            try:
                check_https(plan["manifestSha256"], records, plan["release"])
                check_preimage(target)
            except Exception:
                status, error_code = "rolled_back", "post_switch_verification_failed"
                try:
                    verify_site(old, digest(old_raw))
                    switch(target, plan["previous"])
                    check_https(plan["previousManifestSha256"], old_records, Path(plan["previous"]).name)
                except Exception:
                    status, error_code = "rollback_unverified", "rollback_requires_review"
            receipt = {
                "schemaVersion": "idol-publication-receipt-v1", "status": status,
                "release": plan["release"], "newSha": plan["newSha"], "runId": plan["runId"],
                "requestSha256": request_hash, "manifestSha256": plan["manifestSha256"],
                "previous": plan["previous"], "checkedAt": datetime.now(timezone.utc).isoformat(),
                "errorCode": error_code,
            }
            write_exclusive(receipt_path, encode(receipt))
            fsync_directory(receipts)
            require(status == "published", error_code)
            return {"status": status, "receiptPath": str(receipt_path)}
    return run


if __name__ == "__main__":
    try:
        require(len(sys.argv) == 1 and sys.platform.startswith("linux") and sys.flags.isolated == 1 and os.geteuid() == 0, "fixed_isolated_root_linux_entry_only")
        print(json.dumps(create_publisher()(), ensure_ascii=False))
    except Exception as error:
        code = str(error) if re.fullmatch(r"[a-z_]{1,80}", str(error)) else "publication_failed_review_local_state"
        print("发布停止：" + code, file=sys.stderr)
        sys.exit(1)
