package tui

import "turbo-code/internal/permission"

func (a *App) permView() string {
	if a.pendingPerm == nil {
		return ""
	}
	req := a.pendingPerm.req
	return inputBorder.Render(
		errStyle.Render("permission: ") + req.ToolName + " " + truncate(req.Description, 60) +
			"\n[y] allow once   [a] always   [n] deny")
}

func truncate(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n]) + "…"
}

func (a *App) answerPerm(d permission.Decision) {
	a.pendingPerm.reply <- d
	a.pendingPerm = nil
}
