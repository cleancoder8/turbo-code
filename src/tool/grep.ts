import { promises as fs } from "node:fs";
import path from "node:path";
import { defineTool, fail, ok } from "./types.js";

interface GrepParams {
  pattern: string;
  path?: string;
}

const SKIP_DIRS = new Set([".git", "node_modules", "vendor"]);
const MAX_MATCHES = 200;

export const Grep = defineTool<GrepParams>({
  name: "grep",
  description:
    "Search file contents with a regex. Params: pattern, optional path (default cwd). Output: path:line: text.",
  schema: {
    type: "object",
    properties: {
      pattern: { type: "string" },
      path: { type: "string" },
    },
    required: ["pattern"],
  },
  mutating: false,
  async run(p) {
    let re: RegExp;
    try {
      re = new RegExp(p.pattern);
    } catch (e) {
      return fail(`bad regex: ${(e as Error).message}`);
    }
    const root = p.path && p.path !== "" ? p.path : process.cwd();
    try {
      await fs.access(root);
    } catch (e) {
      return fail((e as Error).message);
    }

    const matches: string[] = [];
    let truncated = false;

    async function walk(dir: string): Promise<void> {
      if (matches.length >= MAX_MATCHES) {
        truncated = true;
        return;
      }
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (matches.length >= MAX_MATCHES) {
          truncated = true;
          return;
        }
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (SKIP_DIRS.has(entry.name)) continue;
          await walk(full);
          continue;
        }
        if (!entry.isFile()) continue;
        let buf: Buffer;
        try {
          buf = await fs.readFile(full);
        } catch {
          continue;
        }
        // Skip binary (contains NUL byte)
        if (buf.includes(0)) continue;
        const text = buf.toString("utf8");
        const lines = text.split("\n");
        const rel = path.relative(root, full);
        for (let i = 0; i < lines.length; i++) {
          if (matches.length >= MAX_MATCHES) {
            truncated = true;
            break;
          }
          if (re.test(lines[i]!)) {
            matches.push(`${rel}:${i + 1}: ${lines[i]}`);
          }
        }
      }
    }

    try {
      await walk(root);
    } catch (e) {
      return fail((e as Error).message);
    }

    if (matches.length === 0) return ok("");
    const suffix = truncated ? "\n[truncated]" : "";
    return ok(matches.join("\n") + "\n" + suffix);
  },
});
