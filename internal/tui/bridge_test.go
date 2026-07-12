package tui

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/x/exp/teatest"

	"turbo-code/internal/agent"
	"turbo-code/internal/permission"
	"turbo-code/internal/provider"
	"turbo-code/internal/session"
	"turbo-code/internal/tool"
)

func testAgent(t *testing.T, turns [][]provider.Event) *agent.Agent {
	t.Helper()
	s, err := session.Create(t.TempDir(), "t")
	if err != nil {
		t.Fatal(err)
	}
	return &agent.Agent{
		Provider: &provider.Fake{Turns: turns},
		Model:    "fake-model", MaxTokens: 1024, System: "test",
		Tools: tool.NewRegistry(), Session: s,
		Perms: permission.New(func(permission.Request) permission.Decision { return permission.AllowOnce }),
	}
}

func TestStreamedReplyAppearsInTranscript(t *testing.T) {
	ag := testAgent(t, [][]provider.Event{
		{{Kind: provider.EventTextDelta, Text: "streamed reply"}, {Kind: provider.EventDone}},
	})
	app := NewWithAgent(ag, "fake-model", "s1")
	tm := teatest.NewTestModel(t, app, teatest.WithInitialTermSize(100, 30))

	tm.Type("hello agent")
	tm.Send(tea.KeyMsg{Type: tea.KeyEnter})

	teatest.WaitFor(t, tm.Output(), func(b []byte) bool {
		return strings.Contains(string(b), "streamed reply")
	}, teatest.WithDuration(5*time.Second))
}

// echoNonMutatingTool is a tool.Tool whose Mutating() is false, so it runs
// without a permission prompt — used to exercise the tool-start/tool-end
// path without also having to drive the permission bridge.
type echoNonMutatingTool struct{}

func (echoNonMutatingTool) Name() string            { return "lookup" }
func (echoNonMutatingTool) Description() string     { return "looks stuff up" }
func (echoNonMutatingTool) Schema() json.RawMessage { return json.RawMessage(`{"type":"object"}`) }
func (echoNonMutatingTool) Mutating() bool          { return false }
func (echoNonMutatingTool) Run(ctx context.Context, params json.RawMessage) (tool.Result, error) {
	return tool.Result{Content: "lookup result"}, nil
}

// TestAssistantTextBeforeToolCallIsFlushed verifies that explanatory prose
// the model emits before a tool call in the same round is rendered into the
// transcript as its own block, rather than being silently discarded when
// appendBlock resets a.stream for the tool-start line.
func TestAssistantTextBeforeToolCallIsFlushed(t *testing.T) {
	call := &provider.ToolCall{ID: "c1", Name: "lookup", Input: json.RawMessage(`{}`)}
	s, err := session.Create(t.TempDir(), "t")
	if err != nil {
		t.Fatal(err)
	}
	ag := &agent.Agent{
		Provider: &provider.Fake{Turns: [][]provider.Event{
			{
				{Kind: provider.EventTextDelta, Text: "let me check that for you"},
				{Kind: provider.EventToolCall, ToolCall: call},
				{Kind: provider.EventDone},
			},
			{{Kind: provider.EventTextDelta, Text: "here you go"}, {Kind: provider.EventDone}},
		}},
		Model: "fake-model", MaxTokens: 1024, System: "test",
		Tools: tool.NewRegistry(echoNonMutatingTool{}), Session: s,
		Perms: permission.New(func(permission.Request) permission.Decision { return permission.AllowOnce }),
	}
	app := NewWithAgent(ag, "fake-model", "s1")
	tm := teatest.NewTestModel(t, app, teatest.WithInitialTermSize(100, 30))

	tm.Type("do a lookup")
	tm.Send(tea.KeyMsg{Type: tea.KeyEnter})

	teatest.WaitFor(t, tm.Output(), func(b []byte) bool {
		return strings.Contains(string(b), "let me check that for you")
	}, teatest.WithDuration(5*time.Second))
}

// mutatingTool is a tool.Tool whose Mutating() is true, so calling it
// requires going through the permission bridge (App.pendingPerm /
// permAskMsg) rather than being auto-allowed.
type mutatingTool struct{}

func (mutatingTool) Name() string            { return "write" }
func (mutatingTool) Description() string     { return "writes stuff" }
func (mutatingTool) Schema() json.RawMessage { return json.RawMessage(`{"type":"object"}`) }
func (mutatingTool) Mutating() bool          { return true }
func (mutatingTool) Run(ctx context.Context, params json.RawMessage) (tool.Result, error) {
	return tool.Result{Content: "wrote it done"}, nil
}

// TestPermissionPromptRoundTrip exercises the AskFunc bridge used by Run:
// a mutating tool call blocks on a permission decision, the TUI renders the
// inline y/a/n prompt, and answering "y" lets the tool run and the turn
// complete. This is the path previously verifiable only by manual reading.
func TestPermissionPromptRoundTrip(t *testing.T) {
	call := &provider.ToolCall{ID: "c1", Name: "write", Input: json.RawMessage(`{}`)}
	s, err := session.Create(t.TempDir(), "t")
	if err != nil {
		t.Fatal(err)
	}
	ag := &agent.Agent{
		Provider: &provider.Fake{Turns: [][]provider.Event{
			{{Kind: provider.EventToolCall, ToolCall: call}, {Kind: provider.EventDone}},
			{{Kind: provider.EventTextDelta, Text: "wrote it done"}, {Kind: provider.EventDone}},
		}},
		Model: "fake-model", MaxTokens: 1024, System: "test",
		Tools: tool.NewRegistry(mutatingTool{}), Session: s,
	}
	app := NewWithAgent(ag, "fake-model", "s1")
	tm := teatest.NewTestModel(t, app, teatest.WithInitialTermSize(100, 30))

	// Wire the same AskFunc bridge Run uses, against the test program.
	p := tm.GetProgram()
	done := make(chan struct{})
	t.Cleanup(func() { close(done) })
	ag.Perms = permission.New(func(req permission.Request) permission.Decision {
		reply := make(chan permission.Decision, 1)
		p.Send(permAskMsg{req: req, reply: reply})
		select {
		case d := <-reply:
			return d
		case <-done:
			return permission.Deny
		}
	})

	tm.Type("do the mutating thing")
	tm.Send(tea.KeyMsg{Type: tea.KeyEnter})

	teatest.WaitFor(t, tm.Output(), func(b []byte) bool {
		return strings.Contains(string(b), "allow once")
	}, teatest.WithDuration(5*time.Second))

	tm.Send(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune("y")})

	teatest.WaitFor(t, tm.Output(), func(b []byte) bool {
		return strings.Contains(string(b), "wrote it done")
	}, teatest.WithDuration(5*time.Second))
}
