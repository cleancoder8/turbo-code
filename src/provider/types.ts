export type Role = "user" | "assistant" | "tool";

export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
}

export interface Message {
  role: Role;
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  isError?: boolean;
}

export interface ToolDef {
  name: string;
  description: string;
  schema: unknown;
}

export interface Request {
  model: string;
  system: string;
  messages: Message[];
  tools: ToolDef[];
  maxTokens: number;
}

export type Usage = {
  inputTokens: number;
  outputTokens: number;
  reported?: boolean;
};

export type Event =
  | { kind: "text_delta"; text: string }
  | { kind: "tool_call"; toolCall: ToolCall }
  | { kind: "tool_start"; callId: string; name: string; args: string }
  | { kind: "tool_end"; callId: string; name: string; success: boolean; result?: string }
  | { kind: "done"; usage: Usage }
  | { kind: "error"; error: Error };

export interface Model {
  id: string;
  maxTokens: number;
}

export interface Provider {
  stream(req: Request, signal?: AbortSignal): AsyncIterable<Event>;
  models(): Model[];
  close?(): Promise<void>;
}
