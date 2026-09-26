import type { Service } from "../permission/service.js";
import type {
  Event as ProviderEvent,
  Message,
  Provider,
  ToolCall,
  Usage,
} from "../provider/types.js";
import * as session from "../session/store.js";
import type { Session } from "../session/types.js";
import type { Registry } from "../tool/registry.js";
import type { Result } from "../tool/types.js";
import type { UsageLedger } from "../session/usage.js";

export type AgentEvent =
  | { kind: "text_delta"; text: string }
  | { kind: "tool_start"; callId: string; toolName: string; toolArgs: string }
  | { kind: "tool_end"; callId: string; toolName: string; result: Result }
  | { kind: "turn_done"; usage: Usage }
  | { kind: "request_usage"; usage: Usage; turnId: string }
  | { kind: "error"; error: Error };

export interface Agent {
  provider: Provider;
  model: string;
  maxTokens: number;
  system: string;
  tools: Registry;
  perms: Service;
  session: Session;
  usage?: UsageLedger;
  onFile?: (file: string, changed: boolean) => Promise<void>;
}

// send runs one or more model turns until the model produces no tool calls.
// It appends each message to the session, dispatches tool calls through the
// permission service, and yields AgentEvents for the TUI to render. The
// returned async iterable respects ctx/abort: if signal aborts mid-stream the
// generator returns cleanly (no error event) and the provider's stream is
// torn down via its AbortSignal handling.
export async function* send(
  a: Agent,
  text: string,
  signal?: AbortSignal,
): AsyncIterable<AgentEvent> {
  await session.append(a.session, { role: "user", content: text });
  const usage: Usage = { inputTokens: 0, outputTokens: 0 };
  const turnId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let requestNumber = 0;
  try {
    outer: while (true) {
      if (signal?.aborted) return;
      const events = a.provider.stream(
        {
          model: a.model,
          system: a.system,
          messages: a.session.messages,
          tools: a.tools.defs(),
          maxTokens: a.maxTokens,
        },
        signal,
      );
      const requestId = `${turnId}-${requestNumber++}`;

      let textBuf = "";
      const calls: ToolCall[] = [];
      for await (const ev of events) {
        if (signal?.aborted) return;
        switch (ev.kind) {
          case "text_delta":
            textBuf += ev.text;
            yield { kind: "text_delta", text: ev.text };
            break;
          case "tool_call":
            calls.push(ev.toolCall);
            break;
          case "tool_start":
            yield { kind: "tool_start", callId: ev.callId, toolName: ev.name, toolArgs: ev.args };
            break;
          case "tool_end":
            yield { kind: "tool_end", callId: ev.callId, toolName: ev.name,
              result: { content: ev.result ?? (ev.success ? "completed" : "failed"), isError: !ev.success } };
            break;
          case "done":
            usage.inputTokens += ev.usage.inputTokens;
            usage.outputTokens += ev.usage.outputTokens;
            if (ev.usage.reported === false) {
              a.usage?.markPartial();
              yield { kind: "request_usage", usage: ev.usage, turnId };
              break;
            }
            if (a.usage) {
              try { await a.usage.record(requestId, turnId, ev.usage); }
              catch { /* usage storage failure must not interrupt a model turn */ }
            }
            yield { kind: "request_usage", usage: ev.usage, turnId };
            break;
          case "error":
            yield { kind: "error", error: ev.error };
            return;
        }
      }

      await session.append(a.session, {
        role: "assistant",
        content: textBuf,
        toolCalls: calls,
      });

      if (calls.length === 0) {
        yield { kind: "turn_done", usage };
        return;
      }

      for (const c of calls) {
        const args = typeof c.input === "string" ? c.input : JSON.stringify(c.input);
        yield { kind: "tool_start", callId: c.id, toolName: c.name, toolArgs: args };
        const result = await runTool(a, c, signal);
        if (!result.isError && a.onFile && ["read", "write", "edit"].includes(c.name) &&
            c.input && typeof c.input === "object" && "file_path" in c.input &&
            typeof c.input.file_path === "string") {
          try { await a.onFile(c.input.file_path, c.name !== "read"); } catch { /* LSP must not block tools */ }
        }
        if (signal?.aborted) break outer;
        yield { kind: "tool_end", callId: c.id, toolName: c.name, result };
        await session.append(a.session, {
          role: "tool",
          content: result.content,
          toolCallId: c.id,
          isError: result.isError,
        });
      }
    }
  } catch (e) {
    // Uncaught throws (e.g. a tool's run() rejecting unexpectedly) surface
    // as a single error event rather than crashing the process. Permission
    // denials, tool errors and provider errors are handled in-band above.
    yield { kind: "error", error: e as Error };
  }
}

async function runTool(a: Agent, c: ToolCall, signal?: AbortSignal): Promise<Result> {
  const t = a.tools.get(c.name);
  if (!t) return { content: `unknown tool: ${c.name}`, isError: true };
  if (t.mutating()) {
    const args = typeof c.input === "string" ? c.input : JSON.stringify(c.input);
    const allowed = await a.perms.allowed({ toolName: c.name, description: args });
    if (!allowed) {
      return { content: "User denied permission for this tool call.", isError: true };
    }
  }
  try {
    return await t.run(c.input, signal);
  } catch (e) {
    return { content: (e as Error).message, isError: true };
  }
}
