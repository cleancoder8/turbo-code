package tui

import "github.com/charmbracelet/lipgloss"

var (
	BrandColor  = lipgloss.Color("#5F87FF") // company accent — change to brand palette
	subtleColor = lipgloss.Color("240")
	errorColor  = lipgloss.Color("#FF5F5F")

	statusStyle = lipgloss.NewStyle().Background(BrandColor).Foreground(lipgloss.Color("231")).Padding(0, 1)
	userStyle   = lipgloss.NewStyle().Foreground(BrandColor).Bold(true)
	toolStyle   = lipgloss.NewStyle().Foreground(subtleColor)
	errStyle    = lipgloss.NewStyle().Foreground(errorColor)
	inputBorder = lipgloss.NewStyle().Border(lipgloss.RoundedBorder()).BorderForeground(BrandColor)
)
