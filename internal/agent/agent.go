package agent

import (
	"context"
	"strings"

	"turbo-code/internal/permission"
	"turbo-code/internal/provider"
	"turbo-code/internal/session"
	"turbo-code/internal/tool"
)

type EventKind int

const (
	EventTextDelta EventKind = iota
	EventToolStart
	EventToolEnd
	EventTurnDone
	EventError
)

type Event struct {
	Kind     EventKind
	Text     string
	CallID   string
	ToolName string
	ToolArgs string
	Result   tool.Result
	Usage    provider.Usage
	Err      error
}

type Agent struct {
	Provider  provider.Provider
	Model     string
	MaxTokens int
	System    string
	Tools     *tool.Registry
	Perms     *permission.Service
	Session   *session.Session
}

// emit sends ev on out, but respects ctx cancellation so Send's goroutine
// never blocks forever on a consumer that stopped draining the channel.
// It reports whether the send succeeded; false means the caller should stop.
func emit(ctx context.Context, out chan<- Event, ev Event) bool {
	select {
	case out <- ev:
		return true
	case <-ctx.Done():
		return false
	}
}

func (a *Agent) Send(ctx context.Context, text string) <-chan Event {
	out := make(chan Event)
	go func() {
		defer close(out)
		a.Session.Append(provider.Message{Role: provider.RoleUser, Content: text})
		var usage provider.Usage
		for {
			events, err := a.Provider.Stream(ctx, provider.Request{
				Model: a.Model, System: a.System, MaxTokens: a.MaxTokens,
				Messages: a.Session.Messages, Tools: a.Tools.Defs(),
			})
			if err != nil {
				emit(ctx, out, Event{Kind: EventError, Err: err})
				return
			}
			var textBuf strings.Builder
			var calls []provider.ToolCall
			for ev := range events {
				switch ev.Kind {
				case provider.EventTextDelta:
					textBuf.WriteString(ev.Text)
					if !emit(ctx, out, Event{Kind: EventTextDelta, Text: ev.Text}) {
						return
					}
				case provider.EventToolCall:
					calls = append(calls, *ev.ToolCall)
				case provider.EventDone:
					usage.InputTokens += ev.Usage.InputTokens
					usage.OutputTokens += ev.Usage.OutputTokens
				case provider.EventError:
					emit(ctx, out, Event{Kind: EventError, Err: ev.Err})
					return
				}
			}
			a.Session.Append(provider.Message{
				Role: provider.RoleAssistant, Content: textBuf.String(), ToolCalls: calls,
			})
			if len(calls) == 0 {
				emit(ctx, out, Event{Kind: EventTurnDone, Usage: usage})
				return
			}
			for _, c := range calls {
				if !emit(ctx, out, Event{Kind: EventToolStart, CallID: c.ID, ToolName: c.Name, ToolArgs: string(c.Input)}) {
					return
				}
				res := a.runTool(ctx, c)
				if !emit(ctx, out, Event{Kind: EventToolEnd, CallID: c.ID, ToolName: c.Name, Result: res}) {
					return
				}
				a.Session.Append(provider.Message{
					Role: provider.RoleTool, Content: res.Content, ToolCallID: c.ID, IsError: res.IsError,
				})
			}
		}
	}()
	return out
}

func (a *Agent) runTool(ctx context.Context, c provider.ToolCall) tool.Result {
	t, ok := a.Tools.Get(c.Name)
	if !ok {
		return tool.Result{Content: "unknown tool: " + c.Name, IsError: true}
	}
	if t.Mutating() && !a.Perms.Allowed(permission.Request{ToolName: c.Name, Description: string(c.Input)}) {
		return tool.Result{Content: "User denied permission for this tool call.", IsError: true}
	}
	res, err := t.Run(ctx, c.Input)
	if err != nil {
		return tool.Result{Content: err.Error(), IsError: true}
	}
	return res
}
