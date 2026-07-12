package tui

import (
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
