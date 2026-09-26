import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { promises as fs } from "node:fs";
import { watch } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export type LspState = "disabled" | "idle" | "starting" | "ready" | "error";
export interface LspServerConfig { command: string[]; extensions: string[] }
export interface LspStatus { name: string; state: LspState; errors: number; warnings: number; detail?: string }
type Listener = (items: LspStatus[]) => void;

interface Server {
  config: LspServerConfig;
  status: LspStatus;
  child?: ChildProcessWithoutNullStreams;
  buffer: Buffer;
  pending: Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>;
  sequence: number;
  diagnostics: Map<string, { errors: number; warnings: number }>;
  documents: Map<string, number>;
  starting?: Promise<void>;
}

export class LspService {
  private readonly servers = new Map<string, Server>();
  private readonly listeners = new Set<Listener>();
  private readonly watchers = new Map<string, () => void>();
  private closed = false;

  constructor(private readonly root: string, configs: Record<string, LspServerConfig>,
    private readonly authorize: (name: string, command: string[]) => Promise<boolean> = async () => false) {
    for (const [name, config] of Object.entries(configs)) {
      this.servers.set(name, {
        config, status: { name, state: "idle", errors: 0, warnings: 0 },
        buffer: Buffer.alloc(0), pending: new Map(), sequence: 0,
        diagnostics: new Map(), documents: new Map(),
      });
    }
  }

  snapshot(): LspStatus[] { return [...this.servers.values()].map((s) => ({ ...s.status })); }
  subscribe(fn: Listener): () => void { this.listeners.add(fn); fn(this.snapshot()); return () => this.listeners.delete(fn); }
  private emit(): void { for (const fn of this.listeners) fn(this.snapshot()); }

  async touch(file: string, changed: boolean): Promise<void> {
    if (this.closed) return;
    const absolute = path.resolve(this.root, file);
    if (path.relative(this.root, absolute).startsWith("..")) return;
    const extension = path.extname(absolute);
    const uri = pathToFileURL(absolute).href;
    for (const server of this.servers.values()) {
      if (!server.config.extensions.includes(extension)) continue;
      if (!server.starting && server.status.state === "idle") server.starting = this.start(server);
      if (server.starting) await server.starting;
      if (server.status.state !== "ready") continue;
      let content: string;
      try { content = await fs.readFile(absolute, "utf8"); } catch { continue; }
      const oldVersion = server.documents.get(uri);
      const version = (oldVersion ?? 0) + 1;
      server.documents.set(uri, version);
      if (oldVersion === undefined) {
        const languageId = extension === ".go" ? "go" : extension === ".tsx" ? "typescriptreact" :
          extension === ".jsx" ? "javascriptreact" : extension === ".js" ? "javascript" : "typescript";
        this.notify(server, "textDocument/didOpen", {
          textDocument: { uri, languageId, version, text: content },
        });
        const watchKey = `${server.status.name}:${absolute}`;
        if (!this.watchers.has(watchKey)) {
          let scheduled: NodeJS.Timeout | undefined;
          const watcher = watch(absolute, () => {
            if (scheduled) clearTimeout(scheduled);
            scheduled = setTimeout(() => { void this.touch(absolute, true); }, 150);
          });
          watcher.on("error", () => { watcher.close(); });
          this.watchers.set(watchKey, () => { if (scheduled) clearTimeout(scheduled); watcher.close(); });
        }
      }
      else if (changed) {
        this.notify(server, "textDocument/didChange", { textDocument: { uri, version }, contentChanges: [{ text: content }] });
        this.notify(server, "textDocument/didSave", { textDocument: { uri } });
      }
    }
  }

  private async start(server: Server): Promise<void> {
    server.status = { ...server.status, state: "starting" }; this.emit();
    const [command, ...args] = server.config.command;
    if (!command) { server.status = { ...server.status, state: "error", detail: "No command configured" }; this.emit(); return; }
    try {
      if (!await this.authorize(server.status.name, server.config.command)) {
        server.status = { ...server.status, state: "disabled", detail: "Permission denied" }; this.emit(); return;
      }
      const child = spawn(command, args, { cwd: this.root, stdio: "pipe", env: process.env });
      server.child = child;
      child.stdout.on("data", (chunk: Buffer) => this.receive(server, chunk));
      let stderr = "";
      child.stderr.on("data", (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-400); });
      child.on("error", (e) => this.fail(server, e.message));
      child.on("exit", (code) => { if (!this.closed) this.fail(server, stderr.trim() || `server exited (${code})`); });
      const result = await this.request(server, "initialize", {
        processId: process.pid, rootUri: pathToFileURL(this.root).href,
        capabilities: { textDocument: { publishDiagnostics: {} } },
        workspaceFolders: [{ uri: pathToFileURL(this.root).href, name: path.basename(this.root) }],
      });
      if (!result || typeof result !== "object") throw new Error("invalid initialize response");
      this.notify(server, "initialized", {});
      server.status = { ...server.status, state: "ready", detail: undefined }; this.emit();
    } catch (e) { this.fail(server, (e as Error).message); }
  }

  private fail(server: Server, detail: string): void {
    if (this.closed || server.status.state === "error") return;
    server.status = { ...server.status, state: "error", detail };
    for (const p of server.pending.values()) { clearTimeout(p.timer); p.reject(new Error(detail)); }
    server.pending.clear(); server.child?.kill(); this.emit();
  }

  private send(server: Server, payload: object): void {
    if (!server.child?.stdin.writable) throw new Error("LSP server is unavailable");
    const body = Buffer.from(JSON.stringify(payload));
    server.child.stdin.write(`Content-Length: ${body.length}\r\n\r\n`);
    server.child.stdin.write(body);
  }
  private notify(server: Server, method: string, params: unknown): void { this.send(server, { jsonrpc: "2.0", method, params }); }
  private request(server: Server, method: string, params: unknown): Promise<unknown> {
    const id = ++server.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { server.pending.delete(id); reject(new Error(`${method} timed out`)); }, 5000);
      server.pending.set(id, { resolve, reject, timer });
      try { this.send(server, { jsonrpc: "2.0", id, method, params }); }
      catch (e) { clearTimeout(timer); server.pending.delete(id); reject(e); }
    });
  }
  private receive(server: Server, chunk: Buffer): void {
    server.buffer = Buffer.concat([server.buffer, chunk]);
    while (true) {
      const end = server.buffer.indexOf("\r\n\r\n");
      if (end < 0) return;
      const match = /(?:^|\r\n)Content-Length:\s*(\d+)/i.exec(server.buffer.subarray(0, end).toString());
      if (!match) { this.fail(server, "invalid LSP header"); return; }
      const length = Number(match[1]);
      if (!Number.isSafeInteger(length) || length < 0 || length > 8_000_000) { this.fail(server, "invalid LSP message size"); return; }
      if (server.buffer.length < end + 4 + length) return;
      const body = server.buffer.subarray(end + 4, end + 4 + length);
      server.buffer = server.buffer.subarray(end + 4 + length);
      try { this.message(server, JSON.parse(body.toString("utf8")) as Record<string, unknown>); }
      catch { this.fail(server, "invalid LSP JSON"); return; }
    }
  }
  private message(server: Server, msg: Record<string, unknown>): void {
    if (typeof msg.id === "number" && server.pending.has(msg.id)) {
      const p = server.pending.get(msg.id)!; clearTimeout(p.timer); server.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(JSON.stringify(msg.error))); else p.resolve(msg.result);
    } else if (typeof msg.id === "number" && typeof msg.method === "string") {
      let result: unknown = null;
      if (msg.method === "workspace/configuration") {
        const items = (msg.params as { items?: unknown[] } | undefined)?.items;
        result = Array.isArray(items) ? items.map(() => null) : [];
      } else if (msg.method === "workspace/workspaceFolders") {
        result = [{ uri: pathToFileURL(this.root).href, name: path.basename(this.root) }];
      }
      this.send(server, { jsonrpc: "2.0", id: msg.id, result });
    } else if (msg.method === "textDocument/publishDiagnostics") {
      const params = msg.params as { uri?: string; version?: number; diagnostics?: { severity?: number }[] } | undefined;
      if (!params?.uri || !Array.isArray(params.diagnostics)) return;
      const known = server.documents.get(params.uri);
      if (known !== undefined && params.version !== undefined && params.version < known) return;
      server.diagnostics.set(params.uri, {
        errors: params.diagnostics.filter((d) => d.severity === 1).length,
        warnings: params.diagnostics.filter((d) => d.severity === 2).length,
      });
      server.status = { ...server.status,
        errors: [...server.diagnostics.values()].reduce((n, d) => n + d.errors, 0),
        warnings: [...server.diagnostics.values()].reduce((n, d) => n + d.warnings, 0),
      }; this.emit();
    }
  }

  async dispose(): Promise<void> {
    for (const stop of this.watchers.values()) stop();
    this.watchers.clear();
    for (const server of this.servers.values()) {
      if (server.status.state === "ready") {
        try { await this.request(server, "shutdown", null); this.notify(server, "exit", {}); } catch { /* closing */ }
      }
      server.child?.kill();
      for (const p of server.pending.values()) { clearTimeout(p.timer); p.reject(new Error("LSP closed")); }
      server.pending.clear();
    }
    this.closed = true; this.listeners.clear();
  }
}
