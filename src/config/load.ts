import { promises as fs } from "node:fs";
import type { Config } from "./types.js";

async function readFile(path: string): Promise<Partial<Config>> {
  try {
    const raw = await fs.readFile(path, "utf8");
    return JSON.parse(raw) as Partial<Config>;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new Error(`config ${path}: ${(e as Error).message}`);
  }
}

export async function load(globalPath: string, projectPath: string): Promise<Config> {
  const g = await readFile(globalPath);
  const p = await readFile(projectPath);
  return {
    model: p.model ?? g.model ?? "auto",
    context_window: p.context_window ?? g.context_window,
    lsp: { ...(g.lsp ?? {}), ...(p.lsp ?? {}) },
  };
}
