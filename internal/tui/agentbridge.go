package tui

import (
	"context"
	"fmt"
	"strings"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/glamour"

	"turbo-code/internal/agent"
	"turbo-code/internal/permission"
)

type agentEventMsg struct {
	ev agent.Event
	ch <-chan agent.Event
}
type agentDoneMsg struct{}
type permAskMsg struct {
	req   permission.Request
	reply chan permission.Decision
}

// NewWithAgent wires an agent into the shell (used by Run and tests).
func NewWithAgent(ag *agent.Agent, modelID, sessionID string) *App {
	app := New(modelID, sessionID)
	app.agent = ag
	app.onSubmit = func(text string) tea.Cmd {
		app.appendBlock(userStyle.Render("> " + text))
		app.setStatus("thinking…")
		ch := ag.Send(context.Background(), text)
		return waitEvent(ch)
	}
	return app
}

// Run constructs the program, wires the permission asker, and blocks until quit.
func Run(ag *agent.Agent, modelID, sessionID string) error {
	app := NewWithAgent(ag, modelID, sessionID)
	p := tea.NewProgram(app, tea.WithAltScreen())
	done := make(chan struct{})
	ag.Perms = permission.New(func(req permission.Request) permission.Decision {
		// Buffered so answerPerm's send (in the Update goroutine) never
		// blocks, even if this AskFunc has already returned via the done
		// case below.
		reply := make(chan permission.Decision, 1)
		p.Send(permAskMsg{req: req, reply: reply})
		select {
		case d := <-reply:
			return d
		case <-done:
			// Program quit (or is quitting) before the prompt was answered
			// — p.Send may have silently dropped the message, so don't
			// block forever waiting for a reply that will never come.
			return permission.Deny
		}
	})
	_, err := p.Run()
	close(done)
	return err
}

func waitEvent(ch <-chan agent.Event) tea.Cmd {
	return func() tea.Msg {
		ev, ok := <-ch
		if !ok {
			return agentDoneMsg{}
		}
		return agentEventMsg{ev: ev, ch: ch}
	}
}

func (a *App) handleAgentEvent(msg agentEventMsg) tea.Cmd {
	switch msg.ev.Kind {
	case agent.EventTextDelta:
		a.stream += msg.ev.Text
		a.refresh()
	case agent.EventToolStart:
		// Flush any assistant prose accumulated before this tool call as its
		// own block first — otherwise appendBlock below would silently
		// discard it by resetting a.stream without rendering it.
		a.flushStreamAsMarkdown()
		args := msg.ev.ToolArgs
		if r := []rune(args); len(r) > 80 {
			args = string(r[:80]) + "…"
		}
		a.appendBlock(toolStyle.Render("⚙ " + msg.ev.ToolName + " " + args))
	case agent.EventToolEnd:
		line := strings.SplitN(msg.ev.Result.Content, "\n", 2)[0]
		if msg.ev.Result.IsError {
			a.appendBlock(errStyle.Render("  ✗ " + line))
		} else {
			a.appendBlock(toolStyle.Render("  ✓ " + line))
		}
	case agent.EventTurnDone:
		a.flushStreamAsMarkdown()
		a.setStatus(fmt.Sprintf("in %d · out %d tokens", msg.ev.Usage.InputTokens, msg.ev.Usage.OutputTokens))
	case agent.EventError:
		a.appendBlock(errStyle.Render("error: " + msg.ev.Err.Error()))
		a.setStatus("error")
	}
	return waitEvent(msg.ch)
}

func (a *App) flushStreamAsMarkdown() {
	if a.stream == "" {
		return
	}
	r, err := glamour.NewTermRenderer(glamour.WithAutoStyle(), glamour.WithWordWrap(a.width-2))
	if err == nil {
		if out, rerr := r.Render(a.stream); rerr == nil {
			a.stream = ""
			a.appendBlock(strings.TrimRight(out, "\n"))
			return
		}
	}
	a.appendBlock(a.stream) // fallback: raw text
	a.stream = ""
}
