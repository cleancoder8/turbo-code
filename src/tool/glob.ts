import fg from "fast-glob";
import path from "node:path";
import { defineTool, fail, ok } from "./types.js";

interface GlobParams {
  pattern: string;
  path?: string;
}

const MAX_MATCHES = 500;

export const Glob = defineTool<GlobParams>({
  name: "glob",
  description: "Find files by glob pattern (** supported). Params: pattern, optional path (default cwd).",
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
    const cwd = p.path && p.path !== "" ? p.path : process.cwd();
    const absolute = path.isAbsolute(p.pattern);
    const matches = await fg(p.pattern, {
      cwd,
      absolute,
      dot: false,
      onlyFiles: true,
    });
    const trimmed = matches.slice(0, MAX_MATCHES);
    if (trimmed.length === 0) return ok("");
    return ok(trimmed.join("\n") + "\n");
  },
});
