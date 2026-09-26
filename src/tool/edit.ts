import { promises as fs } from "node:fs";
import { defineTool, fail, ok } from "./types.js";

interface EditParams {
  file_path: string;
  old_string: string;
  new_string: string;
}

export const Edit = defineTool<EditParams>({
  name: "edit",
  description: "Replace an exact unique string in a file. Params: file_path, old_string, new_string.",
  schema: {
    type: "object",
    properties: {
      file_path: { type: "string" },
      old_string: { type: "string" },
      new_string: { type: "string" },
    },
    required: ["file_path", "old_string", "new_string"],
  },
  mutating: true,
  async run(p) {
    let buf: Buffer;
    try {
      buf = await fs.readFile(p.file_path);
    } catch (e) {
      return fail((e as Error).message);
    }
    const text = buf.toString("utf8");
    let count = 0;
    let idx = -1;
    while ((idx = text.indexOf(p.old_string, idx + 1)) !== -1) count++;
    if (count === 0) return fail("old_string not found in file");
    if (count > 1) return fail(`old_string appears ${count} times; must be unique`);
    const next = text.replace(p.old_string, p.new_string);
    try {
      await fs.writeFile(p.file_path, next, "utf8");
    } catch (e) {
      return fail((e as Error).message);
    }
    return ok(`edited ${p.file_path}`);
  },
});
