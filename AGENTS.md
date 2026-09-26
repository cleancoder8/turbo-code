# Repository guidance

- This is a TypeScript terminal coding agent. The CLI entry point is `src/cli.tsx`; the agent loop is in `src/agent/`, Copilot integration in `src/provider/`, tools and permissions in `src/tool/` and `src/permission/`, session storage in `src/session/`, and the Ink interface in `src/tui/`.
- GitHub Copilot is the only planned login and model source. The current chat path uses the Copilot SDK. The intended architecture is for turbo-code to own the agent loop and tools; see `docs/cross-harness-roadmap.md` before changing that boundary.
- Use the Node version in `.nvmrc`. Run `npm run typecheck`, `npm run build`, and relevant existing tests to verify code changes.
- Do not modify test files for the time being. Preserve unrelated work in the working tree.

## Screenshots

When the user says “screen,” “latest screen,” or similar, they mean a screenshot file in `~/Desktop`, not necessarily the current live display. Inspect the most recently modified Desktop screenshot unless the user names a file or asks for multiple screens. When comparing screenshots, inspect each requested image before changing the TUI.
