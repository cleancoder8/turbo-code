declare module "marked-terminal" {
  export interface TerminalRendererOptions {
    reflowText?: boolean;
    width?: number;
    [key: string]: unknown;
  }

  export default class Renderer {
    constructor(options?: TerminalRendererOptions);
    options: TerminalRendererOptions;
  }
}
