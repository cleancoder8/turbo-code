import type { ToolDef } from "../provider/types.js";
import { defOf, type Tool } from "./types.js";

export class Registry {
  private readonly tools = new Map<string, Tool>();
  private readonly order: string[] = [];

  constructor(tools: Tool[] = []) {
    for (const t of tools) {
      this.tools.set(t.name(), t);
      this.order.push(t.name());
    }
  }

  register(t: Tool): void {
    if (!this.tools.has(t.name())) {
      this.order.push(t.name());
    }
    this.tools.set(t.name(), t);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  names(): string[] {
    return [...this.order];
  }

  defs(): ToolDef[] {
    return this.order.map((n) => {
      const t = this.tools.get(n);
      if (!t) throw new Error(`registry invariant: missing tool ${n}`);
      return defOf(t);
    });
  }
}
