# Cross-harness assessment: Claude Code, Codex, and OpenCode

Date: 2026-09-26

## Goal

Build a **Copilot-login-only** coding harness. GitHub Copilot supplies authentication and model access. Turbo-code owns the agent loop, tool execution, permissions, context, sessions, and TUI. This assessment extends the [OpenCode parity assessment](opencode-parity-assessment.md) using current turbo-code source, installed `@github/copilot-sdk` 1.0.14 declarations, local OpenCode source, and the official documentation linked below. It is not a live benchmark or proof that direct Copilot model access works for every account and model.

For the product promise, reference journey, milestone gates, and next implementation slice, see the [product and delivery plan](product-differentiation-plan.md).

## What to learn from each harness

| Reference | Behaviors worth adopting | Evidence |
| --- | --- | --- |
| Claude Code | Project instructions, reusable workflows, plan before edits, scoped permissions, hooks, checkpoints, isolated parallel work. | [Overview](https://code.claude.com/docs/en/overview), [permissions](https://code.claude.com/docs/en/permissions), [checkpointing](https://code.claude.com/docs/en/checkpointing) |
| Codex | Sandboxed execution, reviewable patches, dedicated code review, session resume and steering, AGENTS.md, skills, worktrees, automation. | [CLI](https://learn.chatgpt.com/docs/codex/cli), [sandboxing](https://learn.chatgpt.com/docs/sandboxing), [code review](https://learn.chatgpt.com/docs/code-review) |
| OpenCode | Persistent interactive TUI, Build/Plan agents, undo/redo, LSP, MCP, skills. Its Copilot integration is the closest architectural reference: Copilot login and model transport feed OpenCode's own loop. | [Agents](https://opencode.ai/docs/agents/), [TUI](https://opencode.ai/docs/tui/), [providers](https://opencode.ai/docs/providers/) |

## Architecture correction

```text
GitHub Copilot login / credential manager
               ↓
Copilot model transport: discovery, streaming, tool calls, usage, errors
               ↓
Turbo-code agent loop: context, turns, retries, tool dispatch, policy, sessions
               ↓
Turbo-code tools and TUI
```

Today `src/provider/copilot.ts` starts a Copilot SDK session, registers turbo-code's `tc_*` tool implementations, and calls `sendAndWait()`. The Copilot CLI behind the SDK decides when to invoke those tools and owns the model/tool loop. `src/agent/agent.ts` contains a separate loop for local `tool_call` events, but the Copilot adapter never emits them. Copilot session history and local JSONL history therefore compete as sources of truth. The [Copilot SDK agent-loop documentation](https://github.com/github/copilot-sdk/blob/main/docs/features/agent-loop.md) describes the CLI as the orchestrator. Installed SDK 1.0.14 does not expose a public raw-inference method that would make it a drop-in transport for the intended design.

OpenCode has a Copilot device-login plugin (`../opencode/packages/opencode/src/plugin/github-copilot/copilot.ts`) and a separate Copilot model provider (`../opencode/packages/core/src/github-copilot/copilot-provider.ts`) feeding its own agent loop. Those source files are implementation references, not a guarantee of a stable public API for turbo-code. Use turbo-code's own OAuth identity and secure credential storage; do not copy OpenCode's client ID or tokens. Validate GitHub's current access rules and product terms for a distinct application.

## Gaps and priorities

| Capability | Current gap | Priority | Direction |
| --- | --- | --- | --- |
| Execution ownership | Copilot CLI controls the loop; turbo-code's loop is bypassed. | P0 | Direct Copilot model transport producing raw tool-call events for one harness-owned loop. |
| Durable sessions | JSONL holds user messages and completed assistant text, while tool activity and partial replies are transient. | P0 | Versioned turn/part journal as the sole session source of truth, including recovery state. |
| Real progress | Synthetic Thought and paced text obscure waiting and streaming; shell output is buffered. | P0 | Prompt deltas, actual activity states, streamed shell progress. |
| Safe execution | Tool-name approval is broad; no enforced filesystem/network sandbox or command/path policy; write overwrites directly. | P0 | Central policy, scoped approvals, workspace limits, diff preview, reversible snapshots. |
| Repository context | Instructions are not deliberately loaded; branch context is mostly cosmetic. | P0 | Load project instructions with precedence and trust rules. |
| Session recovery | `--continue` can pick a Copilot session from another project; tool parts vanish on resume. | P0 | Project-scoped index, picker, interrupted status, harness-owned context reconstruction. |
| Editing workflow | No protected Plan mode, patch review, changed-files summary, undo/redo, or dedicated review. | P1 | Read-only Plan policy, diff/patch view, checkpoints, review command. |
| Composer and steering | Single-line input disappears while busy; no draft, history, mentions, attachments, queue, or steering. | P1 | Multiline composer and harness-owned queue/cancellation. |
| Context/model clarity | Context limit is manually configured; model discovery and usage precision are weak. | P1 | Discover available Copilot models/limits through validated transport; track usage and compaction locally. |
| Tool quality | Simple exact-string edit, recursive JS grep, buffered shell; no structured patch or ask-user form. | P1/P2 | Improve core tools under the same policy boundary. |
| Extensibility and parallelism | No skills, hooks, MCP, subagent tree, or worktree isolation. | P2 | Harness-owned extensions and child agents with permissions and budgets. |
| Automation and measurement | No headless event stream, review command, trace export, or latency/reliability suite. | P2 | Structured `run`/`review`, transport fixtures, terminal smoke, performance traces. |

P0 establishes a trustworthy harness; P1 strengthens daily coding; P2 adds power after the control plane is stable.

## Delivery sequence

### Phase 0: prove Copilot model access

Build an isolated transport spike with turbo-code's own login and secure token storage. Prove model listing, streamed text, a streamed tool call and tool-result continuation through turbo-code's loop, cancellation, usage/errors, token refresh, and entitlement failures. Check the protocol variants needed for supported models. Confirm current access rules and terms. GitHub Models access should not be assumed to equal Copilot subscription entitlement. Keep the working SDK path until this gate passes; if direct access is unavailable or unsupported, record that constraint explicitly.

Current spike: `scripts/probe-copilot.mjs` discovers models using an existing GitHub token and can attempt a benign streamed tool round trip. On the development account, discovery succeeded but direct inference returned `400 model_not_supported`; the gate has **not** passed. This probe has no new OAuth client or credential store and is not wired into chat.

### Phase 1: own execution and make progress truthful

Make `src/agent/agent.ts` the only loop. Give it a durable turn/part journal with IDs, status, text, tools, approvals, and usage; rebuild the UI from that journal. Migrate or clearly distinguish older SDK-backed sessions. Remove synthetic typing and Thought; show real reasoning only when the transport emits it. Stream shell progress. Enforce scoped tool permissions, workspace limits, edit preview, and reversible file snapshots. Load repository instructions deliberately and scope session continuation by project.

Gate: abort/resume reproduces visible tool and text state; a long command shows progress; broad approvals cannot authorize unrelated commands; sessions do not cross projects accidentally.

### Phase 2: strong daily coding

Add multiline drafts, history, `@file`, attachments, harness-owned steering/queueing, read-only Plan mode, diff review, Build transition, changed-files summary, and undo/redo. Add a picker for actually available Copilot models, context/compaction/usage status, detailed LSP diagnostics, sticky scrolling, and expandable tool results. Preserve accepted-message order across restart.

Gate: users can plan without edits, inspect and revert a multi-file change, steer a task, write while busy, and scroll a long session without losing place.

### Phase 3: selective power features

Add skills and project commands, then MCP and hooks under the harness's policy. Add visible read-only research/review child agents with budgets; use worktrees before parallel editing. Add headless `run`/`review` JSONL modes and a dedicated review workflow. Measure time to first visible event, wait/tool/reply duration, failures, interrupted turns, compaction, and render time before deciding on an OpenTUI migration.

Gate: extensions obey built-in tool policy; child agents cannot overwrite each other's edits; automation can distinguish success, refusal, and failure without parsing terminal text.

## Decisions to defer

- Multiple model providers: Copilot is the sole planned login and model source.
- Cloud/mobile/IDE surfaces and a plugin marketplace: major expansions before the terminal harness is reliable.
- Unrestricted autonomous mode: requires a real sandbox and audit trail.
- Pixel-level renderer rewrite: evaluate after the durable timeline and scrolling work.

## Source notes

Claude Code documents [memory](https://code.claude.com/docs/en/memory), [hooks](https://code.claude.com/docs/en/hooks-guide), [skills](https://code.claude.com/docs/en/skills), [MCP](https://code.claude.com/docs/en/mcp), and [subagents](https://code.claude.com/docs/en/sub-agents). Codex documents [AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md), [subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents), [MCP](https://learn.chatgpt.com/docs/extend/mcp), [sandboxing](https://learn.chatgpt.com/docs/sandboxing), and [code review](https://learn.chatgpt.com/docs/code-review). OpenCode documents [agents](https://opencode.ai/docs/agents/), [TUI](https://opencode.ai/docs/tui/), and [Copilot login](https://opencode.ai/docs/providers/).
