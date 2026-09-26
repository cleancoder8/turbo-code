import React from "react";
import os from "node:os";
import { Box, Text } from "ink";
import type { UsageSnapshot } from "../session/usage.js";
import type { LspStatus } from "../lsp/service.js";
import { colors } from "./theme.js";

const fmt = (n: number): string => n.toLocaleString("en-US");
export function Sidebar({ width, height, title, usage, lsp, contextWindow, cwd, branch }: {
  width: number; height?: number; title: string; usage: UsageSnapshot; lsp: LspStatus[]; contextWindow?: number; cwd?: string; branch?: string;
}): React.ReactElement {
  const inner = Math.max(8, width - 3);
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
  const bottom = [...(location ? [{ value: location, color: colors.muted }, { value: "", color: colors.muted }] : []), { value: "● turbo-code v0.1.0", color: colors.muted }];
  const blanks = Math.max(0, (height ?? lines.length + bottom.length) - lines.length - bottom.length);
  const panelRow = (value: string, color = colors.text, bold = false, key?: React.Key) =>
    <Text key={key} color={color} bold={bold} backgroundColor={colors.panel}>{` ${row(value).padEnd(Math.max(0, width - 2), " ")}`}</Text>;
  return <Box width={width} height={height} flexDirection="column" borderStyle="bold" borderTop={false} borderBottom={false} borderRight={false} borderColor={colors.border}>
    {lines.map((line, i) => panelRow(line.value, line.color, line.bold, `line-${i}`))}
    {Array.from({ length: blanks }, (_, i) => panelRow("", colors.muted, false, `blank-${i}`))}
    {bottom.map((line, i) => panelRow(line.value, line.color, false, `bottom-${i}`))}
  </Box>;
}
