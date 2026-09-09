"""冻结现有私有账本供服务器迁移；从不更改原账本或覆盖已有迁移包。"""

import argparse
import hashlib
import json
import os
from pathlib import Path
import tarfile

STAGE = "work/phase3-20260909"
ARCHIVE = "outputs/01a05afc-207e-7482-bbb6-c1df12c8da84/中国地下偶像分布图_2026-09-01"
IDENTITIES = [
    "data/群体分布数据.json",
    "sources/微博官方接口候选主档冲突_2026-09-02.json",
    "sources/微博编辑身份接受批次_2026-09-04.json",
    "sources/微博编辑身份补充复核批次_2026-09-04.json",
    "sources/Edge微博人工复核补充_2026-09-04.json",
]


def regular(path):
    for component in [path, *path.parents]:
        if component.is_symlink():
            raise RuntimeError("迁移来源包含链接")
    stat = path.stat()
    if not path.is_file() or stat.st_nlink != 1:
        raise RuntimeError("迁移来源不是独立普通文件")
    return path.read_bytes()


def assert_unlocked(stage, archive):
    for folder in [stage / "private/store/.locks", stage / "private/weekly-runtime/.locks", stage / "private/weekly-application-v2/.locks", stage / ".locks"]:
        if folder.exists() and (folder.is_symlink() or any(folder.iterdir())):
            raise RuntimeError("账本存在写入锁，停止迁移")
    for name in ["sources/.weibo-official-write.lock", "sources/weekly-profile-refresh/maintenance.lock"]:
        if (archive / name).exists():
            raise RuntimeError("旧采集存在写入锁，停止迁移")
    for path in (archive / "sources/weekly-profile-refresh").rglob("run.lock"):
        raise RuntimeError("旧周更运行锁未释放")


def export_seed(stage, archive, output):
    if output.exists():
        raise RuntimeError("不覆盖已有迁移包")
    assert_unlocked(stage, archive)
    sources = []
    for name in ["store", "weekly-runtime", "weekly-application-v2", "provider-price"]:
        folder = stage / "private" / name
        for path in sorted(folder.rglob("*")):
            if path.is_symlink():
                raise RuntimeError("账本含链接")
            if path.is_file():
                sources.append((path, f"{STAGE}/{path.relative_to(stage).as_posix()}"))
    accounting = "reports/root-review/weekly-live-20260909/official-accounting-first3.json"
    sources.append((stage / accounting, f"{STAGE}/{accounting}"))
    for name in IDENTITIES:
        sources.append((archive / name, f"{ARCHIVE}/{name}"))
    for path in sorted((archive / "sources/weekly-profile-refresh").rglob("*")):
        if path.is_symlink():
            raise RuntimeError("旧账本含链接")
        if path.is_file():
            sources.append((path, f"{ARCHIVE}/{path.relative_to(archive).as_posix()}"))
    contents = [(path, name, regular(path)) for path, name in sources]
    if len({name for _, name, _ in contents}) != len(contents):
        raise RuntimeError("重复迁移目标")
    manifest = {"schemaVersion": "idol-private-seed-v1", "files": [{"path": name, "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data)} for _, name, data in contents]}
    assert_unlocked(stage, archive)
    # 读取之后再逐项复验，确保冻结期间来源没有变化。
    for path, _, data in contents:
        if regular(path) != data:
            raise RuntimeError("迁移来源在冻结期间变化")
    output.mkdir(mode=0o700, parents=False)
    for _, name, data in contents:
        target = output / name
        target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        with target.open("xb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        target.chmod(0o600)
    manifest_bytes = (json.dumps(manifest, ensure_ascii=False, indent=2) + "\n").encode()
    (output / "seed-manifest.json").write_bytes(manifest_bytes)
    bundle = output.parent / (output.name + ".tar.gz")
    if bundle.exists():
        raise RuntimeError("不覆盖已有迁移压缩包")
    with tarfile.open(bundle, "x:gz") as target:
        for path in sorted(output.rglob("*")):
            if path.is_file():
                target.add(path, arcname=path.relative_to(output).as_posix(), recursive=False)
    return {"files": len(contents), "bytes": sum(len(data) for _, _, data in contents), "manifestSha256": hashlib.sha256(manifest_bytes).hexdigest(), "archiveSha256": hashlib.sha256(bundle.read_bytes()).hexdigest()}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--stage", required=True, type=Path)
    parser.add_argument("--archive", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    print(json.dumps(export_seed(args.stage.resolve(), args.archive.resolve(), args.output.resolve())))
