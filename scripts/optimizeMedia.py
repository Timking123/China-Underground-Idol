"""已审核本地图片的工程缩放；不下载、不裁切、不生成新艺术内容。"""
import argparse
import hashlib
import json
import math
from pathlib import Path
from PIL import Image, ImageOps, __version__ as pillow_version


def ordinary_path(root, relative, write=False):
    parts = relative.split("/")
    if not relative or any(part in ("", ".", "..") for part in parts) or ":" in relative or "\\" in relative:
        raise ValueError("非法图片路径")
    current = root
    if current.is_symlink():
        raise ValueError("图片根目录不能为链接")
    for index, part in enumerate(parts):
        current = current / part
        if current.is_symlink():
            raise ValueError(f"禁止链接：{relative}")
        if index < len(parts) - 1:
            if write:
                current.mkdir(exist_ok=True)
            if not current.is_dir():
                raise ValueError(f"目录不存在：{relative}")
        elif current.exists() and not current.is_file():
            raise ValueError(f"必须为普通文件：{relative}")
    return current


def optimize(root, output, images):
    records = {}
    for item in images:
        src = item["src"]
        if not src.startswith("assets/"):
            raise ValueError("只允许本地 assets 图片")
        target = ordinary_path(root, src)
        data = target.read_bytes()
        digest = hashlib.sha256(data).hexdigest()
        with Image.open(target) as original:
            if getattr(original, "is_animated", False):
                raise ValueError(f"动画图片须单独审阅：{src}")
            image = ImageOps.exif_transpose(original).convert("RGBA" if "A" in original.getbands() or "transparency" in original.info else "RGB")
            width, height = image.size
            variants = []
            for requested in (96, 320, 640):
                size = min(width, requested)
                if any(entry["width"] == size for entry in variants):
                    continue
                resized = image.resize((size, max(1, math.floor(height * size / width + 0.5))), Image.Resampling.LANCZOS)
                name = f"assets/media-optimized/{digest[:20]}-{size}.webp"
                destination = ordinary_path(output, name, write=True)
                resized.save(destination, format="WEBP", quality=80, method=6, exact=True)
                variants.append({"src": name, "width": size, "height": resized.height, "bytes": destination.stat().st_size, "sha256": hashlib.sha256(destination.read_bytes()).hexdigest()})
        records[src] = {"sha256": digest, "bytes": len(data), "width": width, "height": height, "sources": sorted(item["sources"]), "variants": variants}
    manifest = {"schemaVersion": "idol-media-v1", "encoder": f"Pillow {pillow_version}; WebP quality=80 method=6; EXIF transpose; no upscale", "images": records}
    ordinary_path(output, "assets/media-optimized/manifest.v1.json", write=True).write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    # 浏览器仅携带路径和尺寸，审计来源留在完整清单，避免重复加载哈希与来源。
    compact = {src: {"width": entry["width"], "height": entry["height"], "variants": [{key: variant[key] for key in ("src", "width", "height")} for variant in entry["variants"]]} for src, entry in records.items()}
    ordinary_path(output, "src/media/variants.json", write=True).write_text(json.dumps(compact, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(json.dumps({"images": len(records), "originalBytes": sum(entry["bytes"] for entry in records.values()), "variantFiles": len({variant["src"] for entry in records.values() for variant in entry["variants"]})}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", required=True)
    parser.add_argument("--output-root", required=True)
    parser.add_argument("--input", required=True)
    args = parser.parse_args()
    optimize(Path(args.root).absolute(), Path(args.output_root).absolute(), json.loads(Path(args.input).read_text(encoding="utf-8"))["images"])
