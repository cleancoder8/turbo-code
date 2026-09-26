#!/usr/bin/env node
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { promises as fs } from "node:fs";
import { execFileSync } from "node:child_process";
import { load as loadConfig } from "./config/load.js";
import type { Config } from "./config/types.js";
import * as session from "./session/store.js";
import type { Meta } from "./session/types.js";
import * as tool from "./tool/registry.js";
import { Read } from "./tool/read.js";
import { Ls } from "./tool/ls.js";
import { Glob } from "./tool/glob.js";
import { Grep } from "./tool/grep.js";
import { Write } from "./tool/write.js";
import { Edit } from "./tool/edit.js";
import { Bash } from "./tool/bash.js";
import type { CopilotProvider } from "./provider/copilot.js";
import { Service as PermService } from "./permission/service.js";
import { defaultSystemPrompt, send, type Agent } from "./agent/index.js";
import { run as runTUI } from "./tui/run.jsx";
import { UsageLedger } from "./session/usage.js";
import { LspService } from "./lsp/service.js";

function dataDir(): string {
  return path.join(os.homedir(), ".local", "share", "turbo-code");
}

function sessionsDir(): string {
  return path.join(dataDir(), "sessions");
}

function configPaths(): { global: string; project: string } {
  return {
    global: path.join(os.homedir(), ".config", "turbo-code", "config.json"),
    project: "turbo-code.json",
  };
}

async function copilotSessions(): Promise<Meta[]> {
  const metas = (await session.list(sessionsDir())).filter((m) => m.backend === "copilot");
  const usable = await Promise.all(metas.map(async (meta) => {
    try { return (await session.load(sessionsDir(), meta.id)).messages.length > 0 ? meta : undefined; }
    catch { return undefined; }
  }));
  return usable.filter((meta): meta is Meta => meta !== undefined);
}

interface ParsedFlags {
  model?: string;
  continue: boolean;
  subcommand: string | undefined;
}

function parseFlags(argv: string[]): ParsedFlags {
  const out: ParsedFlags = { continue: false, subcommand: undefined };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === undefined) continue;
    if (a === "--model") {
      const next = argv[++i];
      if (next !== undefined) out.model = next;
    } else if (a === "--continue") {
      out.continue = true;
    } else if (!a.startsWith("--") && out.subcommand === undefined) {
      out.subcommand = a;
    }
  }
  return out;
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));
  const { global, project } = configPaths();

  let cfg: Config;
  try {
    cfg = await loadConfig(global, project);
  } catch (e) {
    console.error("config error:", (e as Error).message);
    process.exit(1);
  }

  if (flags.subcommand === "sessions") {
    const metas = await copilotSessions();
    for (const m of metas) {
      console.log(`${m.id}  ${new Date(m.created).toISOString().slice(0, 16).replace("T", " ")}  ${m.title}`);
    }
    return;
  }

  const modelID = flags.model ?? cfg.model;
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major === undefined || minor === undefined || major < 20 ||
      (major === 20 && minor < 19) || major === 21 || (major === 22 && minor < 12)) {
    throw new Error("GitHub Copilot SDK requires Node.js 20.19+ or 22.12+; run nvm install && nvm use");
  }

  let sess;
  let created = false;
  try {
    if (flags.continue) {
      const metas = await copilotSessions();
      if (metas.length === 0) {
        console.error("no session to continue");
        process.exit(1);
      }
      const latest = metas[0];
      if (!latest) {
        console.error("no session to continue");
        process.exit(1);
      }
      sess = await session.load(sessionsDir(), latest.id);
    } else {
      const cwd = process.cwd();
      sess = await session.create(sessionsDir(), path.basename(cwd), "copilot");
      created = true;
    }
  } catch (e) {
    console.error("session error:", (e as Error).message);
    process.exit(1);
  }

  const registry = new tool.Registry([Read, Ls, Glob, Grep, Write, Edit, Bash]);
  const enabledLsp = Object.fromEntries(Object.entries(cfg.lsp ?? {}).filter((entry): entry is [string, { command: string[]; extensions: string[] }] => entry[1] !== false));
  const initialPerms = new PermService(() => "deny");
  let agent: Agent | undefined;
  const lsp = new LspService(process.cwd(), enabledLsp, async (name, command) =>
    (agent?.perms ?? initialPerms).allowed({ toolName: `lsp:${name}`, description: command.join(" ") }));
  let provider: CopilotProvider;
  try {
    const { CopilotProvider } = await import("./provider/copilot.js");
    provider = await CopilotProvider.open({
      model: modelID, sessionId: sess.meta.id, resume: flags.continue,
      workingDirectory: process.cwd(), baseDirectory: path.join(os.homedir(), ".copilot"),
      system: defaultSystemPrompt, tools: registry,
      authorize: (name, description, forcePrompt) =>
        (agent?.perms ?? initialPerms).allowed({ toolName: name, description }, forcePrompt),
      onFile: (file, changed) => lsp.touch(file, changed),
    });
  } catch (e) {
    if (created) await fs.unlink(sess.filePath).catch(() => {});
    throw new Error(`Copilot startup failed: ${(e as Error).message}`);
  }
  // The TUI replaces this deny-all stub with its interactive permission asker.
  agent = {
    provider,
    model: modelID,
    maxTokens: 8192,
    system: defaultSystemPrompt,
    tools: registry,
    perms: initialPerms,
    session: sess,
    usage: await UsageLedger.open(sess),
  };

  // Touch `send` so tree-shakers don't drop the agent module — the agent
  // event types are re-exported through send at runtime only when a turn
  // runs. (No-op import side-effect.)
  void send;

  const cwd = process.cwd();
  let branch: string | undefined;
  try { branch = execFileSync("git", ["branch", "--show-current"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || undefined; }
  catch { /* The current directory may not be a Git repository. */ }
  try {
    await runTUI({ agent, modelID, sessionID: sess.meta.id, cwd, branch, lsp,
      contextWindow: cfg.context_window });
  } finally {
    try { await provider.close(); }
    finally {
      await lsp.dispose();
      if (created && sess.messages.length === 0) await fs.unlink(sess.filePath).catch(() => {});
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
