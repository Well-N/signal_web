"""Derive the word-cloud mask and outline from the hero engraving."""

from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy.ndimage import gaussian_filter
from skimage import filters, measure, morphology

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "web" / "public" / "hero-figure-cutout.png"
PUBLIC = ROOT / "web" / "public"


def build() -> None:
    rgb = np.array(Image.open(SOURCE).convert("RGB"), dtype=float)
    chroma = rgb[..., 0] - np.maximum(rgb[..., 1], rgb[..., 2])
    alpha = np.clip((38.0 - chroma) / 22.0, 0.0, 1.0)
    alpha = filters.gaussian(alpha, sigma=1.2, preserve_range=True)
    silhouette = alpha > 0.5
    silhouette = morphology.remove_small_objects(silhouette, 800)
    silhouette = morphology.remove_small_holes(silhouette, 30000)

    rows, columns = np.where(silhouette)
    padding = 10
    top = max(0, int(rows.min()) - padding)
    bottom = min(rgb.shape[0], int(rows.max()) + padding + 1)
    left = max(0, int(columns.min()) - padding)
    right = min(rgb.shape[1], int(columns.max()) + padding + 1)

    luma = 0.2126 * rgb[..., 0] + 0.7152 * rgb[..., 1] + 0.0722 * rgb[..., 2]
    low, high = np.percentile(luma[silhouette], [3, 97])
    luma = np.clip((luma - low) / max(high - low, 1.0) * 255.0, 0, 255)

    silhouette = silhouette[top:bottom, left:right]
    luma = luma[top:bottom, left:right]
    figure = silhouette.astype(float)
    soft_luma = gaussian_filter(luma * figure, sigma=5.0) / np.maximum(
        gaussian_filter(figure, sigma=5.0), 1e-6
    )
    luma = np.where(silhouette, soft_luma, 255.0)

    mask = Image.fromarray((silhouette * 255).astype(np.uint8), mode="L")
    mask_width = 512
    mask_height = round(mask.height * mask_width / mask.width)
    mask.resize((mask_width, mask_height), Image.Resampling.LANCZOS).save(
        PUBLIC / "wordcloud-mask.png"
    )

    tone = Image.fromarray(luma.astype(np.uint8), mode="L").convert("RGBA")
    tone.putalpha(mask)
    tone.resize((mask_width, mask_height), Image.Resampling.LANCZOS).save(
        PUBLIC / "wordcloud-tone.png"
    )

    scale = 2
    outline = Image.new(
        "RGBA",
        (silhouette.shape[1] * scale, silhouette.shape[0] * scale),
        (0, 0, 0, 0),
    )
    draw = ImageDraw.Draw(outline)
    for contour in measure.find_contours(silhouette.astype(float), 0.5):
        if len(contour) < 80:
            continue
        points = [(float(point[1] * scale), float(point[0] * scale)) for point in contour]
        draw.line(points, fill=(236, 243, 255, 148), width=2, joint="curve")
    outline.save(PUBLIC / "wordcloud-outline.png")
    print(
        f"mask={int(silhouette.sum())}px "
        f"bounds={left},{top},{right},{bottom} "
        f"outline={outline.width}x{outline.height}"
    )


if __name__ == "__main__":
    build()
