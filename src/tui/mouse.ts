const sgrMousePattern = /(?:\x1b)?\[<(\d+);\d+;\d+[Mm]/g;

export function wheelSteps(input: string): number {
  let steps = 0;
  for (const match of input.matchAll(sgrMousePattern)) {
    const button = Number(match[1]);
    if ((button & 64) === 0) continue;
    steps += (button & 1) === 0 ? 1 : -1;
  }
  return steps;
}

export function stripMouseInput(input: string): string {
  return input.replace(sgrMousePattern, "");
}

export const enableMouse = "\x1b[?1000h\x1b[?1006h";
export const disableMouse = "\x1b[?1006l\x1b[?1000l";
