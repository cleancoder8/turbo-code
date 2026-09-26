import React from "react";
import os from "node:os";
import { Box, Text } from "ink";
import type { UsageSnapshot } from "../session/usage.js";
import type { LspStatus } from "../lsp/service.js";
import { colors } from "./theme.js";

const fmt = (n: number): string => n.toLocaleString("en-US");
export function sidebarMaxScroll(height: number, lsp: LspStatus[]): number {
  const rows = 8 + (lsp.length === 0 ? 2 : lsp.reduce((count, item) =>
    count + 1 + Number(item.errors + item.warnings > 0) + Number(item.state === "error" && !!item.detail), 0));
  return Math.max(0, rows - Math.max(1, height - 5));
}

export function Sidebar({ width, height, title, usage, lsp, contextWindow, cwd, branch, scrollOffset = 0 }: {
  width: number; height?: number; title: string; usage: UsageSnapshot; lsp: LspStatus[]; contextWindow?: number; cwd?: string; branch?: string;
  scrollOffset?: number;
}): React.ReactElement {
  const inner = Math.max(8, width - 4);
  const row = (s: string) => s.length > inner ? s.slice(0, inner - 1) + "…" : s;
  const context = usage.lastRequest?.inputTokens;
  const used = usage.session.inputTokens + usage.session.outputTokens;
  const percent = contextWindow && context !== undefined ? Math.round(context / contextWindow * 100) : undefined;
  const lines: { value: string; color?: string; bold?: boolean }[] = [
    { value: title, bold: true },
    { value: "" },
    { value: "Context", bold: true },
    { value: context === undefined ? "No token data yet" : `${fmt(context)} tokens`, color: colors.muted },
    { value: percent === undefined ? "Limit unknown" : `${percent}% used · ${fmt(contextWindow!)} limit`, color: colors.muted },
    { value: `${fmt(used)} session tokens${usage.partial ? "*" : ""}`, color: colors.muted },
    { value: "" },
    { value: "LSP", bold: true },
  ];
  if (lsp.length === 0) {
    lines.push({ value: "LSPs activate as files", color: colors.muted }, { value: "are read", color: colors.muted });
  } else for (const s of lsp) {
    lines.push({ value: `${s.state === "ready" ? "●" : "○"} ${s.name} ${s.state}`, color: s.state === "ready" ? colors.success : colors.muted });
    if (s.errors + s.warnings > 0) lines.push({ value: `  ${s.errors} errors · ${s.warnings} warnings`, color: colors.muted });
    if (s.state === "error" && s.detail) lines.push({ value: `  ${s.detail}`, color: colors.error });
  }
  const shortCwd = cwd?.startsWith(os.homedir()) ? `~${cwd.slice(os.homedir().length)}` : cwd;
  const location = shortCwd ? `${shortCwd}${branch ? `:${branch}` : ""}` : undefined;
  const bodyHeight = Math.max(1, (height ?? lines.length + 5) - 5);
  const offset = Math.min(sidebarMaxScroll(height ?? lines.length + 5, lsp), scrollOffset);
  const visible = lines.slice(offset, offset + bodyHeight);
  const blanks = Math.max(0, bodyHeight - visible.length);
  const panelRow = (value: string, color = colors.text, bold = false, key?: React.Key) =>
    <Text key={key} color={color} bold={bold} backgroundColor={colors.panel}>{`  ${row(value).padEnd(Math.max(0, width - 4), " ")}  `}</Text>;
  return <Box width={width} height={height} flexDirection="column" overflow="hidden">
    {panelRow("", colors.muted, false, "top")}
    {visible.map((line, i) => panelRow(line.value, line.color, line.bold, `line-${offset + i}`))}
    {Array.from({ length: blanks }, (_, i) => panelRow("", colors.muted, false, `blank-${i}`))}
    {panelRow("", colors.muted, false, "gap")}
    {panelRow(location ?? "", colors.muted, false, "location")}
    {panelRow("● turbo-code v0.1.0", colors.muted, false, "version")}
    {panelRow("", colors.muted, false, "bottom")}
  </Box>;
}
