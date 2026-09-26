import { promises as fs } from "node:fs";
import path from "node:path";
import { defineTool, fail, ok } from "./types.js";

interface WriteParams {
  file_path: string;
  content: string;
}

export const Write = defineTool<WriteParams>({
  name: "write",
  description: "Write a file (creates parent dirs, overwrites). Params: file_path, content.",
  schema: {
    type: "object",
    properties: {
      file_path: { type: "string" },
      content: { type: "string" },
    },
    required: ["file_path", "content"],
  },
  mutating: true,
  async run(p) {
    try {
      await fs.mkdir(path.dirname(p.file_path), { recursive: true });
      await fs.writeFile(p.file_path, p.content, "utf8");
    } catch (e) {
      return fail((e as Error).message);
    }
    return ok(`wrote ${p.content.length} bytes to ${p.file_path}`);
  },
});
