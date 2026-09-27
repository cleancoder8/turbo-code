# Turbo-code product and delivery plan

Date: 2026-09-26

This plan makes the [cross-harness assessment](cross-harness-roadmap.md) actionable. It describes intended behavior, not features already shipped. GitHub Copilot remains the only planned login and model source.

## Product promise

**Turbo-code is the coding agent whose work you can inspect, control, and undo at every step, using your Copilot account.** The user can see what is waiting, streaming, or running; understand a permission's exact scope; review edits and verification; interrupt or steer a turn; and resume without losing the record.

Copilot login is a constraint, not a unique feature: [OpenCode already supports Copilot](https://opencode.ai/docs/providers/). Visual parity helps usability, but reliable and reviewable execution is the reason to choose turbo-code. The first target user is a developer working locally in a Git repository who already has Copilot access.

The reference journey is **“Fix this failing test; show your work; let me review and undo it.”** Do not claim turbo-code owns the agent loop while the Copilot SDK/CLI orchestrates it. [GitHub documents that boundary](https://docs.github.com/en/copilot/how-tos/copilot-sdk/features/agent-loop); the direct transport probe has not passed an inference round trip on the development account.

## Take the best, then integrate it

| Reference | Adopt | Turbo-code's integration |
| --- | --- | --- |
| [OpenCode](https://opencode.ai/docs/tui/) | Fluid TUI, session navigation, progress, readable tools, scoped permissions. | Render each part from a durable record; label waiting and reasoning truthfully. |
| [Claude Code](https://code.claude.com/docs/en/features-overview) | Project guidance, skills, hooks, planning, isolated side work. | Load instructions with clear provenance; apply one permission and logging policy to extensions and built-in tools. |
| [Codex](https://developers.openai.com/blog/run-long-horizon-tasks-with-codex) | Isolated work, reviewable diffs, verification, long-task recovery. | Link the diff, commands, tests, and rollback point to the same user turn. |

This is a quality bar, not a mandate to copy every command. Defer provider breadth, a plugin marketplace, cloud/mobile surfaces, and unrestricted autonomous execution.

## Reference journey: acceptance criteria

For a task that changes two files and runs a test, the user can:

1. Submit a multiline request and immediately see the accepted prompt in the timeline.
2. Distinguish model wait, incoming text, tool execution, approval wait, verification, and completion. Waiting time is never shown as model reasoning unless reasoning content was actually received.
3. See stdout/stderr before a long command exits. Expanded output remains available after completion and restart.
4. Inspect the exact command, path, or diff before approval. An “always” decision states its precise scope and cannot silently approve a different command or directory.
5. Review changed files and the tests that ran, then undo the task's file changes.
6. Quit or crash during the task, reopen the same project, and see completed parts plus an explicit interrupted state.

Demonstrate this in a real terminal as well as automated checks. Record the session and verification results used to assess it.

## Milestone 0: resolve the Copilot transport boundary

Prove model discovery, streamed text, a streamed tool call, tool-result continuation, cancellation, usage, entitlement errors, and token refresh with turbo-code's own supported login. Keep SDK-backed chat working during the experiment. Do not embed another application's OAuth identity or credentials.

**Code areas:** `scripts/probe-copilot.mjs`, `src/provider/`, `src/agent/`.

**Gate:** A supported Copilot account completes the round trip and the access method is supportable. If it fails, explicitly keep an SDK-backed product boundary: turbo-code may own its UI, local tools, approval display, snapshots, and telemetry, but it cannot claim independent model/tool orchestration. Revisit loop-dependent milestones before implementing them.

## Milestone 1: create a durable turn timeline

Define versioned records for turn start, text delta/final, tool request/start/output/result, permission request/decision, usage, error, cancellation, and completion. Give turns and parts stable IDs and timestamps. Persist before or with display updates, with a documented recovery window. Render the TUI from records instead of the current mixture of session messages and transient React blocks. Migrate or label older SDK-backed sessions. Scope the session index to the project directory.

**Code areas:** `src/session/`, `src/agent/agent.ts`, `src/provider/copilot.ts`, `src/tui/app.tsx`.

**Gate:** Restart reproduces the order of text, tools, approvals, and errors. A crash or abort leaves an interrupted turn. `--continue` cannot silently select another project's session. Copilot CLI remains the execution owner until milestone 0 permits a change.

## Milestone 2: make progress truthful and responsive

Remove the artificial text-drain queue and synthetic Thought line. Render provider deltas promptly with bounded frame batching. Show waiting, streaming, approval, tool, retry, cancellation, and completion states. Stream shell output as events with bounded storage and expandable replay. Show token/context values only when sourced or clearly estimated.

**Code areas:** `src/provider/copilot.ts`, `src/tool/bash.ts`, `src/tui/app.tsx`, `src/tui/blocks.ts`, `src/session/usage.ts`.

**Gate:** The first available provider delta appears without a deliberate typewriter delay; a long shell command shows output before exit; no status invents reasoning. Measure time to first provider event, first visible event, and completion separately.

## Milestone 3: make execution scoped, reviewable, and reversible

Replace tool-name-wide `allow_always` with command/path/workspace scope and an explicit duration. Show the granted scope in confirmation and the turn record. Validate tool arguments. Stage or snapshot mutations, preview diffs before applying, and record rollback data. Add a sandbox or worktree boundary before unattended execution.

**Code areas:** `src/permission/`, `src/tool/`, `src/tui/permission.tsx`, `src/session/`.

**Gate:** Approval for one command or path cannot authorize a different one. A user can inspect a proposed two-file change, run verification, and restore prior file state. Denied or failed actions leave no hidden partial write.

## Milestone 4: complete the daily terminal workflow

Add multiline drafts and history, queueing/steering with clear ordering, a project-scoped session picker, read-only Plan and explicit Build transition, changed-file and review views, and detailed LSP navigation. Keep scroll position stable as parts arrive. Measure Ink on long transcripts and narrow terminals before choosing a renderer migration.

**Code areas:** `src/tui/`, `src/lsp/`, `src/session/`, `src/cli.tsx`.

**Gate:** A user can plan without edits, type the next prompt while work runs, review and undo a task, and scroll a long session without losing position. Compare welcome, chat, permission, tool, resize, and narrow screens at identical terminal dimensions.

## Milestone 5: add extensions and automation selectively

Load project instructions deliberately; add skills and project commands, then hooks, MCP, and scoped child agents when specific workflows need them. Apply the same policy and turn logging to extensions. Use worktrees for concurrent edits. Add headless `run` and `review` output after the interactive event model is stable.

**Gate:** Extensions cannot bypass approval or disappear from the timeline. Parallel workers cannot overwrite each other's edits. Headless clients can distinguish success, refusal, interruption, and failure without parsing terminal text.

## Measurement and release discipline

Build fixtures for a short answer, multi-tool code change, denied approval, long command, model error, cancellation, crash/restart, Unicode output, and narrow/wide resize. Track first visible activity, tool-output latency, resume fidelity, permission scope, undo success, render time, and memory on long sessions. Establish baselines before numerical targets; do not delay real output to create a streaming effect.

At each milestone, publish a short real-terminal demo and record passed and failed acceptance criteria. Run typecheck/build and relevant existing tests, plus terminal smoke checks for interaction work.

## Next implementation slice

Persist SDK text/tool/permission/usage events, render them from a turn record, remove synthetic Thought and paced typing, and replay the timeline after restart. This improves the most visible pain while the transport gate is investigated. It does not give turbo-code ownership of Copilot's agent loop by itself.
