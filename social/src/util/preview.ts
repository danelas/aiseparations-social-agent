import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export async function makePreviewDir(path?: string): Promise<string> {
  if (path) {
    await mkdir(path, { recursive: true });
    return path;
  }
  const today = new Date().toISOString().slice(0, 10);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = resolve(process.cwd(), "preview", `${today}_${stamp}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

export async function writeJson(path: string, obj: unknown): Promise<void> {
  await writeFile(path, JSON.stringify(obj, null, 2), "utf8");
}

export async function writeText(path: string, text: string): Promise<void> {
  await writeFile(path, text, "utf8");
}
