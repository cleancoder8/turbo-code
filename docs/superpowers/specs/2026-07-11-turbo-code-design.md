# Turbo Code — Design Spec

**Date:** 2026-07-11
**Status:** Approved by stakeholder (brainstorming session)

## Summary

Turbo Code is an in-house terminal AI coding agent for company use, functionally and visually equivalent to OpenCode. Company policy forbids using OpenCode's source code, so this is a clean-room reimplementation. Permissively licensed open-source libraries are allowed; only OpenCode's own source is off-limits. Imitating OpenCode's layout and interaction patterns is acceptable; the product ships under company branding.

## Goals

- Terminal UI with the same layout and feel as OpenCode: full-width chat pane, bottom editor input, status bar, modal dialogs, snappy rendering.
- Agent loop with streaming responses and tool use: read, write, edit, bash, grep, glob, ls, todo.
- Multiple LLM backends: Anthropic direct, OpenAI direct, internal OpenAI-compatible gateway, AWS Bedrock, Azure OpenAI, Google Vertex.
- Persistent sessions: list, resume, fork.
- LSP integration: diagnostics fed back to the model after edits.
- MCP client support (stdio and HTTP transports) for company-internal tool servers.
- Subagents via a `task` tool and a plan mode that blocks mutating tools.
- Distributed as a single static Go binary.

## Non-goals (v1)

- Share/publish feature, IDE extensions, GitHub bot integration, themes marketplace, web UI.
- Windows support may lag; primary targets are macOS and Linux.

## Deferred follow-up: TUI visual/feature parity pass

Phase 1 shipped a deliberately bare TUI shell (one accent color, no header
chrome, no modal dialogs). User feedback after using it: the app "looks
nothing like OpenCode" — specifically colors/theme, layout/chrome, and
missing features all fall short. Scope for a future brainstorming session:

- Full theme pass: cohesive dark palette beyond the single `BrandColor`
  accent (borders, muted text, role-based coloring), since no live
  OpenCode reference is available to match against — design from
  Charm/Bubble Tea ecosystem conventions.
- Header/banner chrome (app name/version), not just the bottom status bar.
- Model picker dialog (switch models mid-session, not just `--model` at startup).
- Session picker dialog (browse/resume sessions, not just `--continue` or the `sessions` CLI list).
- Help/keybind overlay (`?` key).

Not scoped yet: dialog interaction style (centered modal vs. full-screen
replace vs. inline expand) — needs its own design pass, likely with the
visual companion for layout mockups.

## Architecture

Single Go binary (`turbo-code`). Bubble Tea owns the TUI event loop; the agent runs in goroutines and streams events to the TUI over channels. No daemon, no IPC.

### Package layout

```
cmd/turbo-code/      main, CLI flags
internal/tui/        Bubble Tea models: chat view, input editor, status bar, dialogs, theme
internal/agent/      agent loop: prompt assembly, streaming, tool dispatch, subagents, compaction
internal/provider/   Provider interface + anthropic, openaicompat, bedrock, azure, vertex impls
internal/tool/       Tool interface + builtin tools
internal/session/    JSONL session persistence
internal/lsp/        LSP client pool, diagnostics collection
internal/mcp/        MCP client (stdio + HTTP)
internal/config/     project + global config, env resolution
internal/permission/ tool permission prompts (allow once / always / deny)
```

### Key dependencies

All permissively licensed; none originate from the OpenCode project.

- `charmbracelet/bubbletea`, `lipgloss`, `glamour` (TUI, styling, markdown)
- `anthropics/anthropic-sdk-go`, `openai/openai-go`
- AWS SDK for Go v2 (Bedrock)
- `mark3labs/mcp-go` (MCP client)
- LSP: `go.lsp.dev/jsonrpc2` + `go.lsp.dev/protocol` (types and transport; the client pool itself is ours)

### Delivery phases

1. **Core:** chat TUI, provider layer, builtin tools, sessions, permissions.
2. **Context quality:** LSP diagnostics, MCP client.
3. **Agency:** subagents (`task` tool), plan mode.

Each phase ships a usable binary.

## Components

### Agent loop (`internal/agent`)

User message → assemble context (system prompt, session history, tool schemas) → stream from provider → emit events (`TextDelta`, `ToolCallStart`, `ToolResult`, `Done`) on a channel consumed by the TUI. On a tool call: permission check → execute → append result to history → continue the loop until the model stops calling tools. When context approaches the model limit, compact by summarizing older turns.

### Provider layer (`internal/provider`)

```go
type Provider interface {
    Stream(ctx context.Context, req Request) (<-chan Event, error)
    Models() []Model
}
```

Five implementations behind one interface with unified streaming events and tool-call support. The internal gateway is the `openaicompat` implementation configured with a custom base URL and auth header. The model catalog lives in config, not code.

### Tool system (`internal/tool`)

```go
type Tool interface {
    Name() string
    Schema() json.RawMessage
    Run(ctx context.Context, params json.RawMessage) (ToolResult, error)
}
```

One registry serves builtin tools, MCP-discovered tools, and the `task` tool. A subagent is a child agent loop with a restricted tool set and its own session branch.

### Sessions (`internal/session`)

Append-only JSONL file per session under `~/.local/share/turbo-code/sessions/`. Records are messages and tool results. Supports list, resume, and fork. No database.

### TUI (`internal/tui`)

Bubble Tea `Update` receives agent events as messages. Renders markdown via glamour, plus diff blocks and tool output blocks. Layout mirrors OpenCode: full-width chat, bottom editor, status bar showing model, token usage, and cost; modal dialogs for session and model pickers; permission prompts inline. Company theme and name.

### Plan mode

A flag on the agent: mutating tools (write, edit, bash) are swapped for propose-only variants. Toggled by keybind; state shown in the status bar.

## Error handling

- **Provider:** retry with exponential backoff on 429/5xx respecting `retry-after`; auth and other 4xx errors surface immediately as a TUI toast. A dropped stream keeps the partial response, marks it interrupted, and offers retry.
- **Tools:** never crash the loop — errors are returned to the model as tool results so it can self-correct. Bash has a timeout and an output size cap.
- **Sessions:** append-only JSONL is crash-safe; a partial trailing line is skipped on load.
- **LSP/MCP:** server failures degrade gracefully — the feature turns off with a status-bar warning; the agent keeps working.
- **Panics:** recovered in goroutines, logged to `~/.local/share/turbo-code/log`; the session is preserved.

## Testing

- **Unit:** tools against tempdir fixtures; providers against recorded HTTP via `httptest`; session save/load round-trips.
- **Agent loop:** a fake provider scripts tool-call sequences — deterministic, no network.
- **TUI:** `teatest` for key flows — send keys, assert rendered frames.
- **Integration:** opt-in smoke test per real provider (requires credentials).
- **CI:** `go vet`, `golangci-lint`, race detector enabled.

## Decisions log

- Rebuild instead of fork: company policy forbids using OpenCode source. OSS libraries are allowed.
- Go single binary over TypeScript or a client/server split: snappiest, simplest distribution, team fit.
- Monolith with clean package boundaries over OpenCode-style client/server: no current need for multiple frontends; boundaries keep a later split possible.
- Same layout with company branding over pixel-faithful replica: 90% of the feel without the pixel-matching grind.
