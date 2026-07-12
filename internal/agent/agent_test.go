package agent

import (
	"context"
	"encoding/json"
	"runtime"
	"testing"
	"time"

	"turbo-code/internal/permission"
	"turbo-code/internal/provider"
	"turbo-code/internal/session"
	"turbo-code/internal/tool"
)

type echoTool struct{ mutating bool }

func (e echoTool) Name() string            { return "echo" }
func (e echoTool) Description() string     { return "echoes input" }
func (e echoTool) Schema() json.RawMessage { return json.RawMessage(`{"type":"object"}`) }
func (e echoTool) Mutating() bool          { return e.mutating }
func (e echoTool) Run(ctx context.Context, p json.RawMessage) (tool.Result, error) {
	return tool.Result{Content: "echo:" + string(p)}, nil
}

func newAgent(t *testing.T, fake *provider.Fake, tl tool.Tool, ask permission.AskFunc) *Agent {
	t.Helper()
	s, err := session.Create(t.TempDir(), "test")
	if err != nil {
		t.Fatal(err)
	}
	return &Agent{
		Provider: fake, Model: "fake-model", MaxTokens: 1024, System: "you are a test",
		Tools: tool.NewRegistry(tl), Perms: permission.New(ask), Session: s,
	}
}

func collect(ch <-chan Event) []Event {
	var out []Event
	for ev := range ch {
		out = append(out, ev)
	}
	return out
}

func TestTextOnlyTurn(t *testing.T) {
	f := &provider.Fake{Turns: [][]provider.Event{
		{{Kind: provider.EventTextDelta, Text: "hi"}, {Kind: provider.EventDone, Usage: provider.Usage{OutputTokens: 1}}},
	}}
	a := newAgent(t, f, echoTool{}, func(permission.Request) permission.Decision { return permission.Deny })
	evs := collect(a.Send(context.Background(), "hello"))
	if evs[0].Kind != EventTextDelta || evs[0].Text != "hi" {
		t.Fatalf("evs[0]: %+v", evs[0])
	}
	if evs[len(evs)-1].Kind != EventTurnDone {
		t.Fatalf("last: %+v", evs[len(evs)-1])
	}
	// session: user + assistant persisted
	if len(a.Session.Messages) != 2 || a.Session.Messages[1].Role != provider.RoleAssistant {
		t.Fatalf("session: %+v", a.Session.Messages)
	}
}

func TestToolCallLoop(t *testing.T) {
	call := &provider.ToolCall{ID: "c1", Name: "echo", Input: json.RawMessage(`{"x":1}`)}
	f := &provider.Fake{Turns: [][]provider.Event{
		{{Kind: provider.EventToolCall, ToolCall: call}, {Kind: provider.EventDone}},
		{{Kind: provider.EventTextDelta, Text: "done"}, {Kind: provider.EventDone}},
	}}
	a := newAgent(t, f, echoTool{}, func(permission.Request) permission.Decision { return permission.Deny })
	evs := collect(a.Send(context.Background(), "go"))

	var sawStart, sawEnd bool
	for _, ev := range evs {
		if ev.Kind == EventToolStart && ev.ToolName == "echo" {
			sawStart = true
		}
		if ev.Kind == EventToolEnd && ev.Result.Content == `echo:{"x":1}` {
			sawEnd = true
		}
	}
	if !sawStart || !sawEnd {
		t.Fatalf("missing tool events: %+v", evs)
	}
	// second provider call must include the tool result message
	last := f.Calls[1].Messages[len(f.Calls[1].Messages)-1]
	if last.Role != provider.RoleTool || last.ToolCallID != "c1" {
		t.Fatalf("tool result not sent back: %+v", last)
	}
}

func TestMutatingToolDenied(t *testing.T) {
	call := &provider.ToolCall{ID: "c1", Name: "echo", Input: json.RawMessage(`{}`)}
	f := &provider.Fake{Turns: [][]provider.Event{
		{{Kind: provider.EventToolCall, ToolCall: call}, {Kind: provider.EventDone}},
		{{Kind: provider.EventDone}},
	}}
	a := newAgent(t, f, echoTool{mutating: true}, func(permission.Request) permission.Decision { return permission.Deny })
	evs := collect(a.Send(context.Background(), "go"))
	for _, ev := range evs {
		if ev.Kind == EventToolEnd {
			if !ev.Result.IsError {
				t.Fatalf("denied tool must produce error result: %+v", ev)
			}
			return
		}
	}
	t.Fatal("no ToolEnd event")
}

// TestSendGoroutineExitsOnContextCancel verifies that Send's internal
// goroutine does not leak when the consumer stops draining the channel and
// cancels the context. It never reads from the channel again after the
// first event, so a bare (non-select) `out <- ev` send in the implementation
// would block forever and the goroutine count would never drop back down.
func TestSendGoroutineExitsOnContextCancel(t *testing.T) {
	f := &provider.Fake{Turns: [][]provider.Event{
		{
			{Kind: provider.EventTextDelta, Text: "a"},
			{Kind: provider.EventTextDelta, Text: "b"},
			{Kind: provider.EventTextDelta, Text: "c"},
			{Kind: provider.EventDone},
		},
	}}
	a := newAgent(t, f, echoTool{}, func(permission.Request) permission.Decision { return permission.Deny })
	ctx, cancel := context.WithCancel(context.Background())

	runtime.GC()
	before := runtime.NumGoroutine()

	ch := a.Send(ctx, "hello")
	<-ch // consume the first event; the goroutine now blocks trying to send the next one
	cancel()

	deadline := time.Now().Add(2 * time.Second)
	for {
		runtime.GC()
		if runtime.NumGoroutine() <= before {
			return // Send's goroutine exited; no leak
		}
		if time.Now().After(deadline) {
			t.Fatalf("Send's goroutine appears to have leaked after ctx cancellation (goroutines before=%d, now=%d)", before, runtime.NumGoroutine())
		}
		time.Sleep(10 * time.Millisecond)
	}
}
