"""
Animated 9:16 before/after reveal for Shorts / Reels / TikTok.

Reuses the real separation from separate_demo.py, then animates:
    header → "YOUR ART" → screens reveal one-by-one → count + CTA

Renders frames with Pillow and encodes to mp4 with ffmpeg (preinstalled on
GitHub-hosted ubuntu runners). Pure numpy + Pillow for the math; no scipy.

Usage:
    python demo_video.py <art.png> <out.mp4> <out_meta.json> [--garment dark|light]
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from separate_demo import (  # noqa: E402
    separate, _art_image, _channel_tile, _font, _hex, _fit_square,
    BG, PANEL, INDIGO, CYAN, INK_TILE_BG, TEXT, MUTED, LUMA,
)

VW, VH = 1080, 1920
MARGIN = 70
FPS = 30


def _ease_out(x: float) -> float:
    x = max(0.0, min(1.0, x))
    return 1.0 - (1.0 - x) ** 3


def _seg(t: float, start: float, dur: float) -> float:
    """Eased 0→1 progress of a segment that begins at `start` and lasts `dur`."""
    return _ease_out((t - start) / dur) if dur > 0 else (1.0 if t >= start else 0.0)


def _paste_alpha(canvas: Image.Image, layer: Image.Image, xy, a: float):
    """Alpha-composite an RGBA `layer` onto `canvas` (RGBA) at global opacity a."""
    if a <= 0:
        return
    if a < 1.0:
        al = layer.split()[3].point(lambda p: int(p * a))
        layer = layer.copy()
        layer.putalpha(al)
    canvas.alpha_composite(layer, dest=(int(xy[0]), int(xy[1])))


def _text_layer(text, font, fill, anchor_box=None):
    """A full-canvas transparent layer with `text` drawn — caller composites it."""
    layer = Image.new("RGBA", (VW, VH), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.text((anchor_box[0], anchor_box[1]), text, font=font, fill=fill + (255,))
    return layer


def build(art_path, out_path, garment):
    dark = garment != "light"
    rgb, alpha, inks, coverages, count, k, recommend = separate(art_path, None, dark)
    n = inks.shape[0]

    # ---- pre-render static pieces ------------------------------------------
    inner = VW - 2 * MARGIN
    f_brand = _font(40, bold=True)
    f_title = _font(72, bold=True)
    f_label = _font(40, bold=True)
    f_small = _font(32)
    f_chip = _font(30, bold=True)
    f_foot = _font(46, bold=True)

    # artwork panel
    art = _art_image(rgb, alpha)
    art_box_h = 620
    art_fit = art.copy()
    art_fit.thumbnail((inner - 40, art_box_h - 40), Image.LANCZOS)
    art_panel = Image.new("RGBA", (inner, art_box_h), (0, 0, 0, 0))
    ad = ImageDraw.Draw(art_panel)
    ad.rounded_rectangle((0, 0, inner, art_box_h), 28, fill=PANEL + (255,))
    art_panel.paste(art_fit, ((inner - art_fit.width) // 2, (art_box_h - art_fit.height) // 2))
    ad.rounded_rectangle((20, 20, 20 + ad.textlength("YOUR ART", font=f_chip) + 36, 70), 12, fill=INDIGO + (255,))
    ad.text((40, 30), "YOUR ART", font=f_chip, fill=TEXT + (255,))

    # channel tiles (square, with hex label baked under)
    cols = min(n, 3)
    rows = (n + cols - 1) // cols
    gap = 22
    tile = (inner - gap * (cols - 1)) // cols
    tiles = []
    for i in range(n):
        cell = Image.new("RGBA", (tile, tile + 44), (0, 0, 0, 0))
        timg = _channel_tile(coverages[..., i], inks[i], tile)
        cell.paste(timg, (0, 0))
        cd = ImageDraw.Draw(cell)
        cd.rounded_rectangle((0, 0, tile, tile), 16, outline=(40, 46, 70, 255), width=2)
        cd.rectangle((0, tile + 10, 30, tile + 34), fill=tuple(int(v * 255) for v in np.clip(inks[i], 0, 1)) + (255,))
        cd.text((40, tile + 6), _hex(inks[i]), font=f_small, fill=MUTED + (255,))
        tiles.append(cell)

    # layout anchors
    y_header = MARGIN
    y_art = y_header + 150
    y_sep = y_art + art_box_h + 46
    y_grid = y_sep + 70
    grid_h = rows * (tile + 44) + (rows - 1) * gap
    x_grid = MARGIN + (inner - (cols * tile + (cols - 1) * gap)) // 2

    # ---- timeline ----------------------------------------------------------
    t_header = 0.0
    t_art = 0.6
    t_sep = 1.7
    t_tiles0 = 2.1
    t_tile_step = max(0.28, min(0.5, 2.4 / max(n, 1)))
    t_footer = t_tiles0 + n * t_tile_step + 0.3
    duration = t_footer + 0.6 + 1.6
    total_frames = int(duration * FPS)

    sep_txt = f"separated into {k} spot colors"
    foot1 = f"{k} colors  •  best as {recommend}"
    foot2 = "Free trial → aiseparations.com"

    tmp = tempfile.mkdtemp(prefix="aisep_vid_")
    try:
        for fi in range(total_frames):
            t = fi / FPS
            canvas = Image.new("RGBA", (VW, VH), BG + (255,))

            # header
            ah = _seg(t, t_header, 0.5)
            _paste_alpha(canvas, _text_layer("AI SEPARATIONS", f_brand, CYAN, (MARGIN, y_header)), (0, 0), ah)
            _paste_alpha(canvas, _text_layer("Art → press-ready screens", f_title, TEXT, (MARGIN, y_header + 54)), (0, 0), ah)

            # art panel (fade + slight rise)
            aa = _seg(t, t_art, 0.9)
            _paste_alpha(canvas, art_panel, (MARGIN, y_art + (1 - aa) * 30), aa)

            # separating label
            sa = _seg(t, t_sep, 0.4)
            _paste_alpha(canvas, _text_layer("▼  " + sep_txt, f_label, CYAN, (MARGIN, y_sep)), (0, 0), sa)

            # channel tiles, staggered
            for i, cell in enumerate(tiles):
                ta = _seg(t, t_tiles0 + i * t_tile_step, 0.45)
                if ta <= 0:
                    continue
                r, cc = divmod(i, cols)
                tx = x_grid + cc * (tile + gap)
                ty = y_grid + r * (tile + 44 + gap) + (1 - ta) * 26
                _paste_alpha(canvas, cell, (tx, ty), ta)

            # footer band
            fa = _seg(t, t_footer, 0.5)
            if fa > 0:
                band = Image.new("RGBA", (inner, 150), (0, 0, 0, 0))
                bd = ImageDraw.Draw(band)
                bd.rounded_rectangle((0, 0, inner, 150), 24, fill=PANEL + (255,))
                bd.text((30, 26), foot1, font=f_foot, fill=TEXT + (255,))
                bd.text((30, 90), foot2, font=f_small, fill=CYAN + (255,))
                _paste_alpha(canvas, band, (MARGIN, VH - 150 - MARGIN), fa)

            canvas.convert("RGB").save(os.path.join(tmp, f"f{fi:04d}.png"))

        ffmpeg = shutil.which("ffmpeg") or "ffmpeg"
        cmd = [
            ffmpeg, "-y", "-framerate", str(FPS),
            "-i", os.path.join(tmp, "f%04d.png"),
            "-c:v", "libx264", "-pix_fmt", "yuv420p",
            "-movflags", "+faststart", "-r", str(FPS),
            out_path,
        ]
        subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    return {"count": count, "used": k, "colors": [_hex(c) for c in inks], "recommend": recommend}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("art")
    ap.add_argument("out_video")
    ap.add_argument("out_meta")
    ap.add_argument("--garment", default="dark")
    args = ap.parse_args()
    meta = build(args.art, args.out_video, args.garment)
    with open(args.out_meta, "w", encoding="utf-8") as fh:
        json.dump(meta, fh)
    print(json.dumps(meta))


if __name__ == "__main__":
    main()
