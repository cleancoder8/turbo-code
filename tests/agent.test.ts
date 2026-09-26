import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import * as session from "../src/session/store.js";
import { defineTool, type Tool } from "../src/tool/types.js";
import { Registry } from "../src/tool/registry.js";
import { Service } from "../src/permission/service.js";
import { FakeProvider } from "../src/provider/fake.js";
import { send, type Agent } from "../src/agent/agent.js";
import type { Event } from "../src/provider/types.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "turbo-code-agent-"));
});

function makeAgent(events: Event[][], tool: Tool, ask: (req: { toolName: string; description: string }) => "deny" | "allow_once" | "allow_always"): Promise<Agent> {
  return (async () => {
    const sess = await session.create(dir, "test");
    return {
      provider: new FakeProvider({ events }),
      model: "fake-model",
      maxTokens: 1024,
      system: "test",
      tools: new Registry([tool]),
      perms: new Service(ask),
      session: sess,
    };
  })();
}

async function collectEvents(iter: AsyncIterable<import("../src/agent/agent.js").AgentEvent>): Promise<import("../src/agent/agent.js").AgentEvent[]> {
  const out: import("../src/agent/agent.js").AgentEvent[] = [];
  for await (const ev of iter) out.push(ev);
  return out;
}

const echo = (mutating = false): Tool =>
  defineTool<Record<string, unknown>>({
    name: "echo",
    description: "echoes input",
    schema: { type: "object" },
    mutating,
    run: async (params) => ({ content: "echo:" + JSON.stringify(params), isError: false }),
  });

const boom = (): Tool =>
  defineTool<Record<string, unknown>>({
    name: "boom",
    description: "always panics",
    schema: { type: "object" },
    mutating: false,
    run: async () => {
      throw new Error("kaboom");
    },
  });

describe("agent.send", () => {
  it("text-only turn yields text_delta and turn_done", async () => {
    const a = await makeAgent(
      [
        [
          { kind: "text_delta", text: "hi" },
          { kind: "done", usage: { inputTokens: 0, outputTokens: 1 } },
        ],
      ],
      echo(),
      () => "deny",
    );
    const evs = await collectEvents(send(a, "hello"));
    expect(evs[0]!.kind).toBe("text_delta");
    expect(evs[evs.length - 1]!.kind).toBe("turn_done");
    expect(a.session.messages.length).toBe(2);
    expect(a.session.messages[1]!.role).toBe("assistant");
  });

  it("tool-call loop sends tool result back to provider", async () => {
    const a = await makeAgent(
      [
        [
          {
            kind: "tool_call",
            toolCall: { id: "c1", name: "echo", input: { x: 1 } },
          },
          { kind: "done", usage: { inputTokens: 0, outputTokens: 0 } },
        ],
        [
          { kind: "text_delta", text: "done" },
          { kind: "done", usage: { inputTokens: 0, outputTokens: 0 } },
        ],
      ],
      echo(),
      () => "deny",
    );
    const evs = await collectEvents(send(a, "go"));
    let sawStart = false;
    let sawEnd = false;
    for (const ev of evs) {
      if (ev.kind === "tool_start" && ev.toolName === "echo") sawStart = true;
      if (ev.kind === "tool_end" && ev.result.content === 'echo:{"x":1}') sawEnd = true;
    }
    expect(sawStart).toBe(true);
    expect(sawEnd).toBe(true);

    const fp = a.provider as FakeProvider;
    const second = fp.calls[1]!;
    // The second provider call's request must contain the tool result
    // message we appended after running the echo tool. We check by content
    // rather than position because the agent appends a second assistant
    // message after the stream completes, and the captured messages array
    // shares storage with the session.
    const toolMsg = second.messages.find(
      (m) => m.role === "tool" && m.toolCallId === "c1",
    );
    expect(toolMsg).toBeDefined();
    expect(toolMsg!.content).toBe('echo:{"x":1}');
  });

  it("denies a mutating tool call and produces an error result", async () => {
    const a = await makeAgent(
      [
        [
          {
            kind: "tool_call",
            toolCall: { id: "c1", name: "echo", input: {} },
          },
          { kind: "done", usage: { inputTokens: 0, outputTokens: 0 } },
        ],
        [{ kind: "done", usage: { inputTokens: 0, outputTokens: 0 } }],
      ],
      echo(true),
      () => "deny",
    );
    const evs = await collectEvents(send(a, "go"));
    const toolEnd = evs.find((e) => e.kind === "tool_end");
    expect(toolEnd).toBeDefined();
    expect(toolEnd!.kind === "tool_end" && toolEnd!.result.isError).toBe(true);
  });

  it("surfaces a tool's thrown error as an isError tool result", async () => {
    // Unlike the Go version (which recovers panics into an EventError), the
    // TS port catches synchronous/rejected tool errors at runTool and
    // surfaces them as Result{isError:true}. The agent loop continues.
    const a = await makeAgent(
      [
        [
          {
            kind: "tool_call",
            toolCall: { id: "c1", name: "boom", input: {} },
          },
          { kind: "done", usage: { inputTokens: 0, outputTokens: 0 } },
        ],
        [{ kind: "done", usage: { inputTokens: 0, outputTokens: 0 } }],
      ],
      boom(),
      () => "allow_once",
    );
    const evs = await collectEvents(send(a, "go"));
    const toolEnd = evs.find((e) => e.kind === "tool_end");
    expect(toolEnd).toBeDefined();
    expect(toolEnd!.kind === "tool_end" && toolEnd!.result.isError).toBe(true);
    expect(toolEnd!.kind === "tool_end" && toolEnd!.result.content).toContain("kaboom");
  });
});
