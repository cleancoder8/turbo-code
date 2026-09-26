#!/usr/bin/env node
// Isolated model-transport spike. This does not use the Copilot SDK agent loop.
import { execFileSync } from "node:child_process";

const baseURL = "https://api.githubcopilot.com";
const userAgent = "turbo-code/0.1.0";

function token() {
  for (const name of ["COPILOT_GITHUB_TOKEN", "GH_TOKEN", "GITHUB_TOKEN"]) {
    if (process.env[name]) return process.env[name].trim();
  }
  try {
    return execFileSync("gh", ["auth", "token"], {
      encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    throw new Error("No GitHub token found. Set COPILOT_GITHUB_TOKEN or run `gh auth login`.");
  }
}

function headers(accessToken, initiator = "user") {
  return {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
    "Content-Type": "application/json",
    "User-Agent": userAgent,
    "Openai-Intent": "conversation-edits",
    "x-initiator": initiator,
  };
}

async function checked(response) {
  if (response.ok) return response;
  const body = await response.text();
  let message = body.slice(0, 400);
  try { message = JSON.parse(body).error?.message ?? message; } catch { /* non-JSON error */ }
  throw new Error(`Copilot API ${response.status}: ${message}`);
}

async function discover(accessToken) {
  const response = await checked(await fetch(`${baseURL}/models`, {
    headers: headers(accessToken),
  }));
  const body = await response.json();
  if (!Array.isArray(body.data)) throw new Error("Copilot model list has an unexpected shape.");
  return body.data;
}

async function* sse(response) {
  if (!response.body) throw new Error("Copilot returned no stream body.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      pending += decoder.decode(value, { stream: !done });
      pending = pending.replace(/\r\n/g, "\n");
      let boundary;
      while ((boundary = pending.indexOf("\n\n")) >= 0) {
        const frame = pending.slice(0, boundary);
        pending = pending.slice(boundary + 2);
        const data = frame.split("\n").filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart()).join("\n");
        if (data === "[DONE]") return;
        if (data) yield JSON.parse(data);
      }
      if (done) {
        if (pending.trim()) throw new Error("Incomplete Copilot SSE frame.");
        return;
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

async function completion(accessToken, model, messages, tools, initiator, signal) {
  const response = await checked(await fetch(`${baseURL}/chat/completions`, {
    method: "POST",
    headers: headers(accessToken, initiator),
    body: JSON.stringify({
      model, messages, stream: true,
      ...(tools ? { tools, tool_choice: "required" } : {}),
    }),
    signal,
  }));
  const calls = new Map();
  let text = "";
  let usage;
  for await (const event of sse(response)) {
    if (event.error) throw new Error(event.error.message ?? JSON.stringify(event.error));
    if (event.usage) usage = event.usage;
    const delta = event.choices?.[0]?.delta;
    if (delta?.content) {
      text += delta.content;
      process.stdout.write(delta.content);
    }
    for (const call of delta?.tool_calls ?? []) {
      const item = calls.get(call.index) ?? { id: "", name: "", arguments: "" };
      if (call.id) item.id = call.id;
      if (call.function?.name) item.name += call.function.name;
      if (call.function?.arguments) item.arguments += call.function.arguments;
      calls.set(call.index, item);
    }
  }
  if (text) process.stdout.write("\n");
  return { text, calls: [...calls.values()], usage };
}

async function main() {
  const roundtrip = process.argv.includes("--roundtrip");
  const requested = process.argv.indexOf("--model");
  const requestedModel = requested >= 0 ? process.argv[requested + 1] : undefined;
  if (requested >= 0 && !requestedModel) throw new Error("--model needs a model ID.");
  const accessToken = token();
  const models = await discover(accessToken);
  const eligible = models.filter((item) => item.supported_endpoints?.includes("/chat/completions") &&
    item.policy?.state !== "disabled" && item.capabilities?.supports?.tool_calls);
  console.log(`Copilot model discovery succeeded: ${models.length} models; ${eligible.length} advertise enabled chat/tool access.`);
  if (!roundtrip) {
    console.log("Run `npm run probe:copilot -- --roundtrip` to stream a benign tool-call round trip.");
    return;
  }
  const model = requestedModel ?? (eligible.find((item) => item.id === "gpt-5-mini")?.id ?? eligible[0]?.id);
  if (!model || !eligible.some((item) => item.id === model)) {
    throw new Error(`Model ${model ?? "(none)"} is unavailable for chat completions on this account.`);
  }
  const controller = new AbortController();
  const abort = () => controller.abort();
  process.once("SIGINT", abort);
  try {
    console.log(`Model: ${model}`);
    const messages = [{ role: "user", content: "Call probe_echo with value 'turbo-code', then report the returned value." }];
    const tools = [{ type: "function", function: {
      name: "probe_echo", description: "Return the provided value without side effects.",
      parameters: { type: "object", properties: { value: { type: "string" } }, required: ["value"] },
    } }];
    const first = await completion(accessToken, model, messages, tools, "user", controller.signal);
    if (first.calls.length !== 1 || first.calls[0].name !== "probe_echo" || !first.calls[0].id) {
      throw new Error(`Expected one probe_echo call; received ${first.calls.map((call) => call.name).join(", ") || "none"}.`);
    }
    const call = first.calls[0];
    const args = JSON.parse(call.arguments);
    if (typeof args.value !== "string") throw new Error("probe_echo received invalid arguments.");
    console.log(`Turbo-code executed probe_echo locally: ${JSON.stringify(args.value)}`);
    messages.push({ role: "assistant", content: first.text || null, tool_calls: [{
      id: call.id, type: "function", function: { name: call.name, arguments: call.arguments },
    }] });
    messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify({ value: args.value }) });
    const second = await completion(accessToken, model, messages, undefined, "agent", controller.signal);
    if (!second.text) throw new Error("Copilot returned no final text after the tool result.");
    console.log(`Tool round trip succeeded. Usage reported: ${Boolean(first.usage || second.usage)}.`);
  } finally {
    process.removeListener("SIGINT", abort);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
