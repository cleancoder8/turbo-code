import type { AskFn, Decision, Request } from "./types.js";

export class Service {
  private readonly ask: AskFn;
  private readonly always = new Set<string>();

  constructor(ask: AskFn) {
    this.ask = ask;
  }

  async allowed(req: Request, forcePrompt = false): Promise<boolean> {
    if (!forcePrompt && this.always.has(req.toolName)) return true;
    const decision: Decision = await this.ask(req);
    switch (decision) {
      case "allow_always":
        this.always.add(req.toolName);
        return true;
      case "allow_once":
        return true;
      default:
        return false;
    }
  }
}
