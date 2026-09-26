import { mkdtempSync, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as session from "../src/session/store.js";
import type { Message } from "../src/provider/types.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "turbo-code-session-"));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe("session", () => {
  it("round-trips create / append / load", async () => {
    const s = await session.create(dir, "test session");
    await session.append(s, { role: "user", content: "hi" });
    await session.append(s, { role: "assistant", content: "hello" });
    const loaded = await session.load(dir, s.meta.id);
    expect(loaded.meta.title).toBe("test session");
    expect(loaded.messages.length).toBe(2);
    expect(loaded.messages[1]!.content).toBe("hello");
  });

  it("skips corrupt trailing lines", async () => {
    const s = await session.create(dir, "t");
    await session.append(s, { role: "user", content: "hi" });
    const filePath = path.join(dir, `${s.meta.id}.jsonl`);
    await fs.appendFile(filePath, '{"role":"assist', "utf8");
    const loaded = await session.load(dir, s.meta.id);
    expect(loaded.messages.length).toBe(1);
  });

  it("lists newest first", async () => {
    const a = await session.create(dir, "a");
    await session.append(a, { role: "user", content: "x" });
    const b = await session.create(dir, "b");
    await session.append(b, { role: "user", content: "y" });
    const metas = await session.list(dir);
    expect(metas.length).toBe(2);
    expect(metas[0]!.id > metas[1]!.id).toBe(true);
  });
});
