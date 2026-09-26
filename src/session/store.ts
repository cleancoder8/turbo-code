import { promises as fs } from "node:fs";
import path from "node:path";
import type { Message } from "../provider/types.js";
import type { Meta, Session } from "./types.js";

const filename = (dir: string, id: string): string => path.join(dir, `${id}.jsonl`);

const pad2 = (n: number): string => n.toString().padStart(2, "0");

function timestamp(d: Date): string {
  return (
    `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}` +
    `-${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`
  );
}

async function writeLine(filePath: string, value: unknown): Promise<void> {
  await fs.appendFile(filePath, JSON.stringify(value) + "\n", "utf8");
}

export async function create(dir: string, title: string, backend?: "copilot"): Promise<Session> {
  await fs.mkdir(dir, { recursive: true });
  const base = timestamp(new Date());
  let id = base;
  for (let i = 1; ; i++) {
    try {
      await fs.access(filename(dir, id));
    } catch {
      break;
    }
    id = `${base}-${i}`;
  }
  const filePath = filename(dir, id);
  const meta: Meta = { id, title, created: new Date().toISOString(), v: 1,
    ...(backend ? { backend } : {}) };
  await writeLine(filePath, meta);
  return { meta, messages: [], filePath };
}

export async function load(dir: string, id: string): Promise<Session> {
  const filePath = filename(dir, id);
  const raw = await fs.readFile(filePath, "utf8");
  const lines = raw.split("\n");
  if (lines.length === 0 || lines[0] === "") {
    throw new Error(`empty session file: ${filePath}`);
  }
  let meta: Meta;
  try {
    meta = JSON.parse(lines[0]!) as Meta;
  } catch (e) {
    throw new Error(`corrupt meta line: ${(e as Error).message}`);
  }
  const messages: Message[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (line === "") continue;
    try {
      messages.push(JSON.parse(line) as Message);
    } catch {
      break; // corrupt trailing line (crash mid-write): keep what we have
    }
  }
  return { meta, messages, filePath };
}

export async function list(dir: string): Promise<Meta[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
  const metas: Meta[] = [];
  for (const name of entries) {
    if (!name.endsWith(".jsonl")) continue;
    try {
      const raw = await fs.readFile(path.join(dir, name), "utf8");
      const firstLine = raw.split("\n", 1)[0];
      if (!firstLine) continue;
      metas.push(JSON.parse(firstLine) as Meta);
    } catch {
      // skip corrupt
    }
  }
  metas.sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  return metas;
}

export async function append(session: Session, m: Message): Promise<void> {
  await writeLine(session.filePath, m);
  session.messages.push(m);
}
