import React from "react";
import { render } from "ink-testing-library";
import { describe, expect, it } from "vitest";
import { Sidebar } from "../src/tui/sidebar.js";

describe("sidebar", () => {
  it("shows recorded usage, unknown context, and LSP diagnostics", () => {
    const view = render(React.createElement(Sidebar, {
      width: 30,
      title: "Greeting",
      usage: {
        turn: { inputTokens: 12, outputTokens: 3 },
        session: { inputTokens: 1050, outputTokens: 200 },
        lastRequest: { inputTokens: 12, outputTokens: 3 },
        partial: true,
      },
      lsp: [{ name: "TypeScript", state: "ready", errors: 2, warnings: 1 }],
    }));
    const frame = view.lastFrame() ?? "";
    expect(frame).toContain("Greeting");
    expect(frame).toContain("Context");
    expect(frame).toContain("1,250 session tokens*");
    expect(frame).toContain("12 tokens");
    expect(frame).toContain("2 errors · 1 warnings");
    view.unmount();
  });
});
