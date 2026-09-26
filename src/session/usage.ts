import { promises as fs } from "node:fs";
import type { Session } from "./types.js";
import type { Usage } from "../provider/types.js";

export interface UsageRecord {
  v: 1;
  id: string;
  turn: string;
  inputTokens: number;
  outputTokens: number;
}

export interface UsageSnapshot {
  turn: Usage;
  session: Usage;
  lastRequest?: Usage;
  partial: boolean;
}

export class UsageLedger {
  private records = new Map<string, UsageRecord>();
  private writeQueue: Promise<void> = Promise.resolve();
  private partial = false;
  private unknownLast = false;
  private readonly file: string;

  private constructor(file: string) { this.file = file; }

  static async open(session: Session): Promise<UsageLedger> {
    const ledger = new UsageLedger(session.filePath.replace(/\.jsonl$/, ".usage.jsonl"));
    let raw: string;
    try { raw = await fs.readFile(ledger.file, "utf8"); }
    catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") {
        ledger.partial = session.messages.length > 0;
        return ledger;
      }
      throw e;
    }
    for (const line of raw.split("\n")) {
      if (!line) continue;
      try {
        const r = JSON.parse(line) as UsageRecord;
        if (r.v !== 1 || typeof r.id !== "string" || typeof r.turn !== "string" ||
            !Number.isFinite(r.inputTokens) || !Number.isFinite(r.outputTokens)) throw new Error("bad usage record");
        ledger.records.set(r.id, r);
      } catch { ledger.partial = true; }
    }
    if (raw && !raw.endsWith("\n")) await fs.appendFile(ledger.file, "\n", "utf8");
    return ledger;
  }

  markPartial(): void { this.partial = true; this.unknownLast = true; }

  snapshot(turn?: string): UsageSnapshot {
    const total: Usage = { inputTokens: 0, outputTokens: 0 };
    const current: Usage = { inputTokens: 0, outputTokens: 0 };
    let last: Usage | undefined;
    for (const r of this.records.values()) {
      total.inputTokens += r.inputTokens;
      total.outputTokens += r.outputTokens;
      if (r.turn === turn) {
        current.inputTokens += r.inputTokens;
        current.outputTokens += r.outputTokens;
      }
      last = { inputTokens: r.inputTokens, outputTokens: r.outputTokens };
    }
    return { turn: current, session: total, ...(last && !this.unknownLast ? { lastRequest: last } : {}), partial: this.partial };
  }

  async record(id: string, turn: string, usage: Usage): Promise<void> {
    if (this.records.has(id)) return;
    const r: UsageRecord = { v: 1, id, turn, ...usage };
    this.records.set(id, r);
    this.unknownLast = false;
    const write = this.writeQueue.catch(() => {}).then(() => fs.appendFile(this.file, JSON.stringify(r) + "\n", "utf8"));
    this.writeQueue = write;
    try { await write; } catch (e) { this.partial = true; throw e; }
  }
}
