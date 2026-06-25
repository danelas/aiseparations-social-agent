"""
Before/after social demo card.

Takes a piece of artwork, runs the REAL Spot Color Studio engine on it
(kmeans palette detection + projected-gradient unmix, the same math behind
aiseparations.com), and composes a portrait card that screen printers
actually respond to:

    YOUR ART  ->  the separated spot-color screens  ->  N colors, press-ready

Pure numpy + Pillow (the engine's scipy paths are not touched), so it runs
in a lean CI step with just `pip install numpy pillow`.

Usage:
    python separate_demo.py <art.png> <out_card.png> <out_meta.json> [--colors N] [--garment dark|light]

Writes the card PNG and a meta JSON: { "count", "colors", "recommend", "used" }.
"""
from __future__ import annotations

import argparse
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from spot_sep import kmeans_palette, unmix  # noqa: E402

# ---- engine knobs (mirror the serverless preview path) ----------------------
WORK_MAX = 700           # px long edge the separation runs at
UNMIX_ITERS = 110
DETECT_K = 8
MERGE_DIST = 0.14
INK_BUDGET = 0.95
SPECKLE = 0.08
WHITE = np.array([1.0, 1.0, 1.0], dtype=np.float32)
LUMA = np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)

# ---- brand palette (indigo / cyan on near-black) ----------------------------
BG = (11, 14, 26)
PANEL = (18, 22, 40)
INDIGO = (79, 70, 229)
CYAN = (34, 211, 238)
INK_TILE_BG = (8, 10, 18)
TEXT = (236, 238, 248)
MUTED = (150, 158, 184)

CARD_W, CARD_H = 1080, 1350
MARGIN = 56


def _load_rgb(path: str, max_dim: int = WORK_MAX):
    img = Image.open(path)
    has_alpha = img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info)
    img = img.convert("RGBA") if has_alpha else img.convert("RGB")
    w, h = img.size
    scale = min(max_dim / max(w, h), 1.0)
    if scale < 1.0:
        img = img.resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.LANCZOS)
    arr = np.asarray(img, dtype=np.float32) / 255.0
    if has_alpha:
        return arr[..., :3], arr[..., 3]
    return arr[..., :3], None


def _merge_inks(inks: np.ndarray, dist: float = MERGE_DIST) -> np.ndarray:
    kept: list[np.ndarray] = []
    for ink in inks:
        if all(np.linalg.norm(ink - k) > dist for k in kept):
            kept.append(ink)
    return np.asarray(kept, dtype=np.float32)


def _hex(ink: np.ndarray) -> str:
    r, g, b = (np.clip(ink, 0, 1) * 255).round().astype(int)
    return f"#{r:02x}{g:02x}{b:02x}"


def separate(path: str, colors, dark: bool):
    rgb, alpha = _load_rgb(path)

    detected = _merge_inks(kmeans_palette(rgb, DETECT_K, 25, 20000, 7))
    count = int(detected.shape[0])

    if isinstance(colors, str) and colors.isdigit():
        colors = int(colors)
    if isinstance(colors, int) and 1 <= colors <= 6:
        k = colors
    else:
        k = min(max(count, 2), 6)

    inks = kmeans_palette(rgb, k, 25, 20000, 7)
    coverages = unmix(rgb, inks, WHITE, UNMIX_ITERS, INK_BUDGET)
    if alpha is not None:
        coverages = coverages * alpha[..., None]
    coverages = np.where(coverages < SPECKLE, 0.0, coverages)

    # order inks darkest -> lightest so screens read like a real sep stack
    order = np.argsort(-(inks @ LUMA))
    inks = inks[order]
    coverages = coverages[..., order]

    recommend = "DTF" if count >= 7 else "plastisol"
    return rgb, alpha, inks, coverages, count, k, recommend


def _channel_tile(cov: np.ndarray, ink: np.ndarray, size: int) -> Image.Image:
    """One separated screen: the single ink painted at its coverage on a tile
    whose background contrasts the ink, so even a near-black screen reads."""
    h, w = cov.shape
    dark_ink = float(ink @ LUMA) < 0.32
    tile_bg = np.array((58, 64, 86) if dark_ink else INK_TILE_BG, dtype=np.float32)
    canvas = np.broadcast_to(tile_bg, (h, w, 3)).astype(np.float32).copy()
    c = cov[..., None]
    canvas = canvas * (1.0 - c) + (ink * 255.0) * c
    tile = Image.fromarray(np.clip(canvas, 0, 255).astype(np.uint8), "RGB")
    bg_rgb = tuple(int(v) for v in tile_bg)
    return _fit_square(tile, size, bg=bg_rgb)


def _fit_square(img: Image.Image, size: int, bg=INK_TILE_BG) -> Image.Image:
    img = img.copy()
    img.thumbnail((size, size), Image.LANCZOS)
    canvas = Image.new("RGB", (size, size), bg)
    canvas.paste(img, ((size - img.width) // 2, (size - img.height) // 2))
    return canvas


def _font(size: int, bold: bool = False):
    candidates = (
        ["DejaVuSans-Bold.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
         "arialbd.ttf", "C:/Windows/Fonts/arialbd.ttf"]
        if bold else
        ["DejaVuSans.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
         "arial.ttf", "C:/Windows/Fonts/arial.ttf"]
    )
    for c in candidates:
        try:
            return ImageFont.truetype(c, size)
        except Exception:
            continue
    return ImageFont.load_default()


def _rounded_panel(draw, box, radius, fill):
    draw.rounded_rectangle(box, radius=radius, fill=fill)


def _art_image(rgb: np.ndarray, alpha) -> Image.Image:
    if alpha is not None:
        rgba = np.dstack([rgb, alpha])
        img = Image.fromarray((np.clip(rgba, 0, 1) * 255).astype(np.uint8), "RGBA")
        flat = Image.new("RGB", img.size, INK_TILE_BG)
        flat.paste(img, mask=img.split()[3])
        return flat
    return Image.fromarray((np.clip(rgb, 0, 1) * 255).astype(np.uint8), "RGB")


def compose(rgb, alpha, inks, coverages, count, k, recommend, out_path):
    card = Image.new("RGB", (CARD_W, CARD_H), BG)
    d = ImageDraw.Draw(card)
    inner = CARD_W - 2 * MARGIN

    f_brand = _font(30, bold=True)
    f_title = _font(58, bold=True)
    f_label = _font(28, bold=True)
    f_small = _font(24)
    f_chip = _font(22, bold=True)

    y = MARGIN
    d.text((MARGIN, y), "AI SEPARATIONS", font=f_brand, fill=CYAN)
    y += 44
    d.text((MARGIN, y), "Art → press-ready screens", font=f_title, fill=TEXT)
    y += 84

    # ---- BEFORE panel -------------------------------------------------------
    art = _art_image(rgb, alpha)
    art_h = 360
    art_fit = art.copy()
    art_fit.thumbnail((inner, art_h), Image.LANCZOS)
    panel_h = art_h + 24
    _rounded_panel(d, (MARGIN, y, MARGIN + inner, y + panel_h), 22, PANEL)
    ax = MARGIN + (inner - art_fit.width) // 2
    ay = y + (panel_h - art_fit.height) // 2
    card.paste(art_fit, (ax, ay))
    # BEFORE chip
    chip = "YOUR ART"
    cw = d.textlength(chip, font=f_chip) + 28
    d.rounded_rectangle((MARGIN + 16, y + 16, MARGIN + 16 + cw, y + 16 + 38), 10, fill=INDIGO)
    d.text((MARGIN + 30, y + 23), chip, font=f_chip, fill=TEXT)
    y += panel_h + 30

    # ---- arrow / caption ----------------------------------------------------
    sep_txt = f"separated into {k} spot colors"
    d.text((MARGIN, y), "▼  " + sep_txt, font=f_label, fill=CYAN)
    y += 50

    # ---- AFTER: separated channel tiles ------------------------------------
    # Size tiles to fit the box between here and the footer band, by BOTH the
    # column width and the rows of vertical space left — never overflow.
    n = inks.shape[0]
    cols = min(n, 3)
    rows = (n + cols - 1) // cols
    gap = 18
    label_h = 34
    footer_top = CARD_H - 132
    avail_h = footer_top - 24 - y
    tile_w = (inner - gap * (cols - 1)) // cols
    tile_h = (avail_h - rows * (label_h + gap)) // rows
    tile = max(80, min(tile_w, tile_h))
    grid_w = tile * cols + gap * (cols - 1)
    x0 = MARGIN + (inner - grid_w) // 2
    for i in range(n):
        r, cc = divmod(i, cols)
        tx = x0 + cc * (tile + gap)
        ty = y + r * (tile + label_h + gap)
        timg = _channel_tile(coverages[..., i], inks[i], tile)
        card.paste(timg, (tx, ty))
        d.rounded_rectangle((tx, ty, tx + tile, ty + tile), 14, outline=(40, 46, 70), width=2)
        # hex label under each screen
        hx = _hex(inks[i])
        d.rectangle((tx, ty + tile + 6, tx + 26, ty + tile + 26), fill=tuple(int(v * 255) for v in np.clip(inks[i], 0, 1)))
        d.text((tx + 34, ty + tile + 4), hx, font=f_small, fill=MUTED)
    y += rows * (tile + label_h + gap) + 6

    # ---- footer band --------------------------------------------------------
    band_y = CARD_H - 132
    _rounded_panel(d, (MARGIN, band_y, MARGIN + inner, band_y + 96), 20, PANEL)
    line1 = f"{k} spot colors  •  best as {recommend}  •  no Photoshop"
    d.text((MARGIN + 26, band_y + 18), line1, font=f_label, fill=TEXT)
    d.text((MARGIN + 26, band_y + 56), "Free trial → aiseparations.com", font=f_small, fill=CYAN)

    card.save(out_path, "PNG")
    return out_path


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("art")
    ap.add_argument("out_card")
    ap.add_argument("out_meta")
    ap.add_argument("--colors", default=None)
    ap.add_argument("--garment", default="dark")
    args = ap.parse_args()

    dark = args.garment != "light"
    rgb, alpha, inks, coverages, count, k, recommend = separate(args.art, args.colors, dark)
    compose(rgb, alpha, inks, coverages, count, k, recommend, args.out_card)

    meta = {
        "count": count,
        "used": k,
        "colors": [_hex(c) for c in inks],
        "recommend": recommend,
    }
    with open(args.out_meta, "w", encoding="utf-8") as fh:
        json.dump(meta, fh)
    print(json.dumps(meta))


if __name__ == "__main__":
    main()
