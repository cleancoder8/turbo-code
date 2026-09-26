import { CopilotClient, type CopilotSession, type PermissionRequest, type PermissionRequestResult } from "@github/copilot-sdk";
import type { Registry } from "../tool/registry.js";
import type { Event, Model, Provider, Request, Usage } from "./types.js";

export interface CopilotOptions {
  model: string;
  sessionId: string;
  resume: boolean;
  workingDirectory: string;
  baseDirectory: string;
  system: string;
  tools: Registry;
  authorize: (name: string, description: string, forcePrompt?: boolean) => Promise<boolean>;
  onFile?: (file: string, changed: boolean) => Promise<void>;
}

export async function copilotPermission(request: PermissionRequest, tools: Registry,
  authorize: CopilotOptions["authorize"]): Promise<PermissionRequestResult> {
  if (request.kind !== "custom-tool") return { kind: "reject", feedback: "Tool is not available in turbo-code." };
  const toolName = request.toolName ?? "";
  const name = toolName.startsWith("tc_") ? toolName.slice(3) : toolName;
  const tool = tools.get(name);
  if (!tool) return { kind: "reject", feedback: "Unknown tool." };
  if (!tool.mutating() && !request.managedApprovalRequired) return { kind: "approve-once" };
  return await authorize(name, JSON.stringify(request.args ?? {}), request.managedApprovalRequired === true)
    ? { kind: "approve-once" } : { kind: "reject" };
}

/** Adapts one persistent Copilot SDK session to the terminal agent's event stream. */
export class CopilotProvider implements Provider {
  constructor(private readonly client: Pick<CopilotClient, "stop">,
    private readonly session: Pick<CopilotSession, "on" | "sendAndWait" | "disconnect" | "abort">,
    private readonly model: string) {}

  static async open(opts: CopilotOptions): Promise<CopilotProvider> {
    const client = new CopilotClient({
      mode: "empty", baseDirectory: opts.baseDirectory, workingDirectory: opts.workingDirectory,
      useLoggedInUser: true,
    });
    try {
      await client.start();
      const names = opts.tools.names();
      const tools = names.map((name) => {
        const tool = opts.tools.get(name)!;
        return {
          name: `tc_${name}`,
          description: tool.description(),
          parameters: tool.schema() as Record<string, unknown>,
          defer: "never" as const,
          handler: async (input: unknown, invocation: { signal?: AbortSignal }) => {
            const result = await tool.run(input, invocation.signal);
            if (!result.isError && opts.onFile && ["read", "write", "edit"].includes(name) &&
                input && typeof input === "object" && "file_path" in input &&
                typeof input.file_path === "string") {
              try { await opts.onFile(input.file_path, name !== "read"); } catch { /* LSP is optional */ }
            }
            if (result.isError) throw new Error(result.content);
            return result.content;
          },
        };
      });
      const onPermissionRequest = (request: PermissionRequest) =>
        copilotPermission(request, opts.tools, opts.authorize);
      const common = {
        model: opts.model,
        streaming: true,
        workingDirectory: opts.workingDirectory,
        systemMessage: { mode: "append" as const, content: opts.system },
        tools,
        availableTools: names.map((name) => `custom:tc_${name}`),
        onPermissionRequest,
      };
      const session = opts.resume
        ? await client.resumeSession(opts.sessionId, common)
        : await client.createSession({ ...common, sessionId: opts.sessionId });
      return new CopilotProvider(client, session, opts.model);
    } catch (e) {
      await client.stop();
      throw e;
    }
  }

  models(): Model[] { return [{ id: this.model, maxTokens: 0 }]; }
  async close(): Promise<void> {
    try { await this.session.disconnect(); }
    finally { await this.client.stop(); }
  }

  async *stream(req: Request, signal?: AbortSignal): AsyncIterable<Event> {
    const prompt = [...req.messages].reverse().find((m) => m.role === "user")?.content;
    if (prompt === undefined) { yield { kind: "error", error: new Error("Missing user message") }; return; }
    const events: Event[] = [];
    let wake: (() => void) | undefined;
    let finished = false;
    const push = (event: Event) => { events.push(event); wake?.(); wake = undefined; };
    const finish = () => { finished = true; wake?.(); wake = undefined; };
    const usage: Usage = { inputTokens: 0, outputTokens: 0 };
    const emittedByMessage = new Map<string, string>();
    const emitMissingText = (content: string | undefined, messageId?: string) => {
      if (!content) return;
      const id = messageId ?? "fallback";
      const emitted = emittedByMessage.get(id) ?? "";
      if (content === emitted) return;
      const delta = content.startsWith(emitted) ? content.slice(emitted.length) : content;
      emittedByMessage.set(id, emitted + delta);
      push({ kind: "text_delta", text: delta });
    };
    const callNames = new Map<string, string>();
    const unsubscribe = this.session.on((event) => {
      if (event.agentId) return;
      switch (event.type) {
        case "assistant.message_delta":
          if (event.data.deltaContent) {
            const id = event.data.messageId ?? "fallback";
            emittedByMessage.set(id, (emittedByMessage.get(id) ?? "") + event.data.deltaContent);
            push({ kind: "text_delta", text: event.data.deltaContent });
          }
          break;
        case "assistant.message":
          emitMissingText(event.data.content, event.data.messageId);
          break;
        case "assistant.usage":
          usage.inputTokens += event.data.inputTokens ?? 0;
          usage.outputTokens += event.data.outputTokens ?? 0;
          break;
        case "tool.execution_start":
          callNames.set(event.data.toolCallId, event.data.toolName.replace(/^tc_/, ""));
          push({ kind: "tool_start", callId: event.data.toolCallId, name: event.data.toolName.replace(/^tc_/, ""),
            args: JSON.stringify(event.data.arguments ?? {}) }); break;
        case "tool.execution_complete":
          push({ kind: "tool_end", callId: event.data.toolCallId,
            name: callNames.get(event.data.toolCallId) ?? "tool", success: event.data.success,
            ...(event.data.result ? { result: event.data.result.detailedContent ?? event.data.result.content } : {}) }); break;
      }
    });
    const abort = () => { void this.session.abort().catch(() => {}); finish(); };
    signal?.addEventListener("abort", abort, { once: true });
    const run = this.session.sendAndWait({ prompt }).then((message) => {
      if (!signal?.aborted) {
        emitMissingText(message?.data.content, message?.data.messageId);
        push({ kind: "done", usage });
      }
      finish();
    }).catch((error: unknown) => {
      if (!signal?.aborted) push({ kind: "error", error: error instanceof Error ? error : new Error(String(error)) });
      finish();
    });
    try {
      while (!finished || events.length > 0) {
        if (events.length > 0) { yield events.shift()!; continue; }
        await new Promise<void>((resolve) => { wake = resolve; });
      }
    } finally {
      signal?.removeEventListener("abort", abort);
      unsubscribe();
      void run;
    }
  }
}
