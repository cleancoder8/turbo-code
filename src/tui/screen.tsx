import React from "react";
import { Box, Text } from "ink";
import TextInput from "ink-text-input";
import { colors } from "./theme.js";
import { stripMouseInput } from "./mouse.js";

const glyphs: Record<string, string[]> = {
  t: ["111", "010", "010", "010", "010"],
  u: ["101", "101", "101", "101", "111"],
  r: ["110", "101", "110", "101", "101"],
  b: ["110", "101", "110", "101", "110"],
  o: ["111", "101", "101", "101", "111"],
  c: ["111", "100", "100", "100", "111"],
  d: ["110", "101", "101", "101", "110"],
  e: ["111", "100", "110", "100", "111"],
};

function wordmark(word: string): string[] {
  const pixels = Array.from({ length: 6 }, (_, row) => [...word].map((letter) => glyphs[letter]?.[row] ?? "000").join("0"));
  return [0, 2, 4].map((row) => [...pixels[row]!].map((top, col) => {
    const bottom = pixels[row + 1]?.[col] ?? "0";
    return top === "1" ? bottom === "1" ? "█" : "▀" : bottom === "1" ? "▄" : " ";
  }).join(""));
}

const logoLeft = wordmark("turbo");
const logoRight = wordmark("code");
const compactLogo = [
  "╺┳╸╻ ╻┏━┓┏┓ ┏━┓   ┏━╸┏━┓╺┳┓┏━╸",
  " ┃ ┃ ┃┣┳┛┣┻┓┃ ┃   ┃  ┃ ┃ ┃┃┣╸ ",
  " ╹ ┗━┛╹┗╸┗━┛┗━┛   ┗━╸┗━┛╺┻┛┗━╸",
];

export function Composer({ width, model, value, busy, busyLabel = "Thinking…", onChange, onSubmit, spacious = false, placeholder = "Ask anything..." }: {
  width: number;
  model: string;
  value: string;
  busy: boolean;
  busyLabel?: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  spacious?: boolean;
  placeholder?: string;
}): React.ReactElement {
  const handleChange = (next: string) => {
    const clean = stripMouseInput(next);
    if (clean !== value) onChange(clean);
  };
  const inputWidth = busy ? busyLabel.length : value.length > 0 ? value.length + 1 : placeholder.length;
  const inputPad = " ".repeat(Math.max(0, width - 3 - inputWidth));
  const modelLabel = model.length > width - 12 ? model.slice(0, Math.max(0, width - 13)) + "…" : model;
  const metaPad = " ".repeat(Math.max(0, width - 11 - modelLabel.length));
  const blank = <Text backgroundColor={colors.panel}><Text color={colors.secondary}>┃</Text>{" ".repeat(Math.max(0, width - 1))}</Text>;
  return <Box width={width} flexDirection="column">
    {spacious && blank}
    <Box>
      <Text color={colors.secondary} backgroundColor={colors.panel}>┃</Text>
      <Text backgroundColor={colors.panel}>  </Text>
      <Text backgroundColor={colors.panel}>
        {busy ? <Text color={colors.muted}>{busyLabel}</Text> :
          <TextInput value={value} onChange={handleChange} onSubmit={onSubmit} placeholder={placeholder} />}
        {inputPad}
      </Text>
    </Box>
    {blank}
    <Box>
      <Text color={colors.secondary} backgroundColor={colors.panel}>┃</Text>
      <Text backgroundColor={colors.panel}>  </Text>
      <Text backgroundColor={colors.panel}><Text color={colors.secondary}>{spacious ? "Build" : "build"}</Text><Text color={colors.muted}> · {modelLabel}</Text>{metaPad}</Text>
    </Box>
    {spacious && blank}
  </Box>;
}

export function Welcome({ width, model, value, busy, onChange, onSubmit }: {
  width: number;
  model: string;
  value: string;
  busy: boolean;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
}): React.ReactElement {
  const cardWidth = Math.min(74, Math.max(20, width - 2));
  return <Box flexGrow={1} flexDirection="column" justifyContent="center" alignItems="center" width={width}>
    <Box flexDirection="column" marginBottom={2}>
      {width >= 100 ? logoLeft.map((line, i) => <Text key={i}><Text color={colors.muted}>{line}</Text><Text color={colors.text}>  {logoRight[i]}</Text></Text>) : width >= 42 ? compactLogo.map((line, i) => <Text key={i} color={colors.text}>{line}</Text>) :
        <Text bold color={colors.text}>turbo-code</Text>}
    </Box>
    <Composer width={cardWidth} model={model} value={value} busy={busy} onChange={onChange} onSubmit={onSubmit} spacious={width >= 100} placeholder={'Ask anything... "Fix broken tests"'} />
    <Box width={cardWidth} justifyContent="flex-end" marginTop={1}>
      <Text color={colors.muted}>enter send  ·  ctrl+c quit</Text>
    </Box>
    <Box width={cardWidth} marginTop={4}>
      <Text color={colors.warning}>✦ </Text><Text color={colors.muted}>Ask a question or describe a coding task.</Text>
    </Box>
  </Box>;
}
