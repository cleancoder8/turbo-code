import { promises as fs } from "node:fs";
import { defineTool, fail, ok } from "./types.js";

interface LsParams {
  path: string;
}

export const Ls = defineTool<LsParams>({
  name: "ls",
  description: "List directory entries. Params: path. Directories end with /.",
  schema: {
    type: "object",
    properties: { path: { type: "string" } },
    required: ["path"],
  },
  mutating: false,
  async run(p) {
    let entries;
    try {
      entries = await fs.readdir(p.path, { withFileTypes: true });
    } catch (e) {
      return fail((e as Error).message);
    }
    const lines = entries.map((e) => (e.isDirectory() ? `${e.name}/` : e.name));
    return ok(lines.join("\n") + "\n");
  },
});
