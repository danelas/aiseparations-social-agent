// Composites the ASAP logo onto a blog hero image — bottom-right corner with
// a thin brand-red frame. Also crops the source image to a clean 1200x630
// OG-ratio before applying the overlay so social shares look right.

import sharp from "sharp";
import { resolve, dirname } from "node:path";
import { mkdir } from "node:fs/promises";

const LOGO_PATH = resolve(process.cwd(), "assets/logo.png");

const TARGET_W = 1200;
const TARGET_H = 630;
const LOGO_WIDTH_PCT = 0.12;     // 12% of canvas width
const PADDING_PCT = 0.03;
const FRAME_PX = 0;              // transparent mark — no frame

export async function brandHero(srcPath: string, outPath: string): Promise<string> {
  await mkdir(dirname(outPath), { recursive: true });

  // Resize + cover-crop the source image to 1200x630.
  const cropped = await sharp(srcPath)
    .resize(TARGET_W, TARGET_H, { fit: "cover", position: "center" })
    .toBuffer();

  const targetLogoWidth = Math.round(TARGET_W * LOGO_WIDTH_PCT);
  const innerLogoWidth = targetLogoWidth - FRAME_PX * 2;

  let pipeline = sharp(LOGO_PATH).resize({ width: innerLogoWidth });
  if (FRAME_PX > 0) {
    pipeline = pipeline.extend({
      top: FRAME_PX, bottom: FRAME_PX, left: FRAME_PX, right: FRAME_PX,
      background: { r: 140, g: 124, b: 255, alpha: 1 },
    });
  }
  const framedLogo = await pipeline.png().toBuffer();

  const meta = await sharp(framedLogo).metadata();
  const logoW = meta.width ?? targetLogoWidth;
  const logoH = meta.height ?? Math.round(targetLogoWidth * 0.625);

  const padding = Math.round(TARGET_W * PADDING_PCT);
  const top = TARGET_H - logoH - padding;
  const left = TARGET_W - logoW - padding;

  await sharp(cropped)
    .composite([{ input: framedLogo, top, left }])
    .jpeg({ quality: 88, mozjpeg: true })
    .toFile(outPath);

  return outPath;
}
