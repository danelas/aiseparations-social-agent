"""
Animated before/after reveal of a real color separation.

Two aspects:
    portrait  (9:16, 1080x1920) — Shorts / Reels / TikTok (default)
    landscape (16:9, 1920x1080) — regular YouTube long-form (side-by-side)

Reuses the real separation from separate_demo.py, then animates:
    header → "YOUR ART" → screens reveal one-by-one → count + CTA

Renders frames with Pillow and encodes to mp4 with ffmpeg (preinstalled on
GitHub-hosted ubuntu runners). Pure numpy + Pillow for the math; no scipy.

Usage:
    python demo_video.py <art.png> <out.mp4> <out_meta.json> \
        [--garment dark|light] [--aspect portrait|landscape]
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
    separate, _art_image, _channel_tile, _halftone_tile, HALFTONE_ANGLES,
    _font, _hex, _fit_square,
    BG, PANEL, INDIGO, CYAN, INK_TILE_BG, TEXT, MUTED, LUMA,
)

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


def _text_layer(text, font, fill, anchor_box, size):
    """A full-canvas transparent layer with `text` drawn — caller composites it."""
    layer = Image.new("RGBA", size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.text((anchor_box[0], anchor_box[1]), text, font=font, fill=fill + (255,))
    return layer


def build(art_path, out_path, garment, aspect="portrait", mode="spot"):
    dark = garment != "light"
    rgb, alpha, inks, coverages, count, k, recommend = separate(art_path, None, dark)
    n = inks.shape[0]
    halftone_mode = mode == "halftone"

    landscape = aspect == "landscape"
    VW, VH = (1920, 1080) if landscape else (1080, 1920)
    size = (VW, VH)

    f_brand = _font(40, bold=True)
    f_title = _font(60 if landscape else 72, bold=True)
    f_label = _font(38 if landscape else 40, bold=True)
    f_small = _font(30 if landscape else 32)
    f_chip = _font(28 if landscape else 30, bold=True)
    f_foot = _font(44 if landscape else 46, bold=True)

    # ---- layout: portrait stacks vertically; landscape is art | screens ----
    gap = 22
    y_header = MARGIN
    if landscape:
        col_gap = 56
        art_w = 800
        x_art = MARGIN
        x_right = MARGIN + art_w + col_gap
        right_w = VW - x_right - MARGIN
        footer_h = 132
        y_footer = VH - footer_h - MARGIN
        y_art = y_header + 140
        art_box_h = y_footer - y_art - 26
        y_sep = y_art                      # "separated into…" labels the right column
        y_grid = y_art + 56
        grid_w = right_w
        grid_avail_h = y_footer - y_grid - 14
        footer_w = VW - 2 * MARGIN
        x_footer = MARGIN
    else:
        inner = VW - 2 * MARGIN
        art_w = inner
        x_art = MARGIN
        art_box_h = 620
        y_art = y_header + 150
        y_sep = y_art + art_box_h + 46
        y_grid = y_sep + 70
        x_right = MARGIN
        grid_w = inner
        grid_avail_h = None
        footer_h = 150
        y_footer = VH - footer_h - MARGIN
        footer_w = inner
        x_footer = MARGIN

    # artwork panel
    art = _art_image(rgb, alpha)
    # Reserve a top band for the "YOUR ART" badge so it never sits on top of the
    # artwork (a logo with content in the top-left would otherwise be covered).
    STRIP = 84
    art_fit = art.copy()
    art_fit.thumbnail((art_w - 40, art_box_h - STRIP - 30), Image.LANCZOS)
    art_panel = Image.new("RGBA", (art_w, art_box_h), (0, 0, 0, 0))
    ad = ImageDraw.Draw(art_panel)
    ad.rounded_rectangle((0, 0, art_w, art_box_h), 28, fill=PANEL + (255,))
    art_panel.paste(art_fit, ((art_w - art_fit.width) // 2,
                              STRIP + (art_box_h - STRIP - art_fit.height) // 2))
    ad.rounded_rectangle((20, 20, 20 + ad.textlength("YOUR ART", font=f_chip) + 36, 70), 12, fill=INDIGO + (255,))
    ad.text((40, 30), "YOUR ART", font=f_chip, fill=TEXT + (255,))

    # channel tiles (square, with hex label baked under). Tile size is driven by
    # the column width, then clamped so the grid fits the available height too.
    cols = min(n, 4) if landscape else min(n, 3)
    rows = (n + cols - 1) // cols
    tile = (grid_w - gap * (cols - 1)) // cols
    if grid_avail_h is not None and rows > 0:
        max_tile = (grid_avail_h - gap * (rows - 1)) // rows - 44
        tile = max(60, min(tile, max_tile))
    tiles = []
    for i in range(n):
        cell = Image.new("RGBA", (tile, tile + 44), (0, 0, 0, 0))
        if halftone_mode:
            timg = _halftone_tile(coverages[..., i], inks[i], tile,
                                  HALFTONE_ANGLES[i % len(HALFTONE_ANGLES)])
        else:
            timg = _channel_tile(coverages[..., i], inks[i], tile)
        cell.paste(timg, (0, 0))
        cd = ImageDraw.Draw(cell)
        cd.rounded_rectangle((0, 0, tile, tile), 16, outline=(40, 46, 70, 255), width=2)
        cd.rectangle((0, tile + 10, 30, tile + 34), fill=tuple(int(v * 255) for v in np.clip(inks[i], 0, 1)) + (255,))
        cd.text((40, tile + 6), _hex(inks[i]), font=f_small, fill=MUTED + (255,))
        tiles.append(cell)

    grid_total_w = cols * tile + (cols - 1) * gap
    x_grid = x_right + (grid_w - grid_total_w) // 2

    # ---- timeline ----------------------------------------------------------
    t_header = 0.0
    t_art = 0.6
    t_sep = 1.7
    t_tiles0 = 2.1
    t_tile_step = max(0.28, min(0.5, 2.4 / max(n, 1)))
    t_footer = t_tiles0 + n * t_tile_step + 0.3
    duration = t_footer + 0.6 + 1.6
    total_frames = int(duration * FPS)

    sep_txt = (
        f"screened into {k} halftone channels" if halftone_mode
        else f"separated into {k} spot colors"
    )
    foot1 = (
        f"{k}-color simulated process  •  best as {recommend}" if halftone_mode
        else f"{k} colors  •  best as {recommend}"
    )
    foot2 = "Free trial → aiseparations.com"

    tmp = tempfile.mkdtemp(prefix="aisep_vid_")
    try:
        for fi in range(total_frames):
            t = fi / FPS
            canvas = Image.new("RGBA", (VW, VH), BG + (255,))

            # header
            ah = _seg(t, t_header, 0.5)
            _paste_alpha(canvas, _text_layer("AI SEPARATIONS", f_brand, CYAN, (MARGIN, y_header), size), (0, 0), ah)
            _paste_alpha(canvas, _text_layer("Art → press-ready screens", f_title, TEXT, (MARGIN, y_header + 54), size), (0, 0), ah)

            # art panel (fade + slight rise)
            aa = _seg(t, t_art, 0.9)
            _paste_alpha(canvas, art_panel, (x_art, y_art + (1 - aa) * 30), aa)

            # separating label (labels the screens column)
            sa = _seg(t, t_sep, 0.4)
            _paste_alpha(canvas, _text_layer("▼  " + sep_txt, f_label, CYAN, (x_right, y_sep), size), (0, 0), sa)

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
                band = Image.new("RGBA", (footer_w, footer_h), (0, 0, 0, 0))
                bd = ImageDraw.Draw(band)
                bd.rounded_rectangle((0, 0, footer_w, footer_h), 24, fill=PANEL + (255,))
                bd.text((30, int(footer_h * 0.17)), foot1, font=f_foot, fill=TEXT + (255,))
                bd.text((30, int(footer_h * 0.58)), foot2, font=f_small, fill=CYAN + (255,))
                _paste_alpha(canvas, band, (x_footer, y_footer), fa)

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

    return {"count": count, "used": k, "colors": [_hex(c) for c in inks],
            "recommend": recommend, "mode": mode}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("art")
    ap.add_argument("out_video")
    ap.add_argument("out_meta")
    ap.add_argument("--garment", default="dark")
    ap.add_argument("--aspect", default="portrait", choices=["portrait", "landscape"])
    ap.add_argument("--mode", default="spot", choices=["spot", "halftone"])
    args = ap.parse_args()
    meta = build(args.art, args.out_video, args.garment, args.aspect, args.mode)
    with open(args.out_meta, "w", encoding="utf-8") as fh:
        json.dump(meta, fh)
    print(json.dumps(meta))


if __name__ == "__main__":
    main()
