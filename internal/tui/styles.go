package tui

import "github.com/charmbracelet/lipgloss"

var (
	titleStyle = lipgloss.NewStyle().
			Foreground(lipgloss.Color("39")).
			Bold(true)

	headerStyle = lipgloss.NewStyle().
			Foreground(lipgloss.Color("39")).
			Bold(true)

	infoStyle = lipgloss.NewStyle().
			Foreground(lipgloss.Color("243"))

	dimStyle = lipgloss.NewStyle().
			Foreground(lipgloss.Color("241"))

	accentStyle = lipgloss.NewStyle().
			Foreground(lipgloss.Color("39"))

	greenStyle = lipgloss.NewStyle().
			Foreground(lipgloss.Color("42"))

	yellowStyle = lipgloss.NewStyle().
			Foreground(lipgloss.Color("221"))

	redStyle = lipgloss.NewStyle().
			Foreground(lipgloss.Color("196"))

	purpleStyle = lipgloss.NewStyle().
			Foreground(lipgloss.Color("141"))

	cyanStyle = lipgloss.NewStyle().
			Foreground(lipgloss.Color("86"))

	orangeStyle = lipgloss.NewStyle().
			Foreground(lipgloss.Color("215"))

	selectedStyle = lipgloss.NewStyle().
			Foreground(lipgloss.Color("0")).
			Background(lipgloss.Color("39")).
			Padding(0, 1)

	cursorStyle = lipgloss.NewStyle().
			Foreground(lipgloss.Color("39")).
			Bold(true)

	statusBarStyle = lipgloss.NewStyle().
			Background(lipgloss.Color("236")).
			Foreground(lipgloss.Color("250")).
			Padding(0, 1)

	helpStyle = lipgloss.NewStyle().
			Foreground(lipgloss.Color("241"))

	detailLabelStyle = lipgloss.NewStyle().
				Foreground(lipgloss.Color("243")).
				Bold(true)

	paginationStyle = lipgloss.NewStyle().
			Foreground(lipgloss.Color("241"))
)

func typeBadge(t string) string {
	var style lipgloss.Style
	switch t {
	case "book":
		style = lipgloss.NewStyle().Background(lipgloss.Color("27")).Foreground(lipgloss.Color("15")).Padding(0, 1)
	case "paper":
		style = lipgloss.NewStyle().Background(lipgloss.Color("141")).Foreground(lipgloss.Color("15")).Padding(0, 1)
	case "thesis":
		style = lipgloss.NewStyle().Background(lipgloss.Color("86")).Foreground(lipgloss.Color("0")).Padding(0, 1)
	case "ebook":
		style = lipgloss.NewStyle().Background(lipgloss.Color("215")).Foreground(lipgloss.Color("0")).Padding(0, 1)
	default:
		style = lipgloss.NewStyle().Background(lipgloss.Color("243")).Foreground(lipgloss.Color("15")).Padding(0, 1)
	}
	return style.Render(t)
}

func typeIcon(t string) string {
	switch t {
	case "book":
		return "📕"
	case "paper":
		return "📄"
	case "thesis":
		return "🎓"
	case "ebook":
		return "📱"
	default:
		return "📎"
	}
}
