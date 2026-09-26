import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { load } from "../src/config/load.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "turbo-code-cfg-"));
});

afterEach(() => {
  // mkdtempSync dir is removed by OS; nothing else to do.
});

describe("config", () => {
  it("merges project over global, project wins on default_model", async () => {
    const global = path.join(dir, "global.json");
    writeFileSync(
      global,
      JSON.stringify({
        model: "auto",
        lsp: { typescript: { command: ["typescript-language-server", "--stdio"], extensions: [".ts"] } },
      }),
    );
    const project = path.join(dir, "project.json");
    writeFileSync(
      project,
      JSON.stringify({
        model: "gpt-5",
        context_window: 128000,
        lsp: { typescript: false, go: { command: ["gopls"], extensions: [".go"] } },
      }),
    );

    const c = await load(global, project);
    expect(c.model).toBe("gpt-5");
    expect(c.context_window).toBe(128000);
    expect(c.lsp?.typescript).toBe(false);
    expect(c.lsp?.go).toEqual({ command: ["gopls"], extensions: [".go"] });

  });

  it("treats missing config files as empty", async () => {
    const c = await load("/nonexistent/a.json", "/nonexistent/b.json");
    expect(c.model).toBe("auto");
  });
});
