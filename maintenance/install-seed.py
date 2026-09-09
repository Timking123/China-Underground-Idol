"""校验私有迁移包并写入空白目标；已有不同字节一律停止。"""

import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import tarfile

STAGE = "work/phase3-20260909"
ARCHIVE = "outputs/01a05afc-207e-7482-bbb6-c1df12c8da84/中国地下偶像分布图_2026-09-01"
PREFIXES = [f"{STAGE}/private/{name}/" for name in ["store", "weekly-runtime", "weekly-application-v2", "provider-price"]]
PREFIXES += [f"{ARCHIVE}/sources/weekly-profile-refresh/"]
FILES = {f"{ARCHIVE}/{name}" for name in ["data/群体分布数据.json", "sources/微博官方接口候选主档冲突_2026-09-02.json", "sources/微博编辑身份接受批次_2026-09-04.json", "sources/微博编辑身份补充复核批次_2026-09-04.json", "sources/Edge微博人工复核补充_2026-09-04.json"]}
FILES.add(f"{STAGE}/reports/root-review/weekly-live-20260909/official-accounting-first3.json")


def safe_name(name):
    if PurePosixPath(name).is_absolute() or "\\" in name or ":" in name or any(part in ("", ".", "..") for part in name.split("/")):
        raise RuntimeError("迁移路径不安全")
    if name not in FILES and not any(name.startswith(prefix) for prefix in PREFIXES):
        raise RuntimeError("迁移目标不在私有白名单")


def regular_path(path):
    for part in [path, *path.parents]:
        if part.is_symlink():
            raise RuntimeError("迁移目标含链接")
    if path.exists() and (not path.is_file() or path.stat().st_nlink != 1):
        raise RuntimeError("迁移目标非独立普通文件")


def install_seed(archive, workspace, seed_root, expected_hash):
    regular_path(archive)
    if hashlib.sha256(archive.read_bytes()).hexdigest() != expected_hash:
        raise RuntimeError("迁移包SHA不匹配")
    with tarfile.open(archive, "r:gz") as bundle:
        members = bundle.getmembers()
        if len(members) > 10000 or any(not item.isfile() or item.size > 50_000_000 for item in members):
            raise RuntimeError("迁移包文件类型或大小不合法")
        names = [item.name for item in members]
        if len(names) != len(set(names)) or names.count("seed-manifest.json") != 1:
            raise RuntimeError("迁移包文件重复或缺清单")
        raw = bundle.extractfile("seed-manifest.json").read()
        manifest = json.loads(raw)
        if manifest.get("schemaVersion") != "idol-private-seed-v1" or set(names) != {item["path"] for item in manifest["files"]} | {"seed-manifest.json"}:
            raise RuntimeError("迁移包集合不匹配")
        entries = []
        for row in manifest["files"]:
            safe_name(row["path"])
            data = bundle.extractfile(row["path"]).read()
            if len(data) != row["bytes"] or hashlib.sha256(data).hexdigest() != row["sha256"]:
                raise RuntimeError("迁移文件SHA不匹配")
            entries.append((row["path"], data))
    # 所有预像先检查，冲突早于第一笔写入。
    writes = [(root / name, data) for root in [workspace, seed_root] for name, data in entries]
    writes += [(seed_root / "seed-manifest.json", raw)]
    for target, data in writes:
        regular_path(target)
        if target.exists() and target.read_bytes() != data:
            raise RuntimeError("既有迁移目标不同，停止覆盖")
    created = 0
    for target, data in writes:
        if target.exists():
            continue
        target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        regular_path(target)
        with target.open("xb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        target.chmod(0o600)
        created += 1
    return {"files": len(entries), "writes": created, "manifestSha256": hashlib.sha256(raw).hexdigest()}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--archive", required=True, type=Path)
    parser.add_argument("--workspace", required=True, type=Path)
    parser.add_argument("--seed-root", required=True, type=Path)
    parser.add_argument("--sha256", required=True)
    args = parser.parse_args()
    print(json.dumps(install_seed(args.archive.absolute(), args.workspace.absolute(), args.seed_root.absolute(), args.sha256)))
