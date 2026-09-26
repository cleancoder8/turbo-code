import { spawn } from "node:child_process";
import { defineTool, fail, ok, type Result } from "./types.js";

interface BashParams {
  command: string;
  timeout_seconds?: number;
}

const MAX_OUTPUT = 30000;
const DEFAULT_TIMEOUT_S = 60;
const MAX_TIMEOUT_S = 600;

export const Bash = defineTool<BashParams>({
  name: "bash",
  description:
    "Run a shell command via bash -c. Params: command, optional timeout_seconds (default 60, max 600).",
  schema: {
    type: "object",
    properties: {
      command: { type: "string" },
      timeout_seconds: { type: "integer" },
    },
    required: ["command"],
  },
  mutating: true,
  run(p, signal) {
    return new Promise<Result>((resolve) => {
      let timeoutS = p.timeout_seconds ?? DEFAULT_TIMEOUT_S;
      if (timeoutS <= 0) timeoutS = DEFAULT_TIMEOUT_S;
      if (timeoutS > MAX_TIMEOUT_S) timeoutS = MAX_TIMEOUT_S;

      const child = spawn("bash", ["-c", p.command], {
        stdio: ["ignore", "pipe", "pipe"],
        signal,
      });
      const outChunks: Buffer[] = [];
      const errChunks: Buffer[] = [];
      child.stdout.on("data", (c: Buffer) => outChunks.push(c));
      child.stderr.on("data", (c: Buffer) => errChunks.push(c));

      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, timeoutS * 1000);

      child.on("error", (e) => {
        clearTimeout(timer);
        resolve(fail(e.message));
      });

      child.on("close", (code) => {
        clearTimeout(timer);
        const stderr = Buffer.concat(errChunks).toString("utf8");
        const stdout = Buffer.concat(outChunks).toString("utf8");
        let content = stderr ? `${stderr}${stdout}` : stdout;
        if (content.length > MAX_OUTPUT) {
          content = content.slice(0, MAX_OUTPUT) + "\n[output truncated]";
        }
        if (timedOut) {
          resolve(fail(content + "\n[command timed out]"));
          return;
        }
        if (code !== 0) {
          resolve(fail(content + (content.endsWith("\n") ? "" : "\n") + `[exit ${code}]`));
          return;
        }
        resolve(ok(content));
      });
    });
  },
});
