export interface Config {
  model: string;
  context_window?: number;
  lsp?: Record<string, { command: string[]; extensions: string[] } | false>;
}
