import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../src/tui/markdown.js";
import { userBlock, assistantBlock, toolLine, permView, footer } from "../src/tui/blocks.js";

describe("tui rendering helpers", () => {
  it("renders markdown with width applied", () => {
    const out = renderMarkdown("# heading\n\nbody text", 60);
    // The exact ANSI codes depend on the terminal renderer; just check the
    // text survives.
    expect(out).toContain("heading");
    expect(out).toContain("body text");
  });

  it("builds user blocks with left bar", () => {
    const out = userBlock("hello\nworld", 80);
    expect(out.startsWith("\x1b[")).toBe(true); // starts with a styled ┃
    expect(out).toContain("hello");
    expect(out).toContain("world");
  });

  it("builds assistant blocks indented by 3 spaces", () => {
    const out = assistantBlock("just text", 80);
    const firstLine = out.split("\n", 1)[0]!;
    expect(firstLine.startsWith("   ")).toBe(true);
  });

  it("truncates long tool args", () => {
    const long = "x".repeat(200);
    const out = toolLine("echo", long, 80);
    expect(out).toContain("…");
    expect(out).toContain("echo");
  });

  it("renders permission prompt", () => {
    const out = permView({ toolName: "bash", description: "rm -rf /" }, 80);
    expect(out).toContain("permission: bash");
    expect(out).toContain("[y]");
    expect(out).toContain("[a]");
    expect(out).toContain("[n]");
  });

  it("renders footer with cwd and status", () => {
    const out = footer("/some/long/path/to/working/directory", "ready", 80);
    expect(out).toContain("ready");
    expect(out.length).toBeGreaterThan(0);
  });
});
