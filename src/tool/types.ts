import type { ToolDef } from "../provider/types.js";

export interface Result {
  content: string;
  isError: boolean;
}

export interface Tool {
  name(): string;
  description(): string;
  schema(): unknown;
  mutating(): boolean;
  run(params: unknown, signal?: AbortSignal): Promise<Result>;
}

export function defOf(t: Tool): ToolDef {
  return { name: t.name(), description: t.description(), schema: t.schema() };
}

export interface ToolSpec<P> {
  name: string;
  description: string;
  schema: unknown;
  mutating: boolean;
  run: (params: P, signal?: AbortSignal) => Promise<Result>;
}

export function defineTool<P>(spec: ToolSpec<P>): Tool {
  return {
    name: () => spec.name,
    description: () => spec.description,
    schema: () => spec.schema,
    mutating: () => spec.mutating,
    run: (params, signal) => spec.run(params as P, signal),
  };
}

export function ok(content: string): Result {
  return { content, isError: false };
}

export function fail(content: string): Result {
  return { content, isError: true };
}
