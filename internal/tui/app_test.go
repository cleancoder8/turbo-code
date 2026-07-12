package tui

import (
	"strings"
	"testing"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/x/exp/teatest"
)

func TestShellRendersAndQuits(t *testing.T) {
	app := New("fake-model", "20260711-000000")
	tm := teatest.NewTestModel(t, app, teatest.WithInitialTermSize(80, 24))

	teatest.WaitFor(t, tm.Output(), func(b []byte) bool {
		return len(b) > 0
	}, teatest.WithDuration(3*time.Second))

	tm.Send(tea.KeyMsg{Type: tea.KeyCtrlC})
	tm.WaitFinished(t, teatest.WithFinalTimeout(3*time.Second))
}

func TestStatusBarShowsModel(t *testing.T) {
	app := New("fake-model", "s1")
	app.width, app.height = 80, 24
	app.layout()
	if got := app.View(); !strings.Contains(got, "fake-model") {
		t.Fatalf("status bar missing model id:\n%s", got)
	}
}
