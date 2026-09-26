import { promises as fs } from "node:fs";
import { defineTool, fail, ok } from "./types.js";

interface ReadParams {
  file_path: string;
  offset?: number;
  limit?: number;
}

const DEFAULT_LIMIT = 2000;

export const Read = defineTool<ReadParams>({
  name: "read",
  description:
    "Read a file with line numbers. Params: file_path, optional offset (1-based line) and limit.",
  schema: {
    type: "object",
    properties: {
      file_path: { type: "string" },
      offset: { type: "integer" },
      limit: { type: "integer" },
    },
    required: ["file_path"],
  },
  mutating: false,
  async run(p) {
    let buf: Buffer;
    try {
      buf = await fs.readFile(p.file_path);
    } catch (e) {
      return fail((e as Error).message);
    }
    const text = buf.toString("utf8").replace(/\n$/, "");
    const lines = text.split("\n");
    const start = Math.max(1, p.offset ?? 1);
    const limit = p.limit && p.limit > 0 ? p.limit : DEFAULT_LIMIT;
    const end = Math.min(lines.length, start - 1 + limit);
    const out: string[] = [];
    for (let i = start - 1; i < end; i++) {
      out.push(`${(i + 1).toString().padStart(6)}\t${lines[i] ?? ""}`);
    }
    return ok(out.join("\n") + "\n");
  },
});
