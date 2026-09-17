#!/usr/bin/env python3
"""Linux 临时夹具中验证真实静态发布/回滚；HTTPS 只使用本地字节替身。"""

import hashlib
import json
import os
from pathlib import Path
import secrets
import shutil
import sys
import tempfile
import time
import types


ROOT = Path(__file__).resolve().parents[3]


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def main():
    require(sys.platform == "linux", "本测试要求真实 Linux 文件与锁语义")
    os.umask(0o077)
    identifier = time.strftime("publication-%Y%m%dT%H%M%SZ", time.gmtime()) + "-" + secrets.token_hex(3)
    evidence = ROOT / "reports/console-security" / identifier
    evidence.mkdir(parents=True)
    source = ROOT / "maintenance/publish.py"
    source_bytes = source.read_bytes()
    (evidence / "publish.py.snapshot").write_bytes(source_bytes)
    # 从记录哈希的字节加载，不生成共享目录内的 pycache，也不执行正式 CLI。
    publish = types.ModuleType("isolated_security_publish")
    publish.__file__ = str(source)
    exec(compile(source_bytes, str(source), "exec"), publish.__dict__)
    scratch = Path(tempfile.mkdtemp(prefix="idol-console-security-publication-", dir="/tmp"))
    results = []
    metadata = {
        "scope": "Linux 合成发布/回滚及公开候选文件检查；HTTPS 为本地替身，未访问生产",
        "publisherSha256": sha(source_bytes),
        "testSha256": sha(Path(__file__).read_bytes()),
        "cases": results,
    }

    def case(name, operation):
        try:
            operation()
            results.append({"name": name, "passed": True})
            print("PASS " + name, flush=True)
        except Exception as error:
            results.append({"name": name, "passed": False, "reason": str(error)})
            print("FAIL " + name + ": " + str(error), flush=True)

    def rejected(operation, code):
        try:
            operation()
        except RuntimeError as error:
            require(str(error) == code, "拒绝原因不符：" + str(error))
        else:
            raise AssertionError("应当拒绝，但操作成功")

    def manifest(directory):
        names = sorted(file.relative_to(directory).as_posix() for file in directory.rglob("*") if file.is_file() and file.name != "manifest.sha256")
        raw = "".join(sha((directory / name).read_bytes()) + "  " + name + "\n" for name in names).encode()
        (directory / "manifest.sha256").write_bytes(raw)
        return sha(raw), len(names)

    def fixture(previous):
        base = scratch / secrets.token_hex(5)
        repo = base / "maintenance/repo"
        candidate = repo / ".build/site"
        old = base / "releases/previous-release"
        for directory, names, label in [(candidate, publish.REQUIRED, "new"), (old, previous, "old")]:
            for name in names:
                file = directory / name
                file.parent.mkdir(parents=True, exist_ok=True)
                file.write_bytes((label + ":" + name).encode())
        (base / "deployments").mkdir()
        (base / "maintenance-receipts").mkdir()
        config = base / "nginx.conf"
        config.write_bytes(b"synthetic isolated configuration\n")
        (base / "current").symlink_to("releases/previous-release", target_is_directory=True)
        private = base / "private-runtime"
        private.mkdir()
        private_files = [private / "console.sqlite", private / "encryption.key"]
        for file in private_files:
            file.write_bytes(secrets.token_bytes(64))
        private_before = {file: sha(file.read_bytes()) for file in private_files}
        plan = {
            "schemaVersion": "idol-publish-request-v1", "runId": "security-synthetic",
            "release": "auto-2026-09-17-" + "b" * 12, "source": str(candidate),
            "repoRoot": str(repo), "baseSha": "a" * 40, "newSha": "b" * 40,
            "previous": "releases/previous-release", "configSha256": sha(config.read_bytes()),
        }

        def bind():
            plan["manifestSha256"], plan["publicFileCount"] = manifest(candidate)
            plan["previousManifestSha256"], _ = manifest(old)
            verified = {key: plan[key] for key in ("runId", "baseSha", "newSha", "source", "repoRoot", "manifestSha256")}
            verified.update(schemaVersion="idol-publication-verified-v1", gitPushVerified=True, browserVerified=True)
            raw = publish.encode(verified)
            verification = base / "maintenance/state/publish/verified/security-synthetic.json"
            verification.parent.mkdir(parents=True, exist_ok=True)
            verification.write_bytes(raw)
            plan["verificationSha256"] = sha(raw)
            (verification.parent.parent / "pending.json").write_bytes(publish.encode(plan))

        def run(fail_new=False):
            def fetch(name, release):
                if fail_new and release == plan["release"] and name == "assets/metrics.js":
                    return b"synthetic post-switch checksum mismatch"
                return (base / os.readlink(base / "current") / name).read_bytes()
            return publish.create_publisher(base=base, config=config, fetch=fetch)()

        def private_unchanged():
            require(all(file.exists() and sha(file.read_bytes()) == checksum for file, checksum in private_before.items()), "发布/回滚改变了运行态或密钥")
            for release in (base / "releases").iterdir():
                for file in release.rglob("*"):
                    if file.is_file():
                        require(sha(file.read_bytes()) not in private_before.values(), "私有文件进入公开发行目录")

        bind()
        return base, candidate, old, private_files, plan, bind, run, private_unchanged

    try:
        def actual_candidate():
            candidate = ROOT / ".build/site"
            raw = (candidate / "manifest.sha256").read_bytes()
            _, records = publish.verify_site(candidate, sha(raw))
            require((candidate / "manifest.sha256").read_bytes() == raw, "公开候选检查期间发生变化")
            metadata["publicManifestSha256"] = sha(raw)
            metadata["publicFileCount"] = len(records)
        case("PUB-01 实际公开发行包固定白名单、文件集合与完整哈希", actual_candidate)

        for label, previous, failure in [
            ("当前完整清单发布", publish.REQUIRED, False),
            ("地图前版回滚", publish.MAP_REQUIRED, True),
            ("地图之前前版回滚", publish.PREVIOUS_REQUIRED, True),
        ]:
            def transition(previous=previous, failure=failure):
                base, _, _, _, plan, _, run, unchanged = fixture(previous)
                if failure:
                    rejected(lambda: run(True), "post_switch_verification_failed")
                    require(os.readlink(base / "current") == plan["previous"], "回滚未恢复旧版本指针")
                else:
                    require(run()["status"] == "published", "没有完成合成发布")
                receipt = json.loads((base / "maintenance-receipts" / (plan["release"] + ".json")).read_bytes())
                require(receipt["status"] == ("rolled_back" if failure else "published"), "回执状态不符")
                unchanged()
            case("PUB-02 " + label + "保留独立数据库和密钥", transition)

        for role in ("candidate", "previous"):
            for name in ("server.mjs", "public/admin.js", "console.sqlite", "encryption.key", "records/private.json"):
                def injected(role=role, name=name):
                    base, candidate, old, _, plan, bind, run, unchanged = fixture(publish.MAP_REQUIRED)
                    target = (candidate if role == "candidate" else old) / name
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_bytes(b"synthetic private entry")
                    bind()
                    rejected(run, "nonpublic_file")
                    require(os.readlink(base / "current") == plan["previous"], "非公开清单未在切换前停止")
                    unchanged()
                case("PUB-03 " + role + "拒绝含有效哈希的 " + name, injected)

            def unlisted(role=role):
                base, candidate, old, _, plan, _, run, _ = fixture(publish.MAP_REQUIRED)
                ((candidate if role == "candidate" else old) / "console.sqlite").write_bytes(b"synthetic unlisted private data")
                rejected(run, "candidate_file_set")
                require(os.readlink(base / "current") == plan["previous"], "清单外文件未在切换前停止")
            case("PUB-04 " + role + "拒绝未列入清单的私人文件", unlisted)

            for kind in ("symlink", "hardlink"):
                def linked(role=role, kind=kind):
                    base, candidate, old, private, plan, bind, run, _ = fixture(publish.MAP_REQUIRED)
                    target = (candidate if role == "candidate" else old) / "assets/event-posters/security-probe.png"
                    target.parent.mkdir(parents=True, exist_ok=True)
                    if kind == "symlink":
                        target.symlink_to(private[0])
                    else:
                        os.link(private[0], target)
                    bind()
                    rejected(run, "candidate_link" if kind == "symlink" else "file_type_or_size")
                    require(os.readlink(base / "current") == plan["previous"], "指向私人文件的链接未在切换前停止")
                case("PUB-05 " + role + "拒绝白名单媒体路径的 " + kind, linked)
    finally:
        metadata["publisherChangedDuringRun"] = source.read_bytes() != source_bytes
        require(scratch.parent == Path("/tmp") and scratch.name.startswith("idol-console-security-publication-") and not scratch.is_symlink(), "临时目录清理边界异常")
        shutil.rmtree(scratch)
        metadata["temporaryDirectoryRemoved"] = not scratch.exists()
        metadata["passed"] = len(results) == 20 and all(result["passed"] for result in results) and not metadata["publisherChangedDuringRun"]
        (evidence / "result.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print("证据：" + str(evidence.relative_to(ROOT)), flush=True)
        print(f"用例：{sum(item['passed'] for item in results)}/{len(results)}；临时数据已清理", flush=True)
    return 0 if metadata["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
