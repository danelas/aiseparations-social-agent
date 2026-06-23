import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { State, PublishedRecord } from "./types.ts";

const STATE_PATH = resolve(process.cwd(), "state.json");

export async function loadState(): Promise<State> {
  try {
    const raw = await readFile(STATE_PATH, "utf-8");
    const parsed = JSON.parse(raw) as State;
    if (!parsed?.published || !Array.isArray(parsed.published)) return { published: [] };
    return parsed;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { published: [] };
    throw err;
  }
}

export async function saveState(state: State): Promise<void> {
  await writeFile(STATE_PATH, JSON.stringify(state, null, 2) + "\n", "utf-8");
}

export function hasPublished(state: State, topicId: string): boolean {
  return state.published.some((r) => r.topicId === topicId);
}

export function recordPublish(state: State, record: PublishedRecord): State {
  return { ...state, published: [...state.published, record] };
}
