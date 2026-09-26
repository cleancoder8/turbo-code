import { send, type Agent, type AgentEvent } from "../agent/index.js";
import type { Decision, Request as PermRequest } from "../permission/types.js";
import { Service as PermService } from "../permission/service.js";

export interface AskHandler {
  (req: PermRequest): Promise<Decision>;
}

// wirePerms replaces the agent's permission service with one that calls `ask`.
// Called once on mount; the asker itself runs in the TUI's UI thread so it
// can wait for user input.
export function wirePerms(agent: Agent, ask: AskHandler): void {
  agent.perms = new PermService(ask);
}

// runAgent consumes one user turn: appends the user message, drives the
// agent's async-iterable event stream, and invokes the per-event callbacks.
// It supports cancellation via AbortSignal. The returned promise resolves
// when the turn ends (turn_done, error, or abort).
export async function runAgent(
  agent: Agent,
  text: string,
  signal: AbortSignal,
  handlers: {
    onText: (text: string) => void;
    onToolStart: (callId: string, name: string, args: string) => void;
    onToolEnd: (callId: string, ok: boolean, result: string) => void;
    onDone: (usage: { inputTokens: number; outputTokens: number }) => void;
    onUsage?: (usage: { inputTokens: number; outputTokens: number }, turnId: string) => void;
    onError: (err: Error) => void;
  },
): Promise<void> {
  try {
    for await (const ev of send(agent, text, signal)) {
      handle(ev, handlers);
    }
  } catch (e) {
    handlers.onError(e as Error);
  }
}

function handle(
  ev: AgentEvent,
  h: {
    onText: (text: string) => void;
    onToolStart: (callId: string, name: string, args: string) => void;
    onToolEnd: (callId: string, ok: boolean, result: string) => void;
    onDone: (usage: { inputTokens: number; outputTokens: number }) => void;
    onUsage?: (usage: { inputTokens: number; outputTokens: number }, turnId: string) => void;
    onError: (err: Error) => void;
  },
): void {
  switch (ev.kind) {
    case "text_delta":
      h.onText(ev.text);
      break;
    case "tool_start":
      h.onToolStart(ev.callId, ev.toolName, ev.toolArgs);
      break;
    case "tool_end": {
      h.onToolEnd(ev.callId, !ev.result.isError, ev.result.content);
      break;
    }
    case "turn_done":
      h.onDone(ev.usage);
      break;
    case "request_usage":
      h.onUsage?.(ev.usage, ev.turnId);
      break;
    case "error":
      h.onError(ev.error);
      break;
  }
}
