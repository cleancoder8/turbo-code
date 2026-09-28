import { colors, styles, agentChar } from "./theme.js";
import type { Request as PermRequest } from "../permission/types.js";
import { renderMarkdown } from "./markdown.js";

export { styles } from "./theme.js";
export { colors } from "./theme.js";

export const pagePad = 0;

export function contentWidth(termWidth: number): number {
  return Math.max(10, termWidth - 2 * pagePad);
}

export function userBlock(text: string, termWidth: number): string {
  const w = contentWidth(termWidth);
  const innerW = w - 1;
  const textW = innerW - 2;
  const blank = " ".repeat(innerW);
  const wrapped = wrapText(text, textW);
  const out: string[] = [];
  out.push(styles.agent(agentChar) + styles.panel(blank));
  for (const l of wrapped) {
    const body = ("  " + l).padEnd(innerW, " ");
    out.push(styles.agent(agentChar) + styles.panel(body));
  }
  out.push(styles.agent(agentChar) + styles.panel(blank));
  return out.join("\n");
}

export function assistantBlock(md: string, termWidth: number): string {
  const w = contentWidth(termWidth);
  const out = renderMarkdown(md, w - 3);
  return padLeft(out, 3);
}

function formatDuration(ms: number): string {
  return ms > 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

export function thoughtLine(ms: number): string {
  return "  " + styles.warning("+ Thought: " + formatDuration(ms));
}

export function thinkingLine(): string {
  return "  " + styles.warning("+ Thinking…");
}

export function turnLine(model: string, ms: number): string {
  return "  " + styles.accent("■") + "  " + styles.muted(`Build · ${model} · ${formatDuration(ms)}`);
}

export function toolLine(name: string, args: string, termWidth: number): string {
  void contentWidth(termWidth);
  let s = styles.tool("⚙ " + name);
  if (args !== "") {
    let a = args;
    const r = [...a];
    if (r.length > 80) a = r.slice(0, 80).join("") + "…";
    s += styles.tool(" " + a);
  }
  return padLeft(s, 3);
}

function cleanToolText(s: string): string {
  return s
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/\t/g, "    ")
    .replace(/\r/g, "")
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "");
}

function toolPreview(name: string, output: string | undefined, termWidth: number): { text: string; overflow: boolean } {
  if (output === undefined) return { text: "", overflow: false };
  const text = cleanToolText(output).replace(/\n+$/, "");
  const maxLines = name === "bash" ? 10 : 3;
  const maxChars = maxLines * Math.max(20, contentWidth(termWidth) - 6);
  const rows = text.split("\n");
  if (rows.length <= maxLines && [...text].length <= maxChars) return { text, overflow: false };
  const preview = rows.slice(0, maxLines).join("\n");
  if ([...preview].length > maxChars) {
    return { text: [...preview].slice(0, maxChars - 1).join("") + "…", overflow: true };
  }
  return { text: preview + "\n…", overflow: true };
}

export function toolCardOverflow(name: string, output: string | undefined, termWidth: number): boolean {
  return toolPreview(name, output, termWidth).overflow;
}

export function toolCard(name: string, args: string, output: string | undefined, ok: boolean | undefined, termWidth: number, expanded = false): string {
  const w = contentWidth(termWidth);
  const inner = Math.max(1, w - 1);
  let header = name;
  try {
    const parsed = JSON.parse(args) as Record<string, unknown>;
    if (name === "bash" && typeof parsed.command === "string") header = `$ ${parsed.command}`;
    else if (name === "read" && typeof parsed.file_path === "string") header = `→ Read ${parsed.file_path}`;
    else if (name === "write" && typeof parsed.file_path === "string") header = `→ Write ${parsed.file_path}`;
    else if (name === "edit" && typeof parsed.file_path === "string") header = `→ Edit ${parsed.file_path}`;
    else if (args) header = `${name} ${args}`;
  } catch { if (args) header = `${name} ${args}`; }
  const preview = toolPreview(name, output, termWidth);
  if (name === "read" && ok !== false && !preview.overflow) return "  " + styles.tool(cleanToolText(header));
  const line = (s: string, muted = false) => {
    const visible = [...cleanToolText(s)];
    const text = visible.length > inner - 2 ? visible.slice(0, Math.max(0, inner - 3)).join("") + "…" : visible.join("");
    const body = ("  " + text).padEnd(inner, " ");
    return styles.toolBorder("┃") + (muted ? styles.panel.hex(colors.muted)(body) : styles.panel(body));
  };
  const lines = [line(""), line(header), line("")];
  if (output === undefined) lines.push(line("Running…"));
  else {
    const shown = expanded ? cleanToolText(output).replace(/\n+$/, "") : preview.text;
    for (const row of shown.split("\n")) {
      const chars = [...row];
      const rowWidth = Math.max(1, inner - 2);
      if (chars.length === 0) lines.push(line(""));
      else for (let start = 0; start < chars.length; start += rowWidth) {
        lines.push(line(chars.slice(start, start + rowWidth).join("")));
      }
    }
    if (ok === false) lines.push(line("✗ Tool failed"));
    if (preview.overflow) lines.push(line(""), line(expanded ? "Click to collapse" : "Click to expand", true));
  }
  lines.push(line(""));
  return lines.join("\n");
}

export function toolResult(ok: boolean, line: string, termWidth: number): string {
  void contentWidth(termWidth);
  return padLeft(ok ? styles.tool(line) : styles.err("✗ " + line), 3);
}

export function errorBlock(msg: string, termWidth: number): string {
  void contentWidth(termWidth);
  return padLeft(styles.err("error: " + msg), 3);
}

export function permView(req: PermRequest, termWidth: number): string {
  const w = contentWidth(termWidth);
  let description = req.description;
  if (req.toolName === "bash") {
    try {
      const args = JSON.parse(req.description) as { command?: unknown };
      if (typeof args.command === "string") description = `$ ${args.command}`;
    } catch { /* Keep the original description. */ }
  }
  const prefix = w >= 45 ? `permission: ${req.toolName}  ` : `${req.toolName}? `;
  const truncated = truncate(description, Math.max(1, Math.min(80, w - 3 - prefix.length)));
  const line1 = styles.warning(prefix) + truncated;
  const line2 = w >= 45 ? "[y] allow once   [a] always   [n] deny" :
    w >= 30 ? "y once  a always  n deny" : "y/a/n";
  return (
    styles.warning(agentChar) +
    " ".repeat(2) +
    line1 +
    "\n" +
    styles.warning(agentChar) +
    " ".repeat(2) +
    line2
  );
}

export function footer(cwd: string, status: string, termWidth: number): string {
  const w = contentWidth(termWidth);
  const left = styles.muted(truncateMiddle(cwd, Math.floor(w / 2)));
  const right = styles.muted(status);
  const gap = Math.max(0, w - visibleWidth(left) - visibleWidth(right));
  return left + " ".repeat(gap) + right;
}

export function promptLine(text: string, termWidth: number): string {
  void contentWidth(termWidth);
  return styles.agent(agentChar) + "  " + text;
}

export function inputMeta(modelID: string, _termWidth: number): string {
  return styles.agent("build") + styles.muted(" · " + modelID);
}

export function bottomBorder(termWidth: number): string {
  const w = contentWidth(termWidth);
  return styles.agent("╹") + styles.elementBaseline("▀".repeat(w - 1));
}

export function frame(lines: string[], termWidth: number, termHeight: number): string {
  const prefix = " ".repeat(pagePad);
  const out: string[] = [];
  for (const l of lines) {
    out.push(prefix + l);
  }
  while (out.length < termHeight) {
    out.push(prefix);
  }
  return out.join("\n");
}

// --- helpers ---

function padLeft(s: string, n: number): string {
  const prefix = " ".repeat(n);
  return s
    .split("\n")
    .map((l) => prefix + l)
    .join("\n");
}

function visibleWidth(s: string): number {
  // Strip ANSI escape sequences for width measurement
  // eslint-disable-next-line no-control-regex
  return [...s.replace(/\x1b\[[0-9;]*m/g, "")].length;
}

function wrapText(s: string, w: number): string[] {
  if (w <= 0) return [s];
  const words = s.split(/(\s+)/);
  const lines: string[] = [];
  let cur = "";
  for (const tok of words) {
    if ((cur + tok).length > w && cur !== "") {
      lines.push(cur.trimEnd());
      cur = tok.trimStart();
    } else {
      cur += tok;
    }
  }
  if (cur !== "") lines.push(cur.trimEnd());
  return lines;
}

function truncate(s: string, n: number): string {
  const r = [...s];
  if (r.length <= n) return s;
  return r.slice(0, n).join("") + "…";
}

function truncateMiddle(s: string, n: number): string {
  if (n < 4) n = 4;
  const r = [...s];
  if (r.length <= n) return s;
  const half = Math.floor((n - 1) / 2);
  return r.slice(0, half).join("") + "…" + r.slice(r.length - (n - 1 - half)).join("");
}
