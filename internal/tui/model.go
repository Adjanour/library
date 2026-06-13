package tui

import (
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"strconv"
	"strings"

	"github.com/charmbracelet/bubbles/spinner"
	"github.com/charmbracelet/bubbles/textinput"
	tea "github.com/charmbracelet/bubbletea"

	"github.com/bernard/library/internal/db"
	"github.com/bernard/library/internal/models"
)

type state int

const (
	stateList state = iota
	stateSearch
	stateFilterType
	stateFilterCategory
	stateFilterYear
	stateDetail
	stateStats
	stateQuitting
)

type searchResultMsg struct {
	result *models.SearchResult
	err    error
}

type detailMsg struct {
	item *models.Item
	err  error
}

func New(database *db.DB) *model {
	s := spinner.New()
	s.Style = accentStyle
	s.Spinner = spinner.Dot

	ti := textinput.New()
	ti.Prompt = ""
	ti.PromptStyle = accentStyle
	ti.Cursor.Style = accentStyle
	ti.CharLimit = 200
	ti.Width = 60

	m := &model{
		database: database,
		state:    stateList,
		query:    models.SearchQuery{Limit: 50},
		spinner:  s,
		input:    ti,
	}
	return m
}

type model struct {
	database *db.DB
	state    state

	query  models.SearchQuery
	result *models.SearchResult
	cursor int

	input   textinput.Model
	spinner spinner.Model

	detailItem *models.Item

	width  int
	height int
	err    error
}

func (m *model) Init() tea.Cmd {
	return m.search()
}

func (m *model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
		m.input.Width = msg.Width - 20

	case tea.KeyMsg:
		return m.handleKey(msg)

	case searchResultMsg:
		m.result = msg.result
		m.err = msg.err
		if m.err == nil && m.result != nil && m.cursor >= len(m.result.Items) {
			m.cursor = 0
		}

	case detailMsg:
		m.detailItem = msg.item
		m.err = msg.err
		if m.detailItem != nil {
			m.state = stateDetail
		}

	case spinner.TickMsg:
		var cmd tea.Cmd
		m.spinner, cmd = m.spinner.Update(msg)
		return m, cmd
	}

	var cmd tea.Cmd
	m.input, cmd = m.input.Update(msg)
	return m, cmd
}

func (m *model) handleKey(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch m.state {
	case stateList:
		return m.handleListKey(msg)
	case stateSearch, stateFilterType, stateFilterCategory, stateFilterYear:
		return m.handleInputKey(msg)
	case stateDetail:
		return m.handleDetailKey(msg)
	case stateStats:
		return m.handleStatsKey(msg)
	}
	return m, nil
}

func (m *model) handleListKey(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch msg.String() {
	case "q", "ctrl+c":
		m.state = stateQuitting
		return m, tea.Quit

	case "up", "k":
		if m.cursor > 0 {
			m.cursor--
		}

	case "down", "j":
		if m.result != nil && m.cursor < len(m.result.Items)-1 {
			m.cursor++
		}

	case "enter":
		if m.result != nil && len(m.result.Items) > 0 {
			return m, loadDetail(m.database, m.result.Items[m.cursor].ID)
		}

	case "o":
		if m.result != nil && len(m.result.Items) > 0 {
			openItem(m.database, m.result.Items[m.cursor].ID)
		}

	case "/":
		m.state = stateSearch
		m.input.SetValue("")
		m.input.Placeholder = "search title, author..."
		m.input.Focus()
		return m, textinput.Blink

	case "t":
		m.state = stateFilterType
		m.input.SetValue("")
		m.input.Placeholder = "type (book/paper/thesis/ebook)"
		m.input.Focus()
		return m, textinput.Blink

	case "c":
		m.state = stateFilterCategory
		m.input.SetValue("")
		m.input.Placeholder = "category name"
		m.input.Focus()
		return m, textinput.Blink

	case "y":
		m.state = stateFilterYear
		m.input.SetValue("")
		m.input.Placeholder = "year (e.g. 2020)"
		m.input.Focus()
		return m, textinput.Blink

	case "n":
		if m.result != nil && m.result.Page < m.result.TotalPages {
			m.query.Page++
			m.cursor = 0
			return m, m.search()
		}

	case "p":
		if m.result != nil && m.query.Page > 1 {
			m.query.Page--
			m.cursor = 0
			return m, m.search()
		}

	case "r", "R":
		m.query = models.SearchQuery{Limit: 50}
		m.cursor = 0
		return m, m.search()

	case "s":
		return m, loadStatsView(m.database)

	case "g":
		if m.result != nil && len(m.result.Items) > 0 {
			m.cursor = 0
		}

	case "G":
		if m.result != nil && len(m.result.Items) > 0 {
			m.cursor = len(m.result.Items) - 1
		}

	case "?":
		showHelpTUI()
	}

	return m, nil
}

func (m *model) handleInputKey(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch msg.String() {
	case "enter":
		val := strings.TrimSpace(m.input.Value())
		switch m.state {
		case stateSearch:
			m.query.Q = val
		case stateFilterType:
			m.query.Type = val
		case stateFilterCategory:
			m.query.Category = val
		case stateFilterYear:
			if y, err := strconv.Atoi(val); err == nil {
				m.query.Year = y
			}
		}
		m.query.Page = 1
		m.cursor = 0
		m.state = stateList
		m.input.Blur()
		return m, m.search()

	case "esc":
		m.state = stateList
		m.input.Blur()
	}

	return m, nil
}

func (m *model) handleDetailKey(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch msg.String() {
	case "q", "esc", "enter":
		m.state = stateList

	case "o":
		if m.detailItem != nil {
			openItem(m.database, m.detailItem.ID)
		}

	case "left":
		m.state = stateList
	}

	return m, nil
}

func (m *model) handleStatsKey(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	if msg.String() == "q" || msg.String() == "esc" || msg.String() == "enter" {
		m.state = stateList
	}
	return m, nil
}

func (m *model) search() tea.Cmd {
	return func() tea.Msg {
		result, err := m.database.Search(m.query)
		return searchResultMsg{result: result, err: err}
	}
}

func loadDetail(database *db.DB, id int64) tea.Cmd {
	return func() tea.Msg {
		item, err := database.GetItem(id)
		return detailMsg{item: item, err: err}
	}
}

func loadStatsView(database *db.DB) tea.Cmd {
	return func() tea.Msg {
		return statReadyMsg{}
	}
}

type statReadyMsg struct{}

func openItem(database *db.DB, id int64) {
	item, err := database.GetItem(id)
	if err != nil {
		return
	}
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "linux":
		cmd = exec.Command("xdg-open", item.Path)
	case "darwin":
		cmd = exec.Command("open", item.Path)
	default:
		return
	}
	cmd.Start()
}

func showHelpTUI() {
	fmt.Fprint(os.Stderr,
		"\nKeyboard Shortcuts:\n"+
			"  ↑/k, ↓/j    Navigate list\n"+
			"  enter       View item details\n"+
			"  /           Search by title/author\n"+
			"  t           Filter by type\n"+
			"  c           Filter by category\n"+
			"  y           Filter by year\n"+
			"  n/p         Next/Previous page\n"+
			"  o           Open selected item\n"+
			"  s           View statistics\n"+
			"  r           Reset all filters\n"+
			"  g           Go to first item\n"+
			"  G           Go to last item\n"+
			"  q/ctrl+c    Quit\n"+
			"  ?           Show this help\n")
}
