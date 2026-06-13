package tui

import (
	"fmt"
	"strings"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
)

func (m *model) View() string {
	if m.state == stateQuitting {
		return ""
	}

	header := m.renderHeader()
	content := m.renderContent()
	footer := m.renderFooter()

	return lipgloss.JoinVertical(lipgloss.Top, header, content, footer)
}

func (m *model) renderHeader() string {
	var b strings.Builder

	b.WriteString(titleStyle.Render("  📚 Library"))
	if m.query.Q != "" || m.query.Type != "" || m.query.Category != "" || m.query.Year > 0 {
		b.WriteString("  ")
		var filters []string
		if m.query.Q != "" {
			filters = append(filters, fmt.Sprintf("search: %s", accentStyle.Render(m.query.Q)))
		}
		if m.query.Type != "" {
			filters = append(filters, fmt.Sprintf("type: %s", yellowStyle.Render(m.query.Type)))
		}
		if m.query.Category != "" {
			filters = append(filters, fmt.Sprintf("cat: %s", greenStyle.Render(m.query.Category)))
		}
		if m.query.Year > 0 {
			filters = append(filters, fmt.Sprintf("year: %d", m.query.Year))
		}
		b.WriteString(dimStyle.Render(strings.Join(filters, " | ")))
	}
	b.WriteString("\n")

	if m.result != nil {
		info := fmt.Sprintf("  %d items  ·  page %d/%d",
			m.result.Total, m.result.Page, m.result.TotalPages)
		b.WriteString(dimStyle.Render(info))
	}

	b.WriteString("\n" + strings.Repeat("─", min(m.width, 80)) + "\n")
	return b.String()
}

func (m *model) renderContent() string {
	switch m.state {
	case stateDetail:
		return m.renderDetail()
	case stateStats:
		return m.renderStats()
	default:
		return m.renderList()
	}
}

func (m *model) renderList() string {
	if m.err != nil {
		return redStyle.Render("Error: " + m.err.Error())
	}

	if m.result == nil {
		return " " + m.spinner.View() + " Searching..."
	}

	if len(m.result.Items) == 0 {
		return dimStyle.Render("  No results found")
	}

	var b strings.Builder
	start, end := m.visibleRange()

	for i, item := range m.result.Items[start:end] {
		idx := start + i
		prefix := "  "
		if idx == m.cursor {
			prefix = " " + cursorStyle.Render("▸")
		}

		icon := typeIcon(string(item.Type))
		typeBadge := typeBadge(string(item.Type))

		title := item.Title
		if len(title) > 60 {
			title = title[:57] + "..."
		}

		var metaParts []string
		if item.Year > 0 {
			metaParts = append(metaParts, greenStyle.Render(fmt.Sprintf("(%d)", item.Year)))
		}
		if item.Category != "" {
			metaParts = append(metaParts, yellowStyle.Render("["+item.Category+"]"))
		}
		if item.Authors != "" {
			a := item.Authors
			if len(a) > 30 {
				a = a[:27] + "..."
			}
			metaParts = append(metaParts, dimStyle.Render(a))
		}

		line := fmt.Sprintf("%s %s %s %s %s",
			prefix, icon, typeBadge,
			accentStyle.Render(title),
			strings.Join(metaParts, " "))

		b.WriteString(line + "\n")
	}

	if m.result.TotalPages > 1 {
		b.WriteString("\n" + paginationStyle.Render(fmt.Sprintf(
			"  Page %d/%d  (%d items)  —  n:next  p:prev",
			m.result.Page, m.result.TotalPages, m.result.Total)))
	}

	return b.String()
}

func (m *model) visibleRange() (int, int) {
	if m.result == nil {
		return 0, 0
	}

	maxVisible := m.height - 6
	if maxVisible < 5 {
		maxVisible = 5
	}
	if maxVisible > len(m.result.Items) {
		maxVisible = len(m.result.Items)
	}

	start := m.cursor - maxVisible/2
	if start < 0 {
		start = 0
	}
	end := start + maxVisible
	if end > len(m.result.Items) {
		end = len(m.result.Items)
		start = end - maxVisible
		if start < 0 {
			start = 0
		}
	}

	return start, end
}

func (m *model) renderDetail() string {
	if m.detailItem == nil {
		return dimStyle.Render("  Loading...")
	}

	item := m.detailItem
	var b strings.Builder

	b.WriteString(accentStyle.Render("  ┌─ Item Details ──────────────────────────────") + "\n")
	b.WriteString(fmt.Sprintf("  │ %s %s\n", typeIcon(string(item.Type)), titleStyle.Render(item.Title)))
	b.WriteString(fmt.Sprintf("  │ %s\n", typeBadge(string(item.Type))))

	if item.Authors != "" {
		b.WriteString(fmt.Sprintf("  │\n  │ %s %s\n", detailLabelStyle.Render("Authors:"), item.Authors))
	}
	if item.Year > 0 {
		b.WriteString(fmt.Sprintf("  │ %s %d\n", detailLabelStyle.Render("Year:"), item.Year))
	}
	if item.Category != "" {
		b.WriteString(fmt.Sprintf("  │ %s %s\n", detailLabelStyle.Render("Category:"), yellowStyle.Render(item.Category)))
	}
	if item.Tags != "" {
		tags := strings.Split(item.Tags, ",")
		var colored []string
		for _, t := range tags {
			t = strings.TrimSpace(t)
			if t != "" {
				colored = append(colored, accentStyle.Render(t))
			}
		}
		b.WriteString(fmt.Sprintf("  │ %s %s\n", detailLabelStyle.Render("Tags:"), strings.Join(colored, " ")))
	}
	if item.Description != "" {
		desc := item.Description
		if len(desc) > 200 {
			desc = desc[:197] + "..."
		}
		b.WriteString(fmt.Sprintf("  │\n  │ %s\n", dimStyle.Render(desc)))
	}
	b.WriteString(fmt.Sprintf("  │\n  │ %s %s\n", detailLabelStyle.Render("File:"), dimStyle.Render(item.Filename)))
	b.WriteString(fmt.Sprintf("  │ %s %d bytes\n", detailLabelStyle.Render("Size:"), item.Size))

	b.WriteString(accentStyle.Render("  └────────────────────────────────────────────") + "\n")
	b.WriteString("\n  " + dimStyle.Render("o:open  q/esc:back"))

	return b.String()
}

func (m *model) renderStats() string {
	return dimStyle.Render("  Statistics view (press q/esc to go back)")
}

func (m *model) renderFooter() string {
	var b strings.Builder
	b.WriteString(strings.Repeat("─", min(m.width, 80)) + "\n")

	switch m.state {
	case stateSearch:
		b.WriteString("  " + accentStyle.Render("/") + dimStyle.Render("search: ") + m.input.View())

	case stateFilterType:
		b.WriteString("  " + yellowStyle.Render("type") + dimStyle.Render(": ") + m.input.View())

	case stateFilterCategory:
		b.WriteString("  " + greenStyle.Render("category") + dimStyle.Render(": ") + m.input.View())

	case stateFilterYear:
		b.WriteString("  " + dimStyle.Render("year: ") + m.input.View())

	default:
		help := dimStyle.Render(
			"  ↑/k ↓/j navigate  / search  t type  c cat  y year  enter detail  o open  n/p page  r reset  s stats  q quit  ? help")
		b.WriteString(help)
	}

	return b.String()
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

var _ tea.Model = (*model)(nil)
