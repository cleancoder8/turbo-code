import React from "react";
import { Box, Text } from "ink";
import type { Decision, Request } from "../permission/types.js";
import { colors } from "./theme.js";

export type PermissionStage = "choose" | "always";

function requestInfo(req: Request): { icon: string; title: string; detail: string } {
  let args: Record<string, unknown> = {};
  try { args = JSON.parse(req.description) as Record<string, unknown>; } catch { args = {}; }
  if (req.toolName === "bash" && typeof args.command === "string") {
    return { icon: "#", title: "Shell command", detail: `$ ${args.command}` };
  }
  if ((req.toolName === "write" || req.toolName === "edit") && typeof args.file_path === "string") {
    const change = req.toolName === "edit" && typeof args.old_string === "string" && typeof args.new_string === "string"
      ? `\n- ${args.old_string}\n+ ${args.new_string}`
      : req.toolName === "write" && typeof args.content === "string" ? `\n${args.content}` : "";
    return { icon: "→", title: `${req.toolName === "write" ? "Write" : "Edit"} file`, detail: args.file_path + change };
  }
  if (req.toolName.startsWith("lsp:")) {
    return { icon: "✱", title: `Start ${req.toolName.slice(4)} language server`, detail: req.description };
  }
  return { icon: "⚙", title: `Call ${req.toolName}`, detail: req.description };
}

function wrappedDetail(value: string, width: number): string[] {
  const clean = value.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "").replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "").replace(/\t/g, "    ");
  const rows: string[] = [];
  for (const line of clean.split("\n")) {
    let chars = [...line];
    if (chars.length === 0) { rows.push(""); continue; }
    while (chars.length > width) {
      let end = width;
      for (let i = width - 1; i >= Math.floor(width / 2); i--) {
        if (chars[i] === " ") { end = i + 1; break; }
      }
      rows.push(chars.slice(0, end).join(""));
      chars = chars.slice(end);
    }
    rows.push(chars.join(""));
  }
  return rows.length ? rows : [""];
}

export function permissionLayout(req: Request, width: number, screenHeight: number, stage: PermissionStage, scroll = 0): {
  height: number; body: string[]; maxScroll: number; footerRows: number;
} {
  const detail = stage === "always"
    ? `This will allow every ${req.toolName} request until turbo-code exits.\n\n- All ${req.toolName} requests`
    : requestInfo(req).detail;
  const lines = wrappedDetail(detail, Math.max(8, width - 7));
  const footerRows = width >= 66 ? 2 : 3;
  const baseRows = stage === "always" || req.toolName === "bash" ? 5 : 6;
  const maxBody = Math.max(1, Math.min(9, screenHeight - 9 - baseRows - (footerRows - 1)));
  const bodyCount = Math.min(lines.length, maxBody);
  const maxScroll = Math.max(0, lines.length - bodyCount);
  return { height: bodyCount + baseRows + footerRows - 1, body: lines.slice(Math.min(scroll, maxScroll), Math.min(scroll, maxScroll) + bodyCount), maxScroll, footerRows };
}

export function permissionOptions(stage: PermissionStage): { label: string; decision: Decision | "back" }[] {
  return stage === "always"
    ? [{ label: "Confirm", decision: "allow_always" }, { label: "Cancel", decision: "back" }]
    : [{ label: "Allow once", decision: "allow_once" }, { label: "Allow always", decision: "allow_always" }, { label: "Reject", decision: "deny" }];
}

function optionLabel(label: string, width: number): string {
  if (width < 30) return label === "Allow once" ? "Y" : label === "Allow always" ? "A" : label === "Reject" ? "N" : label === "Confirm" ? "Y" : "N";
  return width < 56 ? label.replace("Allow ", "") : label;
}

export function permissionClickChoice(x: number, panelX: number, width: number, stage: PermissionStage): Decision | "back" | undefined {
  let start = panelX + 2;
  for (const option of permissionOptions(stage)) {
    const label = optionLabel(option.label, width);
    const end = start + label.length + 1;
    if (x >= start && x <= end) return option.decision;
    start = end + 2;
  }
  return undefined;
}

export function PermissionPrompt({ req, width, screenHeight, stage, selected, scroll }: {
  req: Request; width: number; screenHeight: number; stage: PermissionStage;
  selected: Decision | "back"; scroll: number;
}): React.ReactElement {
  const info = requestInfo(req);
  const { body, maxScroll, footerRows } = permissionLayout(req, width, screenHeight, stage, scroll);
  const options = permissionOptions(stage);
  const innerWidth = width - 1;
  const row = (content: React.ReactNode, length: number, backgroundColor = colors.panel) =>
    <Text backgroundColor={backgroundColor}>{content}{" ".repeat(Math.max(0, innerWidth - length))}</Text>;
  const fit = (value: string, max: number) => [...value].length > max ? [...value].slice(0, Math.max(0, max - 1)).join("") + "…" : value;
  const title = fit(stage === "always" ? "Always allow" : "Permission required", innerWidth - 5);
  const subtitle = fit(info.title, innerWidth - 4);
  const optionLength = 1 + options.reduce((total, option) => total + optionLabel(option.label, width).length + 2, 0) + options.length - 1;
  const hint = width < 30
    ? "  ←→ enter · esc"
    : width < 60
    ? `  ←→ select · enter · esc ${stage === "always" ? "back" : "reject"}${maxScroll > 0 ? " · ↑↓ details" : ""}`
    : `  ← → select · enter confirm · esc ${stage === "always" ? "back" : "reject"}${maxScroll > 0 ? " · ↑↓ details" : ""}`;
  const wideHint = "⇆ select  enter confirm";
  const optionRow = <>{" "}{options.map((option, i) => <React.Fragment key={option.decision}>
    {i > 0 && " "}
    <Text color={selected === option.decision ? colors.bg : colors.muted} backgroundColor={selected === option.decision ? colors.primary : colors.element}> {optionLabel(option.label, width)} </Text>
  </React.Fragment>)}</>;
  return <Box width={width} flexDirection="column" borderStyle="bold" borderTop={false} borderRight={false} borderBottom={false} borderColor={colors.primary}>
    {row("", 0)}
    {row(<>{"  "}<Text color={colors.primary}>△</Text><Text color={colors.text}>  {title}</Text></>, 5 + title.length)}
    {stage === "choose" && req.toolName !== "bash" && row(<><Text color={colors.muted}>  {info.icon} </Text><Text color={colors.text}>{subtitle}</Text></>, 4 + subtitle.length)}
    {row("", 0)}
    {body.map((line, i) => <React.Fragment key={i}>{row(<Text color={stage === "always" && !line.startsWith("- ") ? colors.muted : colors.text}>    {line}</Text>, 4 + line.length)}</React.Fragment>)}
    {row("", 0)}
    {footerRows === 2
      ? row(<>{optionRow}{" ".repeat(Math.max(1, innerWidth - optionLength - wideHint.length))}<Text color={colors.muted}>{wideHint}</Text></>, innerWidth, colors.element)
      : <>
        {row(optionRow, optionLength, colors.element)}
        {row(<Text color={colors.muted}>{hint.slice(0, innerWidth)}</Text>, Math.min(hint.length, innerWidth), colors.element)}
      </>}
    {row("", 0, colors.element)}
  </Box>;
}
