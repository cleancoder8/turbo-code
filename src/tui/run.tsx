import React from "react";
import { render } from "ink";
import type { Agent } from "../agent/index.js";
import type { Decision, Request as PermRequest } from "../permission/types.js";
import { App } from "./app.js";
import type { LspService } from "../lsp/service.js";

export interface RunOpts {
  agent: Agent;
  modelID: string;
  sessionID: string;
  cwd: string;
  branch?: string;
  lsp?: LspService;
  contextWindow?: number;
}

// Run starts the TUI and blocks until the user quits (ctrl+c) or the process
// exits. The permission asker resolves only when the user answers the
// in-app prompt; if the program is exiting while a prompt is open, the
// Promise stays pending and Ink's exit will tear the program down.
export async function run(opts: RunOpts): Promise<void> {
  const ask = (_req: PermRequest): Promise<Decision> =>
    // This default asker is replaced by App's wirePerms on mount. It's
    // defined here only to satisfy the type; in practice App always
    // overrides it.
    new Promise<Decision>(() => {});

  const app = render(
    <App
      agent={opts.agent}
      modelID={opts.modelID}
      sessionID={opts.sessionID}
      cwd={opts.cwd}
      branch={opts.branch}
      ask={ask}
      lsp={opts.lsp}
      contextWindow={opts.contextWindow}
    />,
  );
  await app.waitUntilExit();
}
