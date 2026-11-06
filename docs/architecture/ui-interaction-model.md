# Library UI interaction model

Status: proposed design

This document defines how Library should feel and behave as a reading workspace.
It establishes Library's own interaction model: the center of gravity is
returning to meaningful reading, not managing an inventory database.

## Product center

The primary user question is:

> What should I read now?

The default journey should therefore be:

```text
Return to reading
  → continue the current book
  → choose the next queued book
  → browse the full library when necessary
```

The current catalog-first journey is useful for discovery but should not define
the whole application:

```text
Browse thousands of items
  → select an item
  → inspect metadata
  → choose Read
```

## Information architecture

The primary navigation should be small and ordered by intent:

```text
Continue Reading
Queue
Recent
Collections
All Library
```

Optional utility destinations may follow a divider:

```text
Settings
Diagnostics
Help / shortcuts
```

### Continue Reading

The default surface. It shows the current reading commitment, recent activity,
and an obvious `Continue` action.

It should answer:

- What was I reading?
- Where will I resume?
- What should I open next?

### Queue

The user's intentional next-reading order. Queue order is meaningful and should
be directly reorderable. Removing an item should explain the resulting state.

### Recent

Documents opened or changed recently. This is a temporal convenience, not a
second reading-state system.

### Collections

Filtered views over categories, tags, purposes, or types. Collections should not
compete visually with the primary reading path.

### All Library

The full indexed corpus. Search and filtering belong here. Large counts and
metadata are useful in this context but should not dominate Continue Reading.

## Surface contracts

Every primary surface should have a title, a one-line purpose, and one obvious
next action.

| Surface | Purpose | Primary action |
| --- | --- | --- |
| Continue Reading | Resume active reading | Continue |
| Queue | Choose what comes next | Open next |
| Recent | Return to something nearby | Open |
| Collections | Narrow the corpus | Filter/open |
| All Library | Find anything | Search/open |
| Reader | Read without distraction | Navigate |

The interface should not make the user infer the purpose from a collection of
icons and counts.

## Interaction grammar

Library should use one keyboard grammar throughout the app:

```text
⌘K       search or open anything
⌘J       jump to Continue Reading
⌘Q       jump to Queue
⌘,       open Settings
⌘\\       toggle the sidebar
⌘/       show keyboard shortcuts
⌥↑ / ⌥↓  move through the current list
Enter    open the selected item
R        read the selected item
Q        add the selected item to the queue
Esc      close the current layer or return to the previous surface
```

The exact modifier may vary by platform, but the action grammar should remain
stable. On Windows and Linux the UI must display the platform-appropriate key
labels.

### Focus and selection

- Keyboard selection and pointer hover should update the same selected item.
- Moving selection should keep the selected row visible.
- The selected item should have one clear visual treatment.
- List actions should operate on the selected item, not a hidden or stale item.
- Dialogs and the reader temporarily own keyboard input.
- Global shortcuts must pause while the user is typing in an input or editor.

### Visible affordances

Every important keyboard action must be discoverable through at least one of:

- a visible button;
- a tooltip;
- a shortcut hint beside the action;
- the shortcuts panel.

Keyboard support must not become an invisible expert mode.

## Reader entry and exit

Opening a document is a mode transition, not merely a modal toggle.

```text
Library surface
  → opening
  → reader ready
  → reading
  → finishing / closing
  → Library surface or next queued book
```

The reader should:

- preserve the originating surface;
- show a stable title and close/back action;
- expose reader controls without permanently showing library metadata;
- save durable progress through the runtime;
- restore the last valid resume position;
- return to the originating context when closed;
- offer the next queued book after completion.

Finishing one book should make the next action obvious without forcing the user
to accept automatic navigation. The recommended behavior is:

```text
Book finished
  → show “Finished” confirmation
  → show “Open next: <title>” as the primary action
  → keep “Back to queue” and “Close reader” available
```

Automatic opening may be enabled later as a preference, but it should not be
the only path.

## Empty and exceptional states

Empty states should describe the state and give the next valid action.

### Empty Continue Reading

```text
Nothing in progress

Choose a book from your queue, or search your library to begin.

[Search library]  [Open queue]
```

### Empty Queue

```text
Your reading queue is empty.

Add books here when you know you want to read them next.

[Browse library]
```

### Missing file

```text
This document is no longer at its saved location.

[Locate file] [Keep in library] [Remove from library]
```

### Reader failure

```text
Unable to open this document.

Try reopening it, or copy diagnostics if the problem continues.

[Retry] [Copy diagnostics] [Back]
```

Errors should state what the user can do next. Internal traces belong in a
diagnostic surface, not the default message.

## Visual language

Library should adopt a restrained visual system:

- one primary accent for interaction and selection;
- quiet borders rather than heavy containers;
- a small radius scale;
- one elevation/shadow language for sheets and dialogs;
- strong typography for titles and subdued metadata;
- tabular numerals for counts and percentages;
- generous reading space;
- state colors reserved for meaningful data states.

The current Library UI has useful components but too many simultaneous signals:
counts, filters, tags, metadata, toolbar actions, preview state, and progress.
The redesign should create this hierarchy:

```text
Primary:      current reading action
Secondary:    queue and recent activity
Tertiary:     metadata and classification
Contextual:   editing, diagnostics, and advanced filters
```

## Motion principles

Motion should explain causality rather than decorate the interface.

Use motion when:

- an item moves between reading states;
- a selection changes location;
- a panel enters or leaves the current context;
- progress changes gradually;
- new content settles into a list.

Rules:

- entrances may be expressive but brief;
- exits should be faster than entrances;
- do not animate unchanged content after a redraw;
- cap list staggering so long lists remain immediate;
- respect `prefers-reduced-motion`;
- do not delay a destructive or navigational action for animation.

## Native and browser behavior

The client should present one interaction model in browser preview and desktop
mode. Native capabilities may add affordances, but must not create a separate
product grammar.

Examples of appropriate native enhancements:

- native open-folder dialog for locating a missing file;
- application menu entries for shortcuts;
- desktop notifications for completed scans;
- native window close handling;
- system-level reader or capture shortcuts if later justified.

The UI should call a capability adapter rather than scattering environment checks
through components.

## Interaction state model

Each surface should make these states explicit:

```text
idle
loading
ready
empty
mutating
success
recoverable-error
unavailable
```

The interface should not use a generic spinner for all of them. For example:

- `loading`: the surface is being retrieved;
- `mutating`: the user's action is being committed;
- `success`: show the result and the next action;
- `recoverable-error`: keep the user's context and offer retry;
- `unavailable`: explain the missing capability or file.

## Design validation

Before implementing a redesign, validate these flows manually and with focused
UI tests:

1. Start with an empty library and find how to add a scan folder.
2. Open the app with one unfinished book and continue it within two actions.
3. Queue three books and reorder them using both pointer and keyboard input.
4. Finish a book and understand what happens to the next queued book.
5. Close and reopen the reader and recover the same position.
6. Encounter a missing file and recover without losing reading history.
7. Search a large library and open a result without losing search context.
8. Use the app without a mouse.
9. Use the app with reduced motion enabled.
10. Run the same flows in browser preview and desktop mode.

The acceptance criterion is not “all controls exist.” It is that the user can
predict what the application will do before committing an action.
