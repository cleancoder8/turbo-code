import { describe, expect, it } from "vitest";
import { Service } from "../src/permission/service.js";
import type { Decision, Request } from "../src/permission/types.js";

describe("permission.Service", () => {
  it("remembers AllowAlways per tool", async () => {
    let asks = 0;
    const s = new Service((): Decision => {
      asks++;
      return "allow_always";
    });
    expect(await s.allowed({ toolName: "bash", description: "ls" })).toBe(true);
    expect(await s.allowed({ toolName: "bash", description: "rm x" })).toBe(true);
    expect(asks).toBe(1);
  });

  it("Deny and AllowOnce behave as expected", async () => {
    const decisions: Decision[] = ["deny", "allow_once", "deny"];
    let i = 0;
    const s = new Service(() => decisions[i++] ?? "deny");
    expect(await s.allowed({ toolName: "edit", description: "" })).toBe(false);
    expect(await s.allowed({ toolName: "edit", description: "" })).toBe(true);
    expect(await s.allowed({ toolName: "edit", description: "" })).toBe(false);
  });

  it("prompts again when managed approval is required", async () => {
    const decisions: Decision[] = ["allow_always", "deny"];
    const s = new Service(() => decisions.shift() ?? "deny");
    const request = { toolName: "bash", description: "command" };
    expect(await s.allowed(request)).toBe(true);
    expect(await s.allowed(request, true)).toBe(false);
  });
});
