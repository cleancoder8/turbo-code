import { mkdtempSync, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defineTool, type Tool, type Result } from "../src/tool/types.js";
import { Read } from "../src/tool/read.js";
import { Ls } from "../src/tool/ls.js";
import { Glob } from "../src/tool/glob.js";
import { Grep } from "../src/tool/grep.js";
import { Write } from "../src/tool/write.js";
import { Edit } from "../src/tool/edit.js";
import { Bash } from "../src/tool/bash.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "turbo-code-tool-"));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

async function run(t: Tool, params: unknown): Promise<Result> {
  return await t.run(params);
}

describe("Read", () => {
  it("numbers lines and reports missing file as error", async () => {
    const p = path.join(dir, "a.txt");
    await fs.writeFile(p, "line1\nline2\nline3\n");
    const r = await run(Read, { file_path: p });
    expect(r.isError).toBe(false);
    expect(r.content).toContain("1\tline1");
    expect(r.content).toContain("3\tline3");

    const r2 = await run(Read, { file_path: path.join(dir, "nope") });
    expect(r2.isError).toBe(true);
  });
});

describe("Ls", () => {
  it("lists files and marks dirs with /", async () => {
    await fs.writeFile(path.join(dir, "a.txt"), "x");
    await fs.mkdir(path.join(dir, "sub"));
    const r = await run(Ls, { path: dir });
    expect(r.isError).toBe(false);
    expect(r.content).toContain("a.txt");
    expect(r.content).toContain("sub/");
  });
});

describe("Glob", () => {
  it("finds files under a subdirectory", async () => {
    await fs.writeFile(path.join(dir, "a.txt"), "x");
    await fs.mkdir(path.join(dir, "sub"));
    await fs.writeFile(path.join(dir, "sub", "b.go"), "x");
    const r = await run(Glob, { pattern: "**/*.go", path: dir });
    expect(r.isError).toBe(false);
    expect(r.content).toContain("b.go");
  });
});

describe("Grep", () => {
  it("finds matches and skips .git", async () => {
    await fs.mkdir(path.join(dir, ".git"));
    await fs.writeFile(path.join(dir, "main.go"), "package main\nfunc Target() {}\n");
    await fs.writeFile(path.join(dir, ".git", "junk"), "Target\n");
    const r = await run(Grep, { pattern: "Target", path: dir });
    expect(r.isError).toBe(false);
    expect(r.content).toContain("main.go:2:");
    expect(r.content).not.toContain(".git");
  });

  it("rejects bad regex", async () => {
    const r = await run(Grep, { pattern: "([", path: dir });
    expect(r.isError).toBe(true);
  });
});

describe("Write", () => {
  it("creates parent dirs and writes content", async () => {
    const p = path.join(dir, "new", "file.txt");
    const r = await run(Write, { file_path: p, content: "hello" });
    expect(r.isError).toBe(false);
    const buf = await fs.readFile(p, "utf8");
    expect(buf).toBe("hello");
  });
});

describe("Edit", () => {
  it("replaces a unique old_string", async () => {
    const p = path.join(dir, "f.txt");
    await fs.writeFile(p, "aaa bbb aaa");
    const r = await run(Edit, { file_path: p, old_string: "bbb", new_string: "xxx" });
    expect(r.isError).toBe(false);
    expect(await fs.readFile(p, "utf8")).toBe("aaa xxx aaa");
  });

  it("refuses ambiguous old_string", async () => {
    const p = path.join(dir, "f.txt");
    await fs.writeFile(p, "aaa bbb aaa");
    const r = await run(Edit, { file_path: p, old_string: "aaa", new_string: "y" });
    expect(r.isError).toBe(true);
  });

  it("refuses missing old_string", async () => {
    const p = path.join(dir, "f.txt");
    await fs.writeFile(p, "hello");
    const r = await run(Edit, { file_path: p, old_string: "zzz", new_string: "y" });
    expect(r.isError).toBe(true);
  });
});

describe("Bash", () => {
  it("captures stdout and stderr together", async () => {
    const r = await run(Bash, { command: "echo hello && echo err >&2" });
    expect(r.isError).toBe(false);
    expect(r.content).toContain("hello");
    expect(r.content).toContain("err");
  });

  it("reports non-zero exit as error", async () => {
    const r = await run(Bash, { command: "exit 3" });
    expect(r.isError).toBe(true);
    expect(r.content).toMatch(/exit/);
  });

  it("honors timeout_seconds", async () => {
    const r = await run(Bash, { command: "sleep 5", timeout_seconds: 1 });
    expect(r.isError).toBe(true);
    expect(r.content).toContain("timed out");
  });
});

// Smoke test of the defineTool helper to make sure the registry / spec
// pattern works end-to-end.
describe("defineTool", () => {
  it("wires name/description/schema/mutating from spec", () => {
    const t = defineTool<{ x: number }>({
      name: "noop",
      description: "no",
      schema: { type: "object" },
      mutating: false,
      run: async () => ({ content: "ok", isError: false }),
    });
    expect(t.name()).toBe("noop");
    expect(t.description()).toBe("no");
    expect(t.mutating()).toBe(false);
    expect(t.schema()).toEqual({ type: "object" });
  });
});
