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
	ag.Perms = permission.New(func(req permission.Request) permission.Decision {
		reply := make(chan permission.Decision)
		p.Send(permAskMsg{req: req, reply: reply})
		return <-reply
	})
	_, err := p.Run()
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
		args := msg.ev.ToolArgs
		if len(args) > 80 {
			args = args[:80] + "…"
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
