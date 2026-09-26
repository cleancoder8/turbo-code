import chalk from "chalk";

chalk.level = 3;

export const colors = {
  bg: "#101010",
  panel: "#17151d",
  element: "#1e1e1e",
  border: "#484848",
  text: "#eeeeee",
  muted: "#808080",
  primary: "#fab283",
  secondary: "#d785d7",
  accent: "#d785d7",
  success: "#7fd88f",
  warning: "#f5a742",
  error: "#e06c75",
  info: "#56b6c2",
};

export const styles = {
  frame: chalk.bgHex(colors.bg),
  panel: chalk.bgHex(colors.panel).hex(colors.text),
  element: chalk.bgHex(colors.element).hex(colors.text),
  elementBaseline: chalk.hex(colors.element),
  agent: chalk.hex(colors.secondary),
  accent: chalk.hex(colors.accent),
  muted: chalk.hex(colors.muted),
  tool: chalk.hex(colors.muted),
  toolBorder: chalk.hex("#2b2931"),
  success: chalk.hex(colors.success),
  warning: chalk.hex(colors.warning),
  err: chalk.hex(colors.error),
};

export const agentChar = "┃";
export const cornerChar = "╹";
