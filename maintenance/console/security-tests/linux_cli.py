#!/usr/bin/env python3
"""隔离 /tmp 中执行真实 Linux CLI；随机凭据只在内存和合成私有目录中存在。"""

import argparse
import hashlib
import http.client
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import socket
import sqlite3
import stat
import subprocess
import sys
import tempfile
import time
import uuid


ROOT = Path(__file__).resolve().parents[3]
ORIGIN = "https://console-security.invalid"
EXPECTED_FILES = {
    "IP2REGION-LICENSE.txt", "THIRD-PARTY-NOTICES.txt", "public/admin.css",
    "public/admin.js", "public/index.html", "server.mjs",
}


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def digest(file):
    return hashlib.sha256(file.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--toolchain", type=Path, required=True)
    args = parser.parse_args()
    require(sys.platform == "linux", "必须在 Linux 中执行 POSIX 验证")
    os.umask(0o077)
    run_id = time.strftime("linux-%Y%m%dT%H%M%SZ", time.gmtime()) + "-" + secrets.token_hex(3)
    evidence = ROOT / "reports/console-security" / run_id
    evidence.mkdir(parents=True)
    scratch = Path(tempfile.mkdtemp(prefix="idol-console-security-", dir="/tmp"))
    cases = []
    secrets_to_reject = []
    captured = []
    processes = []
    metadata = {"scope": "本机 Linux 合成 CLI 验收；不是生产或冻结候选全量结论", "uid": os.getuid(), "cases": cases}

    def case(name, operation):
        try:
            operation()
            cases.append({"name": name, "passed": True})
            print(f"PASS {name}", flush=True)
        except Exception as error:
            # 不输出子进程正文、Cookie、密钥或随机密码。
            cases.append({"name": name, "passed": False, "reason": str(error)})
            print(f"FAIL {name}: {error}", flush=True)

    try:
        archive = args.toolchain / "node-v22.14.0-linux-x64.tar.xz"
        lines = (args.toolchain / "SHASUMS256.txt").read_text(encoding="utf-8").splitlines()
        sums = [line.split()[0] for line in lines if line.split()[-1:] == [archive.name]]
        require(len(sums) == 1 and re.fullmatch(r"[a-f0-9]{64}", sums[0]), "Node 校验清单缺失或歧义")
        require(digest(archive) == sums[0], "Node 归档与本地官方 SHASUMS256 不匹配")
        metadata["nodeArchiveSha256"] = sums[0]
        subprocess.run(["tar", "-xJf", str(archive), "-C", str(scratch)], check=True, capture_output=True, timeout=45)
        node = scratch / "node-v22.14.0-linux-x64/bin/node"
        version = subprocess.run([str(node), "--version"], capture_output=True, text=True, check=True).stdout.strip()
        require(version == "v22.14.0", "Node 版本不符")
        metadata["nodeVersion"] = version

        source = ROOT / ".build/console"
        actual_files = {str(file.relative_to(source)) for file in source.rglob("*") if file.is_file()}
        require(actual_files == EXPECTED_FILES | {"manifest.sha256"}, "实际发行目录存在清单外文件或缺失文件")
        require(all(not file.is_symlink() for file in source.rglob("*")), "实际发行目录存在符号链接")
        manifest = (source / "manifest.sha256").read_bytes()
        members = {}
        for line in manifest.decode("utf-8").splitlines():
            match = re.fullmatch(r"([a-f0-9]{64})  (.+)", line)
            require(match is not None and match[2] in EXPECTED_FILES and match[2] not in members, "发行清单非固定白名单或存在重复")
            members[match[2]] = match[1]
        require(set(members) == EXPECTED_FILES, "发行包文件不完整")
        release = scratch / "release"
        for name, checksum in members.items():
            file = source / name
            require(file.is_file() and not file.is_symlink() and file.stat().st_nlink == 1, "发行文件不是独占普通文件")
            data = file.read_bytes()
            require(hashlib.sha256(data).hexdigest() == checksum, "发行字节与清单不符")
            output = release / name
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_bytes(data)
        require((source / "manifest.sha256").read_bytes() == manifest, "复制期间发行候选发生变化")
        metadata["bundleManifestSha256"] = hashlib.sha256(manifest).hexdigest()
        metadata["bundleFiles"] = members
        (evidence / "bundle-manifest.sha256").write_bytes(manifest)

        geo = ROOT / "reports/console-geo"
        geo_manifest = json.loads((geo / "verified.json").read_text(encoding="utf-8"))
        for item in geo_manifest["files"]:
            require(item["name"] in {"ip2region_v4.xdb", "ip2region_v6.xdb"}, "地区库清单包含未知文件")
            require(digest(geo / item["name"]) == item["sha256"], "地区库校验失败")
        metadata["geoCommit"] = geo_manifest["commit"]
        base_env = {key: value for key, value in os.environ.items() if key not in {"NODE_OPTIONS", "LD_PRELOAD", "LD_LIBRARY_PATH", "IDOL_ADMIN_PASSWORD"}}

        def fixture(name):
            directory = scratch / name
            directory.mkdir(mode=0o700)
            password = secrets.token_urlsafe(32)
            secrets_to_reject.append(password.encode())
            return {"root": directory, "data": directory / "data", "key": directory / "keys/master.key", "password": password}

        def command(f, verb, port=None, overrides=None):
            options = {"data-dir": f["data"], "key-file": f["key"], "admin-dir": release / "public"}
            if verb == "init":
                options["username"] = "security_admin"
            else:
                options.update({"origin": ORIGIN, "port": port, "geo-dir": geo})
            options.update(overrides or {})
            return [str(node), str(release / "server.mjs"), verb] + [part for name, value in options.items() for part in ("--" + name, str(value))]

        def invoke(f, verb="init", port=28788, overrides=None):
            env = {**base_env, **({"IDOL_ADMIN_PASSWORD": f["password"]} if verb == "init" else {})}
            result = subprocess.run(command(f, verb, port, overrides), env=env, cwd=release, capture_output=True, timeout=8)
            captured.append(result.stdout + result.stderr)
            return result.returncode

        def account_payload(f):
            with sqlite3.connect(f["data"] / "console.sqlite") as db:
                row = db.execute("SELECT payload FROM records WHERE bucket='account' AND id='admin'").fetchone()
                return row[0] if row else None

        good = fixture("good")

        def initial():
            require(invoke(good) == 0, "真实 init 应成功")
            for file, mode in [(good["data"], 0o700), (good["key"].parent, 0o700), (good["key"], 0o600), (good["data"] / "console.sqlite", 0o600)]:
                info = file.lstat()
                require(stat.S_IMODE(info.st_mode) == mode and info.st_uid == os.getuid(), "创建后的属主或权限不符")
            require(good["key"].stat().st_size == 32 and account_payload(good).startswith("v1."), "密钥或账户密文格式不符")
        case("LINUX-01 init、真实 owner/mode 和账户认证加密", initial)

        def repeated():
            original_key = good["key"].read_bytes()
            original_account = account_payload(good)
            require(invoke(good) != 0, "重复 init 必须拒绝")
            require(good["key"].read_bytes() == original_key and account_payload(good) == original_account, "重复 init 改写了已有密钥或账户")
        case("LINUX-02 重复 init 拒绝并保留原账户/密钥", repeated)

        def recover():
            f = fixture("recover")
            f["key"].parent.mkdir(mode=0o700)
            key = secrets.token_bytes(32)
            f["key"].write_bytes(key)
            require(invoke(f) == 0 and f["key"].read_bytes() == key, "仅有旧密钥的初始化中断不能恢复")
        case("LINUX-03 初始化中断后用已有独立密钥恢复", recover)

        def missing_key():
            original = good["key"].read_bytes()
            good["key"].unlink()
            try:
                require(invoke(good) != 0 and not good["key"].exists(), "已有数据库无密钥时必须拒绝生成替代密钥")
            finally:
                good["key"].write_bytes(original)
        case("LINUX-04 既有数据库丢失密钥时不替换", missing_key)

        def wrong_key():
            original_key = good["key"].read_bytes()
            original_account = account_payload(good)
            good["key"].write_bytes(secrets.token_bytes(32))
            try:
                require(invoke(good, "serve") != 0, "错误密钥不应启动")
                require(account_payload(good) == original_account, "错误密钥覆盖了数据")
            finally:
                good["key"].write_bytes(original_key)
        case("LINUX-05 错误密钥启动失败且不改写私人记录", wrong_key)

        def weak_modes():
            for target, original, weak in [(good["data"], 0o700, 0o755), (good["key"].parent, 0o700, 0o755), (good["key"], 0o600, 0o644), (good["data"] / "console.sqlite", 0o600, 0o644)]:
                target.chmod(weak)
                try:
                    require(invoke(good, "serve") != 0, "宽松私人权限未被拒绝")
                finally:
                    target.chmod(original)
        case("LINUX-06 私有目录、密钥、数据库的宽松权限拒绝", weak_modes)

        def links():
            real = good["root"] / "real-key"
            good["key"].rename(real)
            try:
                good["key"].symlink_to(real)
                require(invoke(good, "serve") != 0, "密钥符号链接未拒绝")
                good["key"].unlink()
                os.link(real, good["key"])
                require(invoke(good, "serve") != 0, "密钥硬链接未拒绝")
                good["key"].unlink()
            finally:
                if good["key"].is_symlink() or good["key"].exists():
                    good["key"].unlink()
                real.rename(good["key"])
            alias = good["root"] / "data-alias"
            alias.symlink_to(good["data"], target_is_directory=True)
            require(invoke(good, "serve", overrides={"data-dir": alias}) != 0, "数据目录符号链接未拒绝")
            hardlink = good["root"] / "database-hardlink"
            os.link(good["data"] / "console.sqlite", hardlink)
            try:
                require(invoke(good, "serve") != 0, "SQLite 硬链接未拒绝")
            finally:
                hardlink.unlink()
        case("LINUX-07 密钥/数据库软硬链接拒绝", links)

        def isolation():
            f = fixture("isolated")
            alias = f["root"] / "public-alias"
            alias.symlink_to(release / "public", target_is_directory=True)
            escaped_key = alias / "must-not-create.key"
            require(invoke(f, overrides={"key-file": escaped_key}) != 0 and not escaped_key.exists(), "父目录符号链接绕过公开目录隔离")
            require(invoke(f, overrides={"key-file": f["data"] / "key"}) != 0, "密钥与数据库同目录未被拒绝")
            require(invoke(f, overrides={"admin-dir": f["data"] / "public"}) != 0, "数据目录包含公开目录未被拒绝")
            (f["root"] / ".git").mkdir()
            require(invoke(f) != 0 and not f["key"].exists(), "源码仓库内的私人运行态未被拒绝")
        case("LINUX-08 仓库、公开路径及父目录符号链接隔离", isolation)

        def occupied():
            with socket.socket() as listener:
                listener.bind(("127.0.0.1", 0))
                listener.listen()
                require(invoke(good, "serve", port=listener.getsockname()[1]) != 0, "占用端口时没有非零退出")
        case("LINUX-09 端口占用启动失败退出", occupied)

        def live():
            with socket.socket() as selector:
                selector.bind(("127.0.0.1", 0))
                port = selector.getsockname()[1]
            process = subprocess.Popen(command(good, "serve", port), cwd=release, env=base_env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            processes.append(process)

            def request(endpoint, method="GET", body=None, extra=None):
                headers = {"Origin": ORIGIN, "X-Console-Client-IP": "192.0.2.231", "Content-Type": "application/json", "User-Agent": "Security-acceptance Chrome/120"}
                headers.update(extra or {})
                connection = http.client.HTTPConnection("127.0.0.1", port, timeout=4)
                try:
                    connection.request(method, endpoint, json.dumps(body) if body is not None else None, headers)
                    response = connection.getresponse()
                    raw = response.read()
                    return response.status, dict(response.getheaders()), json.loads(raw)
                finally:
                    connection.close()

            deadline = time.monotonic() + 6
            while True:
                try:
                    require(request("/api/v1/public-config")[0] == 200, "公开配置不可用")
                    break
                except (ConnectionError, OSError):
                    require(process.poll() is None, "serve 在监听前退出")
                    require(time.monotonic() < deadline, "serve 启动超时")
                    time.sleep(0.05)
            try:
                require(request("/api/v1/admin/visits")[0] == 401, "匿名读取访问记录未拒绝")
                status, headers, payload = request("/api/v1/admin/login", "POST", {"username": "security_admin", "password": good["password"]})
                require(status == 200, "真实发行物登录失败")
                cookie = headers["Set-Cookie"].split(";")[0]
                csrf = payload["data"]["csrf"]
                secrets_to_reject.extend([cookie.split("=", 1)[1].encode(), csrf.encode()])
                auth = {"Cookie": cookie, "X-CSRF-Token": csrf}
                require(request("/api/v1/admin/system", extra=auth)[2]["data"]["geoReady"], "固定离线地区库不可用")
                body = {"kind": "feedback", "target": "LINUX-SYNTHETIC-TARGET", "source": "https://example.invalid/source", "details": "LINUX-SYNTHETIC-PRIVATE-DETAIL", "contact": "linux-synthetic@example.invalid", "consent": True, "website": "", "requestId": str(uuid.uuid4())}
                require(request("/api/v1/feedback", "POST", body)[0] == 201, "合成投稿失败")
                require(request("/api/v1/pageviews", "POST", {"id": str(uuid.uuid4()), "path": "/guide.html?secret=drop#drop", "referrer": "https://example.invalid/private?drop"})[0] == 200, "合成访问失败")
                require(request("/api/v1/admin/visits", extra=auth)[2]["data"]["items"][0]["ip"] == "192.0.2.231", "管理员完整 IP 读取不符")
                with sqlite3.connect(good["data"] / "console.sqlite") as database, sqlite3.connect(good["root"] / "backup.sqlite") as backup:
                    database.backup(backup)
                    require(database.execute("SELECT count(*) FROM records WHERE bucket='sessions'").fetchone()[0] > 0, "会话存储未实际发生")
                markers = secrets_to_reject + [item.encode() for item in [body["target"], body["details"], body["contact"], "192.0.2.231"]]
                inspected = list(good["data"].glob("console.sqlite*")) + [good["root"] / "backup.sqlite"]
                require(any(file.name.endswith("-wal") for file in inspected), "未覆盖正在运行的 WAL")
                for file in inspected:
                    info = file.lstat()
                    require(stat.S_IMODE(info.st_mode) == 0o600 and info.st_uid == os.getuid(), "运行态/备份 owner 或权限不符")
                    data = file.read_bytes()
                    require(all(marker not in data for marker in markers), "运行态或备份中发现合成私人明文")
                metadata["storageFilesInspected"] = [file.name for file in inspected]
                require(request("/api/v1/admin/logout-all", "POST", {}, auth)[0] == 200, "退出全部会话失败")
                require(request("/api/v1/admin/feedback", extra=auth)[0] == 401, "退出后 Cookie 仍可读取反馈")
            finally:
                process.terminate()
                stdout, stderr = process.communicate(timeout=12)
                captured.append(stdout + stderr)
                require(process.returncode == 0, "正常终止服务未清理退出")
        case("LINUX-10 发行物真实 HTTP、离线地区库、会话/IP/投稿加密与备份", live)

        def logs():
            joined = b"\n".join(captured)
            require(all(marker not in joined for marker in secrets_to_reject + [b"192.0.2.231", b"LINUX-SYNTHETIC-PRIVATE-DETAIL", b"linux-synthetic@example.invalid"]), "CLI stdout/stderr 泄露合成凭据或私人载荷")
            metadata["capturedProcessOutputs"] = len(captured)
            metadata["capturedOutputBytes"] = len(joined)
        case("LINUX-11 所有成功/失败 CLI 日志不含随机凭据和私人哨兵", logs)
        metadata["bundleChangedDuringRun"] = (source / "manifest.sha256").read_bytes() != manifest
        metadata["limitations"] = ["没有切换其他 Linux 用户或创建 root 所属夹具，外属主拒绝仅源码核对", "未安装或操作生产 Nginx/systemd", "备份只验证密文和权限，未验证线上备份期限"]
    except Exception as error:
        metadata["setupFailure"] = str(error)
        print(f"SETUP FAIL: {error}", flush=True)
    finally:
        for process in processes:
            if process.poll() is None:
                process.kill()
                process.communicate(timeout=3)
        # 临时目录由本次创建；严格检查绝对位置再删除。
        require(scratch.parent == Path("/tmp") and scratch.name.startswith("idol-console-security-") and not scratch.is_symlink(), "临时清理边界异常")
        shutil.rmtree(scratch)
        metadata["temporaryDirectoryRemoved"] = not scratch.exists()
        passed = not metadata.get("setupFailure") and len(cases) == 11 and all(item["passed"] for item in cases)
        metadata["passed"] = passed
        (evidence / "result.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"证据：{evidence.relative_to(ROOT)}", flush=True)
        print(f"用例：{sum(item['passed'] for item in cases)}/{len(cases)}；临时私人数据已清理", flush=True)
    return 0 if passed else 1


if __name__ == "__main__":
    sys.exit(main())
