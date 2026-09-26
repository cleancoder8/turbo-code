import { describe, expect, it } from "vitest";
import { FakeProvider } from "../src/provider/fake.js";
import type { Event } from "../src/provider/types.js";

describe("FakeProvider", () => {
  it("replays scripted turns and records calls", async () => {
    const events: Event[][] = [
      [
        { kind: "text_delta", text: "hel" },
        { kind: "text_delta", text: "lo" },
        { kind: "done", usage: { inputTokens: 0, outputTokens: 0 } },
      ],
      [{ kind: "done", usage: { inputTokens: 0, outputTokens: 0 } }],
    ];
    const fp = new FakeProvider({ events });
    let got = "";
    for await (const ev of fp.stream({ model: "fake-model", system: "", messages: [], tools: [], maxTokens: 1 })) {
      if (ev.kind === "text_delta") got += ev.text;
    }
    expect(got).toBe("hello");
    for await (const _ of fp.stream({ model: "fake-model", system: "", messages: [], tools: [], maxTokens: 1 })) {
      // drain
    }
    expect(fp.calls.length).toBe(2);
  });
});
