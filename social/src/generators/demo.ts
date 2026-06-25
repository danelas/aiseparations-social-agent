// Runs the vendored Spot Color Studio engine (demo/separate_demo.py) on a piece
// of artwork and returns a branded before/after card plus the real separation
// metadata. Pure numpy + Pillow under the hood — see demo/separate_demo.py.

import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export type SepMeta = {
  count: number;        // total distinct inks the engine detected in the art
  used: number;         // inks actually separated into for the card
  colors: string[];     // hex swatches, darkest → lightest
  recommend: string;    // "plastisol" | "DTF"
};

const HERE = dirname(fileURLToPath(import.meta.url));
const DEMO_DIR = resolve(HERE, "..", "..", "demo");
const SCRIPT = resolve(DEMO_DIR, "separate_demo.py");

function pythonCmd(): string {
  return (process.env.PYTHON || process.env.PYTHON_BIN || "python3").trim();
}

/**
 * Separate `artPath` and write a portrait before/after card to `cardPath`.
 * Returns the engine's real separation metadata.
 */
export async function separateToCard(
  artPath: string,
  cardPath: string,
  metaPath: string,
  opts: { garment?: "dark" | "light" } = {}
): Promise<SepMeta> {
  const args = [SCRIPT, artPath, cardPath, metaPath, "--garment", opts.garment ?? "dark"];
  await new Promise<void>((res, rej) => {
    const env = {
      ...process.env,
      // The separation calls into BLAS; pin threads so it stays lean + stable in CI.
      OPENBLAS_NUM_THREADS: "1",
      OMP_NUM_THREADS: "1",
      NUMEXPR_NUM_THREADS: "1",
    };
    const child = spawn(pythonCmd(), args, { env, stdio: ["ignore", "inherit", "inherit"] });
    child.on("error", rej);
    child.on("close", (code) =>
      code === 0 ? res() : rej(new Error(`separate_demo.py exited ${code}`))
    );
  });
  const meta = JSON.parse(await readFile(metaPath, "utf8")) as SepMeta;
  return meta;
}
