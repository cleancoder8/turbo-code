import type { Message } from "../provider/types.js";

export interface Meta {
  id: string;
  title: string;
  created: string;
  v: 1;
  backend?: "copilot";
}

export interface Session {
  meta: Meta;
  messages: Message[];
  filePath: string;
}
