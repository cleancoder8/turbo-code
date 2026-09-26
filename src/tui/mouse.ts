const sgrMousePattern = /(?:\x1b)?\[<(\d+);\d+;\d+[Mm]/g;

export interface WheelEvent { direction: 1 | -1; x: number; y: number }
export interface ClickEvent { x: number; y: number }

export function wheelEvents(input: string): WheelEvent[] {
  const events: WheelEvent[] = [];
  for (const match of input.matchAll(/(?:\x1b)?\[<(\d+);(\d+);(\d+)[Mm]/g)) {
    const button = Number(match[1]);
    if ((button & 64) === 0) continue;
    events.push({ direction: (button & 1) === 0 ? 1 : -1, x: Number(match[2]), y: Number(match[3]) });
  }
  return events;
}

export function clickEvents(input: string): ClickEvent[] {
  const events: ClickEvent[] = [];
  for (const match of input.matchAll(/(?:\x1b)?\[<(\d+);(\d+);(\d+)([Mm])/g)) {
    const button = Number(match[1]);
    if (match[4] !== "m" || (button & 3) !== 0 || (button & 64) !== 0 || (button & 32) !== 0) continue;
    events.push({ x: Number(match[2]), y: Number(match[3]) });
  }
  return events;
}

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
