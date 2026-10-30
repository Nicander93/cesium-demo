"""Combine Poly Haven's twig color and alpha atlases without creating new pixels."""

from hashlib import md5, sha256
from pathlib import Path

from PIL import Image


ASSET_DIR = Path(__file__).resolve().parents[1] / "public" / "vegetation-lab" / "pine_tree_01"
SOURCES = {
    "twig_diff_1k.jpg": "b6e5f4e8c228c275e5ff75cb165c2e1f",
    "twig_alpha_1k.jpg": "e9a69633f4c1d9b8a460c3f05fc8d75e",
    "bark_diff_1k.jpg": "7d3a558ed614c7e75594c7be3bf80311",
    "bark_nor_gl_1k.jpg": "bb6e3a6eea777d992cef48fabfdc538c",
}

for name, expected_md5 in SOURCES.items():
    actual_md5 = md5((ASSET_DIR / name).read_bytes()).hexdigest()
    if actual_md5 != expected_md5:
        raise SystemExit(f"Source hash mismatch for {name}: {actual_md5}")

color = Image.open(ASSET_DIR / "twig_diff_1k.jpg").convert("RGB")
alpha = Image.open(ASSET_DIR / "twig_alpha_1k.jpg").convert("L")
if color.size != alpha.size:
    raise SystemExit(f"Twig map dimensions disagree: {color.size} vs {alpha.size}")

atlas = Image.merge("RGBA", (*color.split(), alpha))
output = ASSET_DIR / "twig_basecolor_alpha_1k.png"
atlas.save(output, optimize=True)
print(f"{output.name}: {atlas.width} x {atlas.height}, {output.stat().st_size} bytes")
print(f"sha256: {sha256(output.read_bytes()).hexdigest()}")
