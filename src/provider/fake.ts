import type { Event, Model, Provider, Request } from "./types.js";

export interface FakeProviderOpts {
  events: Event[][];
  models?: Model[];
}

export class FakeProvider implements Provider {
  private readonly scripted: Event[][];
  private readonly availableModels: Model[];
  public readonly calls: Request[] = [];

  constructor(opts: FakeProviderOpts) {
    this.scripted = opts.events;
    this.availableModels = opts.models ?? [{ id: "fake-model", maxTokens: 8192 }];
  }

  models(): Model[] {
    return this.availableModels;
  }

  async *stream(req: Request): AsyncIterable<Event> {
    this.calls.push(req);
    const turn = this.scripted.shift();
    if (!turn) return;
    for (const ev of turn) {
      if (ev.kind === "error") throw ev.error;
      yield ev;
    }
  }
}
