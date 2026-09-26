import { describe, expect, it, vi } from "vitest";
import type { CopilotClient, CopilotSession, PermissionRequest, SessionEvent } from "@github/copilot-sdk";
import { CopilotProvider, copilotPermission } from "../src/provider/copilot.js";
import { Registry } from "../src/tool/registry.js";
import { defineTool } from "../src/tool/types.js";

const registry = new Registry([
  defineTool({ name: "read", description: "read", schema: {}, mutating: false,
    run: async () => ({ content: "data", isError: false }) }),
  defineTool({ name: "bash", description: "run", schema: {}, mutating: true,
    run: async () => ({ content: "done", isError: false }) }),
]);

describe("Copilot adapter", () => {
  it("streams text, tools, and usage from one SDK session", async () => {
    let listener: ((event: SessionEvent) => void) | undefined;
    const stop = vi.fn(async () => {});
    const disconnect = vi.fn(async () => {});
    const sendAndWait = vi.fn(async (_options: { prompt: string }) => {
      listener?.({ type: "assistant.message_delta", data: { deltaContent: "hello" } } as SessionEvent);
      listener?.({ type: "tool.execution_start", data: { toolCallId: "c1", toolName: "tc_read", arguments: { file_path: "a.ts" } } } as unknown as SessionEvent);
      listener?.({ type: "tool.execution_complete", data: { toolCallId: "c1", success: true } } as SessionEvent);
      listener?.({ type: "assistant.usage", data: { model: "auto", inputTokens: 12, outputTokens: 3 } } as SessionEvent);
      return { data: { content: "hello" } };
    });
    const session = { on: (handler: (event: SessionEvent) => void) => { listener = handler; return () => { listener = undefined; }; },
      sendAndWait, abort: vi.fn(async () => {}), disconnect } as unknown as CopilotSession;
    const provider = new CopilotProvider({ stop } as unknown as CopilotClient, session, "auto");
    const events = [];
    for await (const event of provider.stream({ model: "auto", system: "", messages: [{ role: "user", content: "hi" }], tools: [], maxTokens: 1 })) events.push(event);
    expect(sendAndWait).toHaveBeenCalledWith({ prompt: "hi" });
    expect(events).toEqual([
      { kind: "text_delta", text: "hello" },
      { kind: "tool_start", callId: "c1", name: "read", args: '{"file_path":"a.ts"}' },
      { kind: "tool_end", callId: "c1", name: "read", success: true },
      { kind: "done", usage: { inputTokens: 12, outputTokens: 3 } },
    ]);
    await provider.close();
    expect(disconnect).toHaveBeenCalledOnce();
    expect(stop).toHaveBeenCalledOnce();
  });

  it("only authorizes registered custom tools", async () => {
    const authorize = vi.fn(async () => false);
    const request = (kind: string, toolName?: string): PermissionRequest => ({ kind, toolName } as PermissionRequest);
    expect(await copilotPermission(request("custom-tool", "tc_read"), registry, authorize)).toEqual({ kind: "approve-once" });
    expect(authorize).not.toHaveBeenCalled();
    expect(await copilotPermission(request("custom-tool", "tc_bash"), registry, authorize)).toEqual({ kind: "reject" });
    expect(authorize).toHaveBeenCalledOnce();
    expect(await copilotPermission({ ...request("custom-tool", "tc_read"), managedApprovalRequired: true }, registry, authorize)).toEqual({ kind: "reject" });
    expect(authorize).toHaveBeenLastCalledWith("read", expect.any(String), true);
    expect(await copilotPermission(request("shell"), registry, authorize)).toMatchObject({ kind: "reject" });
    expect(await copilotPermission(request("custom-tool", "unknown"), registry, authorize)).toMatchObject({ kind: "reject" });
  });
});
