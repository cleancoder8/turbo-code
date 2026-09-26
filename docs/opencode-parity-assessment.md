# OpenCode parity assessment

Date: 2026-09-26

## Scope and baseline

This is a code-based assessment of turbo-code's TypeScript harness against the local OpenCode 1.18.32 checkout (`../opencode`, commit `696f41bc8e`). It covers the terminal experience and the agent behavior that supports it. It is not a claim about newer OpenCode releases or a measured performance benchmark. Live Copilot behavior and exact terminal rendering still need manual verification.

Turbo-code intentionally supports GitHub Copilot only. Matching OpenCode's provider catalog is outside this parity target. The existing [TypeScript migration plan](typescript-migration-plan.md) and [right-sidebar plan](right-sidebar-plan.md) include historical design notes; current behavior should be checked against `src/` and the README.

## Assessment

Turbo-code already has a useful base: a Copilot SDK session, read/search/write/edit/shell tools, permission prompts, local JSONL transcripts, usage accounting, configured LSP status, and an Ink chat UI. Its largest shortcoming is the absence of a durable, structured representation of a running turn. The TUI has to infer conversation state from flat messages plus transient callbacks. This is the root of several visible differences: synthetic thinking, paced rather than direct streaming, lost tool history after resume, fragile spacing, and hard-to-maintain scrolling.

| Area | Turbo-code now | OpenCode comparison | User impact |
| --- | --- | --- | --- |
| Turn state | `src/provider/types.ts` has a small flat event set; `src/agent/agent.ts` persists user text and completed assistant text, while Copilot tool start/end events are forwarded live. `src/tui/app.tsx` restores only user/assistant blocks. | OpenCode renders persistent text, tool, and reasoning parts with status and timing (`packages/tui/src/routes/session/index.tsx`, `PART_MAPPING`). | Resume does not faithfully reproduce tool work, partial replies, or interruption state. |
| Thinking and response flow | `src/tui/app.tsx` creates a Thought duration from time to first activity and drains queued text on a 30 ms timer. | OpenCode has a separate reasoning part and streaming markdown text part. | A long wait can appear stuck; an already received reply can appear to stream slowly. The Thought glyph does not represent actual reasoning. |
| Scrolling and rendering | `src/tui/app.tsx` flattens and re-renders all blocks into lines, slices a viewport, and parses wheel escape sequences manually. `src/tui/blocks.ts` measures some rows by JavaScript character count. | OpenCode uses an OpenTUI scrollbox with sticky-bottom behavior, scrollbar support, and interactive parts. | Scrolling, resize, long output, and Unicode alignment are brittle; pixel matching requires repeated local fixes. |
| Composer | `src/tui/screen.tsx` uses one-line `ink-text-input` and replaces it with a busy label during a run. | OpenCode's prompt supports multiline editing, history, commands, file context, and richer paste/attachment handling. | Users cannot prepare the next prompt while the agent works or easily compose multi-line coding requests. |
| Tool feedback | `src/tool/bash.ts` buffers stdout/stderr until exit and truncates the returned output. `src/tui/blocks.ts` has a generic tool card. | OpenCode has tool-specific rendering and expandable output. | A long command can look idle and large output can dominate the transcript. |
| Edit safety | `write`/`edit` act directly; `src/permission/service.ts` remembers `allow_always` by tool name. | OpenCode can display an edit diff at approval and offers session revert/redo. | Approval lacks a concrete change preview; always allowing a tool such as `bash` is broad; recovery is awkward. |
| Sessions | `src/cli.tsx --continue` chooses the latest Copilot session globally. Session metadata has no project path. | OpenCode offers in-app session actions such as rename, fork, timeline, undo, redo, and export. | Continuing in one repository may select work from another; users cannot choose or manage sessions in the TUI. |
| Token/context data | Usage records contain input/output totals; model metadata reports no limit, so the context percentage depends on manual `context_window` configuration. | OpenCode uses message token categories and model context limits in its sidebar. | The sidebar cannot reliably show context pressure or cost. Unknown values must stay explicitly unknown. |
| LSP | `src/lsp/service.ts` starts configured servers as files are touched and `src/tui/sidebar.tsx` shows status and diagnostic counts. | OpenCode also exposes LSP through its tool registry and has interactive sidebar sections. | Diagnostics are a status display, not yet a model-facing navigation or repair capability. |

OpenCode references above are relative to `../opencode` and describe the checked-out version. In particular, its session scrollbox is at `packages/tui/src/routes/session/index.tsx:1177`, reasoning/text renderers at `:1586` and `:1686`, generic expandable tool renderer at `:1798`, edit permission diff at `packages/tui/src/routes/session/permission.tsx:22`, prompt at `packages/tui/src/component/prompt/index.tsx`, context sidebar at `packages/tui/src/feature-plugins/sidebar/context.tsx`, and tool registry at `packages/opencode/src/tool/registry.ts:101`.

## Architectural cause

The Copilot SDK owns the persistent model session and runs registered custom tools (`src/provider/copilot.ts`). At the same time, `src/agent/agent.ts` contains a separate tool-call loop intended for providers that emit local `tool_call` events. The Copilot adapter sends the latest user prompt to the SDK rather than replaying the local message list. Both arrangements can be valid separately, but together they leave two versions of the conversation: Copilot's session and turbo-code's JSONL transcript. An abort, crash, or partial write can make them disagree. The local store also lacks turn IDs, part IDs, tool lifecycle records, completion status, and project identity.

Keep the Copilot SDK as the execution owner. Add one small application-level turn/event interface that normalizes SDK events, persists them, and supplies a stable projection to the UI. The TUI should render that projection, not invent or own turn history. This is a deeper module boundary than adding more callbacks between the provider, agent, and screen.

There is a separate presentation constraint: Ink plus manually formatted strings can imitate OpenCode's colors and padding, but OpenCode's OpenTUI renderer supplies native scrolling, interactive elements, markdown, and diff layout. A renderer migration is a tradeoff to evaluate after the event model is stable, not a prerequisite for fixing the current flow.

## Recommended build order

### 1. Make turns durable and resume correctly

Define versioned session records for user input, assistant text deltas/final text, tool start/progress/result, usage, error, cancellation, and turn completion. Include stable turn/part IDs, timestamps, project directory, model, and Copilot session ID. Persist an event before making it visible, or document the bounded recovery window if batching is necessary. Reconstruct the transcript and running status from these records. Reconcile interrupted local turns with the SDK session on resume; do not silently mark them complete.

Done when reopening a session restores the same order of text and tool parts, identifies interrupted turns, and cannot select a session from a different project through `--continue`.

### 2. Make activity truthful and prompt

Remove the artificial typewriter backlog. Render incoming provider deltas promptly, using only light frame batching to avoid excessive re-renders. Show distinct waiting, tool-running, retrying, and reply-streaming states. If the Copilot SDK does not expose reasoning content, show elapsed waiting or activity without labeling it as actual thought. Stream shell stdout/stderr during execution, with bounded capture and an expandable final result.

Done when the first available delta appears promptly, a long command displays progress before it exits, and no response is delayed solely to simulate typing.

### 3. Rebuild the conversation surface

Use persistent message/part components rather than flattening the whole history to strings on each update. Support sticky-bottom scrolling that disengages when the user scrolls up, reliable wheel/PageUp/PageDown behavior, expand/collapse for tool output, and robust resize. Centralize terminal-cell width and ANSI handling so wide or combining characters cannot shift borders. Add a multiline composer, prompt history, draft retention while busy, file mentions, and a small command palette.

Done when long transcripts and tool output remain scrollable at narrow and wide terminal sizes, drafts survive a running turn and resize, and representative OpenCode screenshots can be compared without layout drift.

### 4. Make file changes reviewable and recoverable

Display a diff before approving file mutations. Scope remembered permission rules by command/path/pattern rather than only tool name. Record changed-file snapshots or another reversible edit history, then expose undo/redo and a changed-files pane. Validate model-supplied tool arguments and configuration at runtime where they cross trust boundaries.

Done when a proposed edit can be inspected before approval and a completed edit can be reverted without hand-reconstructing the file.

### 5. Fill workflow gaps selectively

Add project-scoped session browsing and explicit session selection, Copilot connection/status and model discovery, accurate model context limits, visible usage uncertainty, and app-level compaction/retry status where the SDK permits it. Promote LSP diagnostics from aggregate counts to per-file details and an agent-facing diagnostic tool. Consider patch, web, plan, task, skill, and MCP capabilities only in response to concrete coding workflows; provider breadth remains out of scope.

Done when session/context status is trustworthy and users can diagnose common failures or navigate a project without leaving the TUI.

## Validation and decision points

- Capture a small reference matrix from the same terminal, font, width, and height: welcome, short chat, long chat, tool run, permission/diff, streaming, resize, and narrow sidebar. Compare geometry and interaction separately.
- After implementation begins, verify crash/abort/resume, repeated usage events, long-running shell output, large histories, Unicode, and scrolling while new content arrives. Existing unit tests do not replace a real-terminal smoke check. This assessment does not change tests.
- Measure render time and memory on a long session before choosing virtualization or a renderer migration. The current full-transcript formatting on stream updates suggests scaling risk, but it has not been benchmarked here.
- After the event-model and scrolling work, prototype one representative screen in OpenTUI. Compare implementation complexity and terminal behavior before committing to an Ink-to-OpenTUI migration.
