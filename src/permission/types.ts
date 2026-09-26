export interface Request {
  toolName: string;
  description: string;
}

export type Decision = "deny" | "allow_once" | "allow_always";

export type AskFn = (req: Request) => Decision | Promise<Decision>;
