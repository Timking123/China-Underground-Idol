"""固定本站的 root 发布助手：只复制静态白名单，不执行仓库代码。"""

from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import http.client
import gzip
import io
import json
import os
from pathlib import Path
import re
import socket
import ssl
import stat
import sys
import urllib.request
import uuid

BASE = Path("/srv/china-underground-idol")
CONFIG = Path("/etc/nginx/sites-available/idol.hi-veblen.com.conf")
ORIGIN = "https://idol.hi-veblen.com"
CONTROL = Path("/etc/china-underground-idol/maintenance-control.json")
MIGRATION_APPROVAL = Path("/root/idol-migration-tools-20260923/publication-approval.json")
REQUIRED = frozenset([
    "index.html", "discover.html", "geography.html", "groups.html", "group.html", "events.html",
    "guide.html", "contribute.html", "about.html", "app.css", "app.js", "data.js", "data/events.v1.json",
    "styles/site.css", "styles/events.css", "styles/content.css", "styles/groups.css",
    "styles/discover.css", "styles/geography.css", "assets/groups-data.js", "assets/site.js", "assets/events.js",
    "assets/contribute.js", "assets/groups.js", "assets/group.js", "assets/discover.js", "assets/geography.js", "assets/metrics.js",
    "favorites.html", "city.html", "subscriptions.html", "updates.html",
    "styles/preferences.css", "styles/city.css", "styles/subscriptions.css", "styles/updates.css",
    "assets/favorites.js", "assets/city.js", "assets/subscriptions.js", "assets/updates.js", "assets/public-artifacts.v1.json",
])
CITY_FILES = frozenset([
    "data/events.v1.json",
    "favorites.html", "city.html", "subscriptions.html", "updates.html",
    "styles/preferences.css", "styles/city.css", "styles/subscriptions.css", "styles/updates.css",
    "assets/favorites.js", "assets/city.js", "assets/subscriptions.js", "assets/updates.js", "assets/public-artifacts.v1.json",
])
GEOGRAPHY_FILES = frozenset(["geography.html", "styles/geography.css", "assets/geography.js"])
METRICS_FILES = frozenset(["assets/metrics.js"])
METRICS_REQUIRED = REQUIRED - CITY_FILES
MAP_REQUIRED = METRICS_REQUIRED - METRICS_FILES
PREVIOUS_REQUIRED = MAP_REQUIRED - GEOGRAPHY_FILES
CRITICAL = ("assets/site.js", "assets/events.js", "assets/groups.js", "assets/groups-data.js", "assets/geography.js", "assets/metrics.js")
IMAGE = re.compile(r"assets/(?:avatars|posters|group-visuals|profile-covers|weibo-api-avatar-candidates|weibo-avatars|weibo-cached-visuals)/g\d{3}[a-zA-Z0-9.-]*\.(?:png|jpe?g|webp|svg)")
EVENT_IMAGE = re.compile(r"assets/event-posters/[a-z0-9][a-z0-9_-]{0,95}\.(?:png|jpe?g|webp)")
ARTIFACT_MANIFEST = "assets/public-artifacts.v1.json"
GENERATED = re.compile(r"(?:groups/g\d{3,8}\.html|(?:groups|events)/index\.html|events/e-[a-z0-9][a-z0-9_-]{0,95}\.html|assets/page-data/groups/g\d{3,8}\.json|assets/page-data/catalog\.json|assets/prerender\.css|assets/media-optimized/manifest\.v1\.json|assets/media-optimized/[a-f0-9]{20}-\d+\.webp|feeds/v1/manifest\.json|feeds/v1/groups/g\d{3,8}\.ics|feeds/v1/cities/[0-9a-f]{2,192}\.ics)", re.ASCII)
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


def parse_manifest(raw, expected, count=None, *, allow_previous=False):
    require(digest(raw) == expected, "manifest_hash_mismatch")
    records = {}
    for line in raw.decode("utf-8").splitlines():
        match = re.fullmatch(r"([a-f0-9]{64})  ([A-Za-z0-9_./-]+)", line)
        require(match is not None, "invalid_manifest")
        checksum, name = match.groups()
        require(all(part not in ("", ".", "..") for part in name.split("/")), "manifest_path_escape")
        original = name[:-3] if name.endswith(".gz") else name
        require(original in REQUIRED or IMAGE.fullmatch(original) or EVENT_IMAGE.fullmatch(original) or GENERATED.fullmatch(original), "nonpublic_file")
        require(not name.endswith(".gz") or re.search(r"\.(?:html|css|js|json|ics|svg)$", original), "nonpublic_compressed_file")
        require(name not in records, "duplicate_manifest_file")
        records[name] = checksum
    # 前版仅兼容完整地图版或地图之前的完整清单；统计不能与半套地图混装。
    complete = REQUIRED.issubset(records)
    metrics_previous = allow_previous and METRICS_REQUIRED.issubset(records) and CITY_FILES.isdisjoint(records)
    map_previous = allow_previous and MAP_REQUIRED.issubset(records) and (METRICS_FILES | CITY_FILES).isdisjoint(records)
    previous = allow_previous and PREVIOUS_REQUIRED.issubset(records) and (GEOGRAPHY_FILES | METRICS_FILES | CITY_FILES).isdisjoint(records)
    require((complete or metrics_previous or map_previous or previous) and len(records) <= 10000, "manifest_missing_entry")
    require(count is None or len(records) == count, "manifest_count_mismatch")
    return records


def verify_site(root, expected, count=None, *, allow_previous=False):
    raw = read_regular(root / "manifest.sha256", 2_000_000)
    records = parse_manifest(raw, expected, count, allow_previous=allow_previous)
    require(names_below(root) == set(records) | {"manifest.sha256"}, "candidate_file_set")
    total = 0
    for name, checksum in records.items():
        contents = read_regular(root / name)
        total += len(contents)
        require(total <= MAX_TOTAL and digest(contents) == checksum, "candidate_hash_or_total")
        if name.endswith(".gz"):
            original = name[:-3]
            require(original in records, "compressed_original_missing")
            with gzip.GzipFile(fileobj=io.BytesIO(contents)) as stream:
                expanded = stream.read(MAX_FILE + 1)
            require(len(expanded) <= MAX_FILE and digest(expanded) == records[original], "compressed_content_mismatch")
    if ARTIFACT_MANIFEST in records:
        manifest = json.loads(read_regular(root / ARTIFACT_MANIFEST))
        require(isinstance(manifest, dict) and set(manifest) == {"schemaVersion", "files"} and manifest["schemaVersion"] == "idol-public-artifacts-v1" and isinstance(manifest["files"], list) and len(manifest["files"]) <= 9000, "artifact_manifest_invalid")
        registered = set()
        for item in manifest["files"]:
            require(isinstance(item, dict) and set(item) == {"path", "sha256", "bytes"}, "artifact_entry_invalid")
            name = item["path"]
            require(isinstance(name, str) and GENERATED.fullmatch(name) and name not in registered, "artifact_path_invalid")
            require(isinstance(item["sha256"], str) and re.fullmatch(r"[a-f0-9]{64}", item["sha256"]) and records.get(name) == item["sha256"], "artifact_hash_invalid")
            require(type(item["bytes"]) is int and 0 < item["bytes"] <= MAX_FILE and (root / name).stat().st_size == item["bytes"], "artifact_size_invalid")
            registered.add(name)
        require(all(not GENERATED.fullmatch(name[:-3] if name.endswith(".gz") else name) or (name[:-3] if name.endswith(".gz") else name) in registered for name in records), "unregistered_artifact")
    else:
        require(not any(GENERATED.fullmatch(name) for name in records), "artifact_manifest_missing")
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


class LocalHTTPSConnection(http.client.HTTPSConnection):
    """迁移发布在 DNS 切换前回读新机，同时保持本站主机名与证书校验。"""

    def connect(self):
        self.sock = socket.create_connection(("127.0.0.1", 443), self.timeout, self.source_address)
        self.sock = self._context.wrap_socket(self.sock, server_hostname=self.host)


def fetch_loopback_https(name, release):
    connection = LocalHTTPSConnection("idol.hi-veblen.com", 443, timeout=25, context=ssl.create_default_context())
    try:
        connection.request("GET", f"/{name}?deployment={release}", headers={"Cache-Control": "no-cache"})
        response = connection.getresponse()
        require(response.status == 200, "https_status")
        raw = response.read(MAX_FILE + 1)
        require(len(raw) <= MAX_FILE, "https_too_large")
        return raw
    finally:
        connection.close()


def maintenance_mode(control=CONTROL):
    """root 持久开关；缺失、损坏、可由业务账户替换时一律关闭发布。"""
    try:
        for part in [*reversed(control.parents), control]:
            st = part.lstat()
            require(not stat.S_ISLNK(st.st_mode), "maintenance_control_invalid")
            if os.name == "posix":
                require(st.st_uid == 0 and st.st_mode & 0o022 == 0, "maintenance_control_invalid")
        value = json.loads(read_regular(control, 1024))
        require(set(value) == {"schemaVersion", "mode"} and value["schemaVersion"] == "idol-maintenance-control-v1" and value["mode"] in ("paused", "enabled"), "maintenance_control_invalid")
    except Exception:
        raise RuntimeError("maintenance_control_invalid") from None
    return value["mode"]


def assert_maintenance_enabled(control=CONTROL):
    require(maintenance_mode(control) == "enabled", "maintenance_paused")


def private_root_file(target):
    """批准文件不能由维护账户替换；Linux 逐层拒绝链接和可写祖先。"""
    ordinary_directory(target.parent)
    for part in [*reversed(target.parents), target]:
        st = part.lstat()
        require(not stat.S_ISLNK(st.st_mode), "migration_approval_link")
        if os.name == "posix":
            require(st.st_uid == 0 and st.st_mode & 0o022 == 0, "migration_approval_owner")
            if part in (target, target.parent):
                require(st.st_mode & 0o077 == 0, "migration_approval_not_private")
    return read_regular(target, 16_000)


class MigrationAuthorization:
    """只绑定本站一次静态发布；从不改变维护开关或启动后台写入。"""
    def __init__(self, expected_sha, *, approval=MIGRATION_APPROVAL,
                 now=lambda: datetime.now(timezone.utc), read=private_root_file,
                 control=lambda: maintenance_mode()):
        require(isinstance(expected_sha, str) and re.fullmatch(r"[a-f0-9]{64}", expected_sha), "migration_approval_sha")
        self.approval, self.now, self.read, self.control = Path(approval), now, read, control
        self.raw = read(self.approval)
        require(digest(self.raw) == expected_sha, "migration_approval_hash")
        self.value = json.loads(self.raw)
        keys = {"schemaVersion", "status", "transactionId", "issuedAt", "expiresAt", "requestSha256", "previous", "previousManifestSha256", "source", "manifestSha256", "newSha", "release"}
        require(isinstance(self.value, dict) and set(self.value) == keys and self.value["schemaVersion"] == "idol-migration-publication-approval-v1" and self.value["status"] == "approved", "migration_approval_schema")
        require(re.fullmatch(r"migration-20260923-[a-z0-9-]{1,48}", self.value["transactionId"]), "migration_transaction_id")
        self.issued = datetime.fromisoformat(self.value["issuedAt"].replace("Z", "+00:00"))
        self.expires = datetime.fromisoformat(self.value["expiresAt"].replace("Z", "+00:00"))
        require(self.issued.tzinfo is not None and self.expires.tzinfo is not None and 0 < (self.expires - self.issued).total_seconds() <= 900, "migration_approval_lifetime")
        self.intent = self.approval.parent / (self.value["transactionId"] + ".intent.json")
        self.result = self.approval.parent / (self.value["transactionId"] + ".result.json")

    def guard(self):
        require(self.read(self.approval) == self.raw, "migration_approval_changed")
        require(self.control() == "paused", "migration_requires_paused_maintenance")

    def bind(self, plan, request_hash):
        self.guard()
        require(self.value["requestSha256"] == request_hash, "migration_request_binding")
        for name in ("previous", "previousManifestSha256", "source", "manifestSha256", "newSha", "release"):
            require(self.value[name] == plan[name], "migration_candidate_binding")

    def valid_time(self):
        require(self.issued <= self.now() < self.expires, "migration_approval_expired")

    def inspect_existing(self, plan, request_hash, current):
        # 已开始或结果不明的事务只读当前态后停下，不能复用令牌新建第二次发布。
        if self.intent.exists() or self.intent.is_symlink() or self.result.exists() or self.result.is_symlink():
            if self.intent.exists():
                saved = json.loads(self.read(self.intent))
                require(saved.get("requestSha256") == request_hash, "migration_intent_conflict")
            require(current.is_symlink(), "migration_current_requires_review")
            require(os.readlink(current) in (plan["previous"], "releases/" + plan["release"]), "migration_current_requires_review")
            raise RuntimeError("migration_started_requires_review")

    def begin(self, plan, request_hash, current):
        self.bind(plan, request_hash)
        self.inspect_existing(plan, request_hash, current)
        self.valid_time()
        write_exclusive(self.intent, encode({"schemaVersion": "idol-migration-publication-intent-v1", "transactionId": self.value["transactionId"], "requestSha256": request_hash, "previous": plan["previous"], "release": plan["release"], "startedAt": self.now().isoformat()}), 0o600)
        fsync_directory(self.intent.parent)

    def finish(self, receipt):
        write_exclusive(self.result, encode({"schemaVersion": "idol-migration-publication-result-v1", "transactionId": self.value["transactionId"], "receipt": receipt}), 0o600)
        fsync_directory(self.result.parent)


def create_publisher(*, base=BASE, config=CONFIG, fetch=fetch_https, lock=deployment_lock, guard=assert_maintenance_enabled, migration=None):
    """路径/网络注入只供导入后的测试使用；CLI 无任何可变路径入口。"""
    base, config = Path(base), Path(config)
    repo = base / "maintenance" / "repo"
    state_root = base / "maintenance" / "state"
    pending = state_root / "publish" / "pending.json"
    deployments = base / "deployments"
    receipts = base / "maintenance-receipts"
    if migration is not None:
        guard = migration.guard
        if fetch is fetch_https:
            fetch = fetch_loopback_https

    def run():
        guard()
        if not pending.exists() and not pending.is_symlink():
            return {"status": "noop"}
        ordinary_directory(base)
        ordinary_directory(deployments)
        ordinary_directory(receipts)
        with lock(deployments):
            guard()
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
            if migration is not None:
                migration.bind(plan, request_hash)
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
            old_raw, old_records = verify_site(old, plan["previousManifestSha256"], allow_previous=True)
            candidate_raw, records = verify_site(source, plan["manifestSha256"], plan["publicFileCount"])
            if migration is not None:
                migration.inspect_existing(plan, request_hash, base / "current")
            require(not new.exists() and not new.is_symlink(), "release_already_exists")
            if migration is not None:
                migration.begin(plan, request_hash, base / "current")
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
                # 暂停阻止新发布；已经切换后的失败回退仍须允许恢复已验证前像。
                if destination != plan["previous"]:
                    guard()
                    if migration is not None:
                        migration.valid_time()
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
                    # 新候选已强制含地图；旧版回滚仅核验其固定清单声明的关键脚本。
                    if name in checksums:
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
                    verify_site(old, digest(old_raw), allow_previous=True)
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
            if migration is not None:
                migration.finish(receipt)
            require(status == "published", error_code)
            return {"status": status, "receiptPath": str(receipt_path)}
    return run


if __name__ == "__main__":
    try:
        args = sys.argv[1:]
        manual = len(args) == 4 and args[0] == "--migration-approval" and args[1] == str(MIGRATION_APPROVAL) and args[2] == "--approval-sha256"
        require((args in ([], ["--check-maintenance"]) or manual) and sys.platform.startswith("linux") and sys.flags.isolated == 1 and os.geteuid() == 0, "fixed_isolated_root_linux_entry_only")
        if manual:
            print(json.dumps(create_publisher(migration=MigrationAuthorization(args[3]))(), ensure_ascii=False))
        elif args:
            assert_maintenance_enabled()
        else:
            print(json.dumps(create_publisher()(), ensure_ascii=False))
    except Exception as error:
        code = str(error) if re.fullmatch(r"[a-z_]{1,80}", str(error)) else "publication_failed_review_local_state"
        print("发布停止：" + code, file=sys.stderr)
        sys.exit(1)
