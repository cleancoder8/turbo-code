package tui

import (
	"strings"

	"github.com/charmbracelet/bubbles/textarea"
	"github.com/charmbracelet/bubbles/viewport"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"

	"turbo-code/internal/agent"
	"turbo-code/internal/permission"
)

type App struct {
	viewport viewport.Model
	input    textarea.Model
	blocks   []string
	stream   string // in-flight assistant text, not yet a block

	modelID   string
	sessionID string
	status    string // right side of status bar (tokens, state)

	onSubmit func(text string) tea.Cmd // wired by Task 15

	agent       *agent.Agent
	pendingPerm *permAskMsg

	width, height int
	ready         bool
}

func New(modelID, sessionID string) *App {
	ta := textarea.New()
	ta.Placeholder = "Ask turbo-code anything…"
	ta.SetHeight(3)
	ta.Focus()
	ta.ShowLineNumbers = false
	ta.KeyMap.InsertNewline.SetKeys("alt+enter")
	return &App{input: ta, modelID: modelID, sessionID: sessionID, status: "ready"}
}

func (a *App) Init() tea.Cmd { return textarea.Blink }

func (a *App) layout() {
	inputHeight := a.input.Height() + 2    // border
	vpHeight := a.height - inputHeight - 1 // status bar
	if vpHeight < 1 {
		vpHeight = 1
	}
	a.viewport = viewport.New(a.width, vpHeight)
	a.input.SetWidth(a.width - 2)
	a.ready = true
	a.refresh()
}

func (a *App) refresh() {
	content := strings.Join(a.blocks, "\n")
	if a.stream != "" {
		content += "\n" + a.stream
	}
	a.viewport.SetContent(content)
	a.viewport.GotoBottom()
}

func (a *App) appendBlock(s string) {
	a.blocks = append(a.blocks, s)
	a.stream = ""
	a.refresh()
}

func (a *App) setStatus(s string) { a.status = s }

func (a *App) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	var cmds []tea.Cmd
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		a.width, a.height = msg.Width, msg.Height
		a.layout()
	case permAskMsg:
		m := msg
		a.pendingPerm = &m
		return a, nil
	case agentEventMsg:
		return a, a.handleAgentEvent(msg)
	case agentDoneMsg:
		a.setStatus("ready")
		return a, nil
	case tea.KeyMsg:
		if a.pendingPerm != nil {
			switch msg.String() {
			case "y":
				a.answerPerm(permission.AllowOnce)
			case "a":
				a.answerPerm(permission.AllowAlways)
			case "n", "esc":
				a.answerPerm(permission.Deny)
			}
			return a, nil
		}
		switch msg.String() {
		case "ctrl+c":
			return a, tea.Quit
		case "enter":
			// swallow enter so it never reaches the textarea (alt+enter inserts newline)
			text := strings.TrimSpace(a.input.Value())
			if text != "" && a.onSubmit != nil {
				a.input.Reset()
				return a, a.onSubmit(text)
			}
			return a, nil
		}
	}
	var cmd tea.Cmd
	a.input, cmd = a.input.Update(msg)
	cmds = append(cmds, cmd)
	a.viewport, cmd = a.viewport.Update(msg)
	cmds = append(cmds, cmd)
	return a, tea.Batch(cmds...)
}

func (a *App) statusBar() string {
	left := statusStyle.Render("turbo-code")
	mid := " " + a.modelID + " · " + a.sessionID + " "
	right := a.status
	gap := a.width - lipgloss.Width(left) - lipgloss.Width(mid) - lipgloss.Width(right)
	if gap < 0 {
		gap = 0
	}
	return left + mid + strings.Repeat(" ", gap) + right
}

func (a *App) View() string {
	if !a.ready {
		return "loading…"
	}
	perm := a.permView()
	if perm != "" {
		perm += "\n"
	}
	return a.viewport.View() + "\n" + perm + inputBorder.Render(a.input.View()) + "\n" + a.statusBar()
}
