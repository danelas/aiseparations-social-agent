// Runs the vendored Spot Color Studio engine (demo/separate_demo.py) on a piece
// of artwork and returns a branded before/after card plus the real separation
// metadata. Pure numpy + Pillow under the hood — see demo/separate_demo.py.

import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export type SepMode = "spot" | "halftone";

export type SepMeta = {
  count: number;        // total distinct inks the engine detected in the art
  used: number;         // inks actually separated into for the card
  colors: string[];     // hex swatches, darkest → lightest
  recommend: string;    // "plastisol" | "DTF"
  mode?: SepMode;       // how the screens were rendered
};

const HERE = dirname(fileURLToPath(import.meta.url));
const DEMO_DIR = resolve(HERE, "..", "..", "demo");
const CARD_SCRIPT = resolve(DEMO_DIR, "separate_demo.py");
const VIDEO_SCRIPT = resolve(DEMO_DIR, "demo_video.py");

function pythonCmd(): string {
  return (process.env.PYTHON || process.env.PYTHON_BIN || "python3").trim();
}

function runPython(args: string[]): Promise<void> {
  return new Promise<void>((res, rej) => {
    const env = {
      ...process.env,
      // The separation calls into BLAS; pin threads so it stays lean + stable in CI.
      OPENBLAS_NUM_THREADS: "1",
      OMP_NUM_THREADS: "1",
      NUMEXPR_NUM_THREADS: "1",
    };
    const child = spawn(pythonCmd(), args, { env, stdio: ["ignore", "inherit", "inherit"] });
    child.on("error", rej);
    child.on("close", (code) => (code === 0 ? res() : rej(new Error(`${args[0]} exited ${code}`))));
  });
}

/**
 * Separate `artPath` and write a portrait before/after card to `cardPath`.
 * Returns the engine's real separation metadata.
 */
export async function separateToCard(
  artPath: string,
  cardPath: string,
  metaPath: string,
  opts: { garment?: "dark" | "light"; mode?: SepMode } = {}
): Promise<SepMeta> {
  const args = [CARD_SCRIPT, artPath, cardPath, metaPath, "--garment", opts.garment ?? "dark"];
  if (opts.mode) args.push("--mode", opts.mode);
  await runPython(args);
  return JSON.parse(await readFile(metaPath, "utf8")) as SepMeta;
}

/**
 * Separate `artPath` and render an animated before/after reveal mp4 to
 * `videoPath`. Returns the engine's real metadata. Requires ffmpeg on PATH
 * (preinstalled on GitHub-hosted ubuntu runners).
 *
 * `aspect` controls the format:
 *   "portrait"  → 9:16 (1080x1920) for Shorts / Reels / TikTok (default)
 *   "landscape" → 16:9 (1920x1080) for regular YouTube long-form
 */
export async function separateToVideo(
  artPath: string,
  videoPath: string,
  metaPath: string,
  opts: { garment?: "dark" | "light"; aspect?: "portrait" | "landscape"; mode?: SepMode } = {}
): Promise<SepMeta> {
  const args = [VIDEO_SCRIPT, artPath, videoPath, metaPath, "--garment", opts.garment ?? "dark"];
  if (opts.aspect) args.push("--aspect", opts.aspect);
  if (opts.mode) args.push("--mode", opts.mode);
  await runPython(args);
  return JSON.parse(await readFile(metaPath, "utf8")) as SepMeta;
}
