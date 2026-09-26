# Right sidebar: token usage and LSP

Date: 2026-09-25

## Objective

Add an OpenCode-inspired right-hand pane to the TypeScript TUI, showing token usage and actual language-server status. Build this on the existing Ink UI as a companion to the [TypeScript migration plan](typescript-migration-plan.md).

Assumptions: “LSP” means connected language servers and diagnostic counts; the initial release does not add an editor, code navigation, or automatic agent repair loops.

Implementation status: the TypeScript TUI now has the sidebar, request usage accounting with a session sidecar, configured LSP process support, file notifications, and diagnostic summaries. The examples below remain design illustrations. A live check with an installed language server and a real terminal is still needed in a release environment.
The active provider is now GitHub Copilot through the Copilot SDK; provider-specific references below predate that change.

## Proposed experience

Illustrative values, not current application data:

```text
 Chat and streamed responses           │ SESSION
                                      │ turbo-code · current model
                                      │
                                      │ TOKENS
                                      │ Turn in       12,450
                                      │ Turn out       1,280
                                      │ Session       48,920
                                      │
                                      │ CONTEXT
                                      │ Last request  18,200
                                      │ Limit        unknown
                                      │
                                      │ LSP
                                      │ ● TypeScript   ready
                                      │   2 errors · 1 warning
 Permission prompt / input            │ ○ Go           idle
──────────────────────────────────────┴──────────────────────────
 Project directory                     ready       Ctrl+B sidebar
```

- Use a 30-column sidebar including its divider/padding, with chat taking the remaining width. Show it automatically at 110 columns or wider; hide it below that threshold. Keep this threshold in one layout helper for later tuning.
- Ctrl+B toggles the pane; on narrow terminals it opens a temporary status view with Escape to return, preserving draft input. Global quit/cancel still work, and pending permissions remain visible and take priority.
- Keep chat, permission prompts, and input in the left column; retain a compact full-width footer for directory and execution state.
- Use explicit labels alongside status colors. Truncate long names/paths, preserve chat input on resize, and prioritize token totals plus LSP summary on short terminals. Show a remaining-server count when rows do not fit.
- Move detailed token information out of the footer; retain a compact token/LSP summary there when the sidebar is hidden.

## Current code constraints

- `src/tui/app.tsx` uses one full-width column and stores already-formatted transcript strings. Adding a sidebar without changing this will leave old content wrapped at the wrong width.
- `src/agent/agent.ts` aggregates usage across model requests but only exposes it at `turn_done`; interrupted/error turns can lose their visible usage totals.
- Provider usage currently contains only input/output numbers. There is no context-window capacity field, persisted usage ledger, or LSP implementation.
- `max_tokens` is an output limit, not a context-window size. Never use it as the denominator of a context percentage.

## Implementation sequence

### 1. Responsive layout and sidebar component

Files: `src/tui/app.tsx`, `src/tui/blocks.ts`, `src/tui/theme.ts`; new `src/tui/sidebar.tsx`, `src/tui/layout.ts`.

- Extract a pure layout calculation for available chat width, sidebar visibility, and height budget. Pass actual inner widths to formatting helpers so padding is counted once.
- Store semantic transcript blocks (user text, assistant markdown, tool events, errors) and render them at the current chat width. Handle long tool arguments, unbroken text, ANSI styling, and wide Unicode characters.
- Add a presentational sidebar consuming typed usage/LSP snapshots. It must not start processes or count tokens inside React render functions.
- Implement resize, toggle, narrow status view, and permission priority. Use explicit unknown/disabled states until services supply data.

Gate: mounted UI tests at 80, 110, and 160 columns, plus short heights, show no overlapping columns or lost draft input; streamed and historical text reflow correctly.

### 2. Reliable token accounting

Files: `src/provider/types.ts`, both provider adapters, `src/agent/agent.ts`, `src/tui/agentbridge.ts`; new usage state module.

- Introduce a usage event for each provider request, identified by stable session/turn/request IDs. Apply each finalized request once; replace provisional snapshots instead of adding them repeatedly.
- Display current/last turn input and output, and cumulative recorded session usage. A turn can contain several model requests due to tools; sum all of them. Do not add the `turn_done` aggregate a second time.
- Update after each model request even while tools continue running. Show “streaming; usage pending” when the provider has not reported counts, rather than inventing a live token estimate.
- Preserve reported usage if a later request errors or is cancelled. Represent missing provider usage as unknown/partial, not zero.
- Keep last-request context usage separate from cumulative session tokens. Add optional configured model context capacity; show a percentage only when capacity and comparable provider counts are known. Label it as the last request, not a prediction of the next one.
- Normalize provider cache counts explicitly before including them in context totals; keep cache details optional and avoid counting cached input twice. Cost tracking is deferred until pricing data is available.

Gate: tests cover a text turn, multiple tool rounds, repeated usage snapshots, missing usage, failure, and cancellation without lost or double-counted totals.

### 3. Resume-safe usage persistence

Files: new `src/session/usage.ts`, usage state integration, session tests.

- Persist versioned request usage records to a separate `<session-id>.usage.jsonl` sidecar. Keep accounting out of the chat JSONL and provider message history.
- Restore recorded totals when continuing a session. Historical sessions without usage metadata show “recorded since tracking began”; do not claim a complete lifetime total.
- Deduplicate by request ID, tolerate a truncated final record, serialize writes, and flush finalized records promptly. Mark history as partial when persistence fails while keeping chat usable.

Gate: resume yields the same totals, legacy sessions still load, and accounting records never reach a provider as messages.

### 4. Language-server service

Files: new `src/lsp/types.ts`, `src/lsp/client.ts`, `src/lsp/service.ts`; `src/config/types.ts`, `src/config/load.ts`, `src/cli.tsx`.

- Implement a UI-independent service keyed by server ID and workspace root, exposing immutable snapshots/events.
- Support states: disabled, not installed, idle, starting, ready, and error. “Ready” requires a successful initialization handshake, not just finding an executable.
- Begin with configured TypeScript/JavaScript and Go servers, using installed executables; allow explicit command arrays, file extensions, and root markers. No automatic downloads in the initial scope. TypeScript itself is not an LSP server: verify the chosen language-server executable separately.
- Define global/project config merge behavior and disabled overrides. Route executable launches through the application's permission policy rather than silently executing arbitrary project configuration.
- Implement stdio protocol framing, initialize/initialized, request timeouts, diagnostic notifications, shutdown/exit, stderr capture, and process cleanup. Select a maintained protocol transport during implementation after verifying its current API.
- Start enabled servers lazily when relevant workspace files are used. Reuse one connection per server/root; cap restart attempts and display failures without blocking chat.

Gate: a fake language-server subprocess proves handshake, framing, timeout, crash reporting, diagnostics, and shutdown. Missing executables produce an actionable status.

### 5. Synchronize files and render real diagnostics

Files: `src/tool/read.ts`, `src/tool/write.ts`, `src/tool/edit.ts`, tool execution integration, LSP service, sidebar.

- Notify the service after successful file reads and permitted writes/edits; send document open/change/save notifications as appropriate to server capabilities. Never report a denied or failed edit as applied.
- Track document versions; synchronize tracked files changed externally, including by shell commands, with debounced file observation/reconciliation. Ignore stale diagnostic versions where the server provides version information.
- Replace diagnostics per document when updated or cleared. Aggregate errors/warnings by server/root and label counts “reported diagnostics” because servers may only analyze opened files.
- Update the pane through service events, not UI polling. Status detail shows workspace root and a short error reason; do not expose environment values or secrets.
- Dispose watchers, subscriptions, and server processes when the application exits. Cancelling a model turn leaves healthy project servers available for the next turn.

Gate: read → ready, edit → changed diagnostics, diagnostics cleared, server crash, and application exit all update correctly. A manual smoke test uses installed TypeScript and Go servers.

## Delivery and migration relationship

Deliver three reviewable milestones:

1. Responsive sidebar and reliable token events/accounting.
2. Resume-safe usage sidecar and context display.
3. Real LSP lifecycle, file synchronization, and diagnostic status.

Coordinate layout work with migration step 4 (terminal workflows), and usage sidecars with step 2 (session compatibility). Address the migration's cancellation cleanup before relying on sidebar turn state. LSP support can ship after the TypeScript cutover without blocking it; until then the pane must state “LSP not configured” or “disabled” accurately.

Validation for implementation: typecheck, existing tests, targeted usage/layout/LSP integration tests, then a real-terminal smoke test covering resize, streaming, permission prompts, Ctrl+X, Ctrl+B, resume, and quit. Automated tests now cover usage persistence, layout calculation, sidebar rendering, and LSP handshake/diagnostics/shutdown through a fake server. Real-terminal and installed-server smoke checks remain release gates.

## Reference

OpenCode documents configured language servers, file-triggered startup, and diagnostics feedback in its [LSP documentation](https://opencode.ai/docs/lsp/). This plan borrows the persistent status-pane concept; dimensions, shortcuts, accounting rules, and milestone boundaries above are proposed specifically for turbo-code.
