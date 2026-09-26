import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { create, load } from "../src/session/store.js";
import { UsageLedger } from "../src/session/usage.js";
import { LspService } from "../src/lsp/service.js";
import { layout } from "../src/tui/layout.js";

const dirs: string[] = [];
afterEach(async () => { for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true }); });

describe("sidebar services", () => {
  it("reflows at the sidebar threshold", () => {
    expect(layout(80, undefined).sidebarVisible).toBe(false);
    expect(layout(110, undefined).sidebarWidth).toBe(30);
    expect(layout(160, false).sidebarVisible).toBe(false);
  });

  it("persists request usage without duplicate totals", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "turbo-usage-")); dirs.push(dir);
    const session = await create(dir, "usage");
    const ledger = await UsageLedger.open(session);
    await ledger.record("r1", "t1", { inputTokens: 10, outputTokens: 3 });
    await ledger.record("r1", "t1", { inputTokens: 10, outputTokens: 3 });
    await ledger.record("r2", "t1", { inputTokens: 20, outputTokens: 4 });
    const restored = await UsageLedger.open(await load(dir, session.meta.id));
    expect(restored.snapshot("t1").turn).toEqual({ inputTokens: 30, outputTokens: 7 });
    expect(restored.snapshot().session).toEqual({ inputTokens: 30, outputTokens: 7 });
    restored.markPartial();
    expect(restored.snapshot().lastRequest).toBeUndefined();
    expect(restored.snapshot().partial).toBe(true);
  });

  it("starts an LSP, receives and clears diagnostics, and exits", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "turbo-lsp-")); dirs.push(dir);
    const file = path.join(dir, "test.ts");
    await writeFile(file, "const x = 1;\n");
    const fixture = fileURLToPath(new URL("./fixtures/fake-lsp.mjs", import.meta.url));
    const lsp = new LspService(dir, { test: { command: [process.execPath, fixture], extensions: [".ts"] } }, async () => true);
    try {
      await lsp.touch(file, false);
      expect(lsp.snapshot()[0]?.state).toBe("ready");
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
      expect(lsp.snapshot()[0]?.errors).toBe(1);
      expect(lsp.snapshot()[0]?.warnings).toBe(1);
      await writeFile(file, "const x = 2;\n");
      await lsp.touch(file, true);
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
      expect(lsp.snapshot()[0]?.errors).toBe(0);
    } finally { await lsp.dispose(); }
  });
});
