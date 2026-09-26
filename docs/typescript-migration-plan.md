# TypeScript migration plan

Date: 2026-09-25

Archive note (2026-09-26): the Go implementation, Go module, binary, and Go-only design documents have been removed. The Go fallback and cutover steps below record the original migration plan; they are no longer current work.

Update: the supported TypeScript harness now uses GitHub Copilot only. Earlier Anthropic/OpenAI provider parity items below are historical and superseded by the Copilot SDK adapter and its tests.

## Goal and current state

Make the TypeScript CLI the supported implementation of turbo-code while preserving configuration, saved sessions, tools, provider behavior, and terminal workflows.

Related feature plan: [right sidebar for token usage and LSP](right-sidebar-plan.md), coordinated with session compatibility and terminal workflow work below.

The working tree already contains a substantial TypeScript port in `src/`, using React/Ink, async iterables, AbortSignal, and an esbuild entry point. Strict TypeScript checking is enabled. This is a completion and cutover project, not a new rewrite.

Baseline verified during planning: `npm run typecheck` passes; `npm test` passes all 31 tests across seven files. Build, Go tests, installed-package behavior, and live provider calls have not been verified for this plan. Existing work includes uncommitted Go changes and untracked TypeScript files; preserve and review those changes before organizing migration commits.

The README and Makefile still describe/build Go. TypeScript tests cover core behavior, but provider coverage only exercises the fake provider and TUI tests exercise formatting helpers rather than the interactive app.

## Approach

Keep the existing module boundaries: config, session, provider, tool, permission, agent, and TUI. Retain the existing TypeScript stack and lockfile while establishing parity. Keep Go available as a behavioral reference and rollback path until cutover passes. Deliver the following steps as reviewable changes in order; each step has a completion gate.

### 1. Establish compatibility contracts

- Map the Go tests and documented CLI behavior to TypeScript tests, recording intentional differences explicitly.
- Capture synthetic fixtures for configuration merging, JSONL sessions with tool calls/results, provider streams, tool output, and error handling. Do not use private sessions or credentials.
- Preserve config paths, session paths, model selection, provider names, tool names/argument schemas, and permission decisions.
- Define CLI behavior for `--model`, `--continue`, `sessions`, help, invalid flags, missing values, and exit codes. The current TypeScript parser silently ignores unknown flags and missing model values.
- Record terminal acceptance cases: streaming, text before tool calls, permission prompts, cancellation, multiline input, resize, and quit.

Gate: a parity checklist links every supported behavior to an automated test or an explicit terminal smoke check.

### 2. Fix persistence compatibility and validate external input

Primary files: `src/session/store.ts`, `src/session/types.ts`, `src/provider/types.ts`, `src/config/load.ts`, `src/tool/types.ts`.

- Add explicit session serialization/deserialization. Go persists `tool_calls`, `tool_call_id`, and `is_error`; TypeScript currently writes camelCase fields and casts parsed JSON without conversion. This can lose tool history when continuing a Go session.
- Keep the Go snake_case wire format for new writes. Accept both the Go format and the current TypeScript camelCase format on reads, including mixed files. Accept older metadata without `v`; define how unsupported versions fail.
- Test Go-format session → TypeScript load/append → Go load, preserving tool IDs, arguments, error flags, timestamps, and ordering. Use temporary fixtures, not real user files.
- Preserve corrupt-tail recovery and newest-first listing; use exclusive file creation to avoid session ID races.
- Validate configuration, session records, and model-supplied tool arguments at runtime. Type assertions alone do not validate JSON. Return useful errors at these boundaries.

Gate: cross-format fixtures round-trip without losing tool history; invalid inputs fail predictably; normal startup needs no destructive data conversion.

### 3. Complete provider, agent, and tool parity

Primary files: `src/provider/anthropic.ts`, `src/provider/openaicompat.ts`, `src/agent/agent.ts`, `src/tool/*`, `src/permission/service.ts`.

- Port the Go provider stream and malformed-schema tests to TypeScript using local HTTP fixtures or controlled SDK transports, without real API keys.
- Cover fragmented tool arguments, multiple tool calls, text/tool ordering, usage totals, provider errors, interrupted streams, and abort propagation.
- Verify the complete agent loop: persist user/assistant/tool messages, request permission before mutation, feed results back to the provider, and finish or cancel cleanly.
- Add cancellation cases during streaming, a tool, and a pending permission decision; define how interrupted tool history is made safe for the next request.
- Check all seven tools against the parity fixtures, especially grep/glob matching, edit ambiguity, filesystem failures, shell exit codes, timeout, output limits, and stdout/stderr ordering. Bound shell output while collecting it and verify child-process cleanup on cancellation.

Gate: both real provider adapters pass deterministic transport tests; the tool loop and cancellation complete without hanging or unauthorized mutation.

### 4. Complete terminal and CLI workflows

Primary files: `src/tui/app.tsx`, `src/tui/agentbridge.ts`, `src/tui/run.tsx`, `src/cli.tsx`.

- Add mounted Ink interaction tests using the existing test dependency, plus a real-terminal smoke checklist.
- Fix cancellation state cleanup: the current app sets `busy` false only for done/error callbacks, but an aborted generator can return without either callback. Ensure cancellation allows the next submission and prevents stale callbacks from modifying a newer turn.
- Make pending permission prompts settle on cancellation/exit/unmount. The current prompt branch intercepts input before the Ctrl+X handler.
- Verify `y`/`a`/`n`/Escape behavior, streamed markdown, text before a tool call, resize, long transcripts, and the documented Alt+Enter multiline input.
- Add subprocess CLI tests for config errors, flags, session listing, continuation, and exit behavior, with isolated config/session directories.

Gate: users can send, approve/deny, cancel, send again, quit, and resume an existing session; documented keyboard shortcuts work in a real terminal.

### 5. Package and switch the default

Primary files: `package.json`, `scripts/build.mjs`, `Makefile`, `README.md`, CI configuration.

- Verify `npm ci`, typecheck, tests, and build from a clean checkout. Select and document a supported Node runtime for release, then align engines, types, build target, and CI with it; the current files target Node 20 or newer.
- Use `npm pack` and install the resulting tarball in a temporary location. Verify the `turbo-code` executable, shebang, runtime dependency installation, and absence of reliance on repository source files.
- Document the distribution change: the current TypeScript build requires Node and external npm dependencies, unlike the Go binary. Treat standalone executable packaging as a separate scope decision if required.
- Add CI gates for typecheck, tests, build, and package smoke tests; retain Go checks during coexistence.
- Switch the default Makefile targets and README instructions to TypeScript once earlier gates pass. Keep an explicit Go fallback target during the pilot.

Gate: a fresh installation works through the documented command, including listing/resuming a fixture session and a terminal run. An authorized live-provider smoke test can supplement deterministic adapter tests before release.

### 6. Pilot, cut over, and retire Go

- Pilot the TypeScript package with the parity checklist on supported development platforms. Verify both providers, mutation prompts, cancellation, and resumed sessions.
- Retain the previous Go release and verify it can read sessions appended by TypeScript. Back up pilot session data before testing against real histories.
- If a blocking regression appears, switch back to the retained Go executable and investigate using fixture reproductions. Do not delete or bulk-rewrite session data.
- After the pilot passes, make TypeScript the sole default. Remove `cmd/`, `internal/`, Go module files, obsolete build targets, and Go-specific documentation in a separate cleanup change. Preserve compatibility fixtures and tests.

Gate: all parity checks pass, package installation and rollback are demonstrated, and no release-blocking session, permission, provider, or cancellation defects remain.

## Definition of done

- Strict typechecking, deterministic tests, build, and installed-package smoke checks pass in CI.
- Existing Go configurations and tool-bearing sessions work without manual conversion.
- Both providers, all seven tools, permissions, cancellation, and documented terminal interactions are verified.
- Installation documentation matches the shipped package and runtime requirements.
- Go removal happens only after the TypeScript pilot and rollback checks pass.
