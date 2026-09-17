"""只读核验管理发行包；不执行包内代码、不修改任何系统路径。"""

import argparse
import hashlib
from pathlib import Path
import re
import stat

FILES = frozenset([
    "server.mjs", "public/index.html", "public/admin.js", "public/admin.css",
    "IP2REGION-LICENSE.txt", "THIRD-PARTY-NOTICES.txt",
])


def require(condition, message):
    if not condition:
        raise ValueError(message)


def verify(directory, expected):
    require(directory.is_absolute() and ".." not in directory.parts, "必须使用绝对路径")
    require(re.fullmatch(r"[a-f0-9]{64}", expected), "必须传入审核记录中的清单 SHA-256")
    for parent in [*reversed(directory.parents), directory]:
        info = parent.lstat()
        require(stat.S_ISDIR(info.st_mode), "父目录不能是链接")
        require(info.st_uid == 0 and info.st_gid == 0 and info.st_mode & 0o022 == 0, "父目录必须由 root 持有且其他账户不可写")
    files = {}
    for item in directory.rglob("*"):
        info = item.lstat()
        require(not stat.S_ISLNK(info.st_mode), "包内不能有链接")
        require(info.st_uid == 0 and info.st_gid == 0 and info.st_mode & 0o022 == 0, "包内归属或权限不正确")
        name = item.relative_to(directory).as_posix()
        if stat.S_ISDIR(info.st_mode):
            require(name == "public", "包内目录未登记")
            continue
        require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1, "只允许独立普通文件")
        require(info.st_size <= 20_000_000, "文件超过包大小上限")
        files[name] = item.read_bytes()
    require(set(files) == FILES | {"manifest.sha256"}, "发行物必须符合固定七文件清单")
    raw = files["manifest.sha256"]
    require(hashlib.sha256(raw).hexdigest() == expected, "审核清单 SHA-256 不匹配")
    records = {}
    for line in raw.decode("utf-8").splitlines():
        match = re.fullmatch(r"([a-f0-9]{64})  ([A-Za-z0-9_./-]+)", line)
        require(match is not None, "清单格式不正确")
        checksum, name = match.groups()
        require(name in FILES and name not in records, "清单含未知路径或重复项")
        records[name] = checksum
    require(set(records) == FILES, "清单缺少发行物")
    for name, checksum in records.items():
        require(hashlib.sha256(files[name]).hexdigest() == checksum, "发行物哈希不匹配")
    return len(records)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="只读核验固定管理发行包")
    parser.add_argument("directory", type=Path)
    parser.add_argument("--manifest-sha256", required=True)
    args = parser.parse_args()
    try:
        count = verify(args.directory, args.manifest_sha256)
    except (OSError, ValueError, UnicodeError) as error:
        parser.exit(1, f"管理发行包校验失败：{type(error).__name__}；请检查审核哈希、清单、归属和权限。\n")
    print(f"管理发行包校验通过：{count} 个固定发行文件。")
