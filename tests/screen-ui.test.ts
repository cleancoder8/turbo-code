import React from "react";
import { EventEmitter } from "node:events";
import { Box } from "ink";
import { render } from "ink-testing-library";
import { describe, expect, it, vi } from "vitest";
import { Composer, Welcome } from "../src/tui/screen.js";
import { App } from "../src/tui/app.js";
import type { Agent } from "../src/agent/index.js";

const noop = () => {};

describe("welcome and chat composer", () => {
  it("centers a branded welcome prompt with model and input guidance", () => {
    const view = render(React.createElement(Box, { width: 80, height: 24 },
      React.createElement(Welcome, { width: 80, model: "gpt-5", value: "", busy: true, onChange: noop, onSubmit: noop })));
    const frame = view.lastFrame() ?? "";
    expect(frame).toContain("┏━╸┏━┓");
    expect(frame).toContain("build");
    expect(frame).toContain("gpt-5");
    expect(frame).toContain("enter send");
    view.unmount();
  });

  it("renders the chat composer as a compact three-line panel", () => {
    const view = render(React.createElement(Composer, {
      width: 48, model: "gpt-5", value: "", busy: true, onChange: noop, onSubmit: noop,
    }));
    const frame = view.lastFrame() ?? "";
    expect(frame).toContain("Thinking…");
    expect(frame).toContain("build");
    expect(frame.split("\n")).toHaveLength(3);
    view.unmount();
  });

  it("keeps the panel width when placeholder is replaced by typed text", async () => {
    const proto = EventEmitter.prototype as EventEmitter & { ref?: () => void; unref?: () => void };
    proto.ref = noop;
    proto.unref = noop;
    try {
      const view = render(React.createElement(Composer, {
        width: 48, model: "gpt-5", value: "hi", busy: false, onChange: noop, onSubmit: noop,
      }));
      const rows = (view.lastFrame() ?? "").replace(/\x1b\[[0-9;]*m/g, "").split("\n");
      expect(rows).toHaveLength(3);
      expect(rows.map((line) => [...line].length)).toEqual([48, 48, 48]);
      view.unmount();
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    } finally {
      delete proto.ref;
      delete proto.unref;
    }
  });

  it("submits the typed prompt on Enter", async () => {
    const proto = EventEmitter.prototype as EventEmitter & { ref?: () => void; unref?: () => void };
    proto.ref = noop;
    proto.unref = noop;
    try {
      const submit = vi.fn();
      const view = render(React.createElement(Composer, {
        width: 48, model: "gpt-5", value: "hi", busy: false, onChange: noop, onSubmit: submit,
      }));
      try {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        let chunk: string | null = "\r";
        (view.stdin as typeof view.stdin & { read: () => string | null }).read = () => {
          const next = chunk;
          chunk = null;
          return next;
        };
        view.stdin.emit("readable");
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        expect(submit).toHaveBeenCalledWith("hi");
      } finally {
        view.unmount();
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
    } finally {
      delete proto.ref;
      delete proto.unref;
    }
  });

  it("places a footer below the welcome screen", async () => {
    const proto = EventEmitter.prototype as EventEmitter & { ref?: () => void; unref?: () => void };
    proto.ref = noop;
    proto.unref = noop;
    try {
      const agent = { session: { meta: { title: "New session" }, messages: [] } } as unknown as Agent;
      const view = render(React.createElement(App, {
        agent, modelID: "auto", sessionID: "test", cwd: "/tmp/turbo-code", ask: async () => "deny" as const,
      }));
      const frame = (view.lastFrame() ?? "").replace(/\x1b\[[0-9;]*m/g, "");
      expect(frame).toContain("turbo-code v0.1.0");
      expect(frame).toContain("/tmp/turbo-code");
      view.unmount();
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    } finally {
      delete proto.ref;
      delete proto.unref;
    }
  });

});
