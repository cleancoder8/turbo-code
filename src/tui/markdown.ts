import { marked } from "marked";
import Renderer, { type TerminalRendererOptions } from "marked-terminal";
import { colors } from "./theme.js";

function makeRenderer(width: number): Renderer {
  return new Renderer({
    reflowText: true,
    width,
    code: (text: string) => ansiWrap(colors.success, text),
    codespan: (text: string) => ansiWrap(colors.success, text),
    blockquote: (text: string) => ansiWrap("#e5c07b", "│ " + text),
    heading: (text: string) => `\x1b[1;38;5;${ansi256(colors.accent)}m${text}\x1b[0m`,
    firstHeading: (text: string) => `\x1b[1;38;5;${ansi256(colors.accent)}m${text}\x1b[0m`,
    strong: (text: string) => `\x1b[1;38;5;${ansi256(colors.warning)}m${text}\x1b[0m`,
    em: (text: string) => `\x1b[3;38;5;${ansi256("#e5c07b")}m${text}\x1b[0m`,
    del: (text: string) => `\x1b[9;38;5;${ansi256(colors.error)}m${text}\x1b[0m`,
    link: (text: string) => `\x1b[4;38;5;${ansi256(colors.primary)}m${text}\x1b[0m`,
    href: () => "",
    listitem: (text: string) => `• ${text}`,
    hr: () => `\x1b[38;5;${ansi256(colors.muted)}m────────\x1b[0m`,
    paragraph: (text: string) => text,
    table: (text: string) => text,
  });
}

function ansiWrap(hex: string, text: string): string {
  return `\x1b[38;5;${ansi256(hex)}m${text}\x1b[0m`;
}

function ansi256(hex: string): number {
  const c = hex.replace("#", "");
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  return (
    16 +
    36 * Math.round((r / 255) * 5) +
    6 * Math.round((g / 255) * 5) +
    Math.round((b / 255) * 5)
  );
}

const rendererCache = new Map<number, Renderer>();

export function renderMarkdown(src: string, width: number): string {
  let renderer = rendererCache.get(width);
  if (!renderer) {
    renderer = makeRenderer(width);
    rendererCache.set(width, renderer);
  }
  // marked-terminal expects to be installed as marked's renderer. We mutate
  // the marked instance's options (it's a singleton); call sites that need
  // different widths reuse the cached renderer per width. The cast through
  // `unknown` is needed because @types/marked expects a `Renderer<never>`
  // class instance whose prototype implements every method, while
  // marked-terminal's Renderer only implements the methods that have a
  // non-default override.
  marked.setOptions({ renderer: renderer as unknown as marked.Renderer });
  return (marked.parse(src) as string).replace(/\n+$/, "");
}

// Silence unused-type-import warning while keeping the import for type
// documentation of the package's surface.
void (null as unknown as TerminalRendererOptions);
