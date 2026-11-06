# Library context

This document defines the project's domain vocabulary. It intentionally avoids
implementation details; implementation decisions belong in architecture notes
and ADRs.

## Application

The running Library product: one local reading workspace composed of a desktop
shell, an application runtime, and a Svelte client. A browser preview is another
way to run the same client against the runtime.

## Desktop shell

The native window and the Deno Desktop host that starts, displays, and closes
the application. It owns window lifecycle, but it does not own library data.

## Application runtime

The long-lived process that owns Library's durable state and side effects. It
coordinates SQLite, filesystem access, scanning, reading sessions, and the
application API.

## Client

The Svelte application rendered in a browser or embedded desktop window. It
owns presentation, transient view state, and document rendering state. It may
request a state change, but it is not the authority for durable library state.

## Application API

The local HTTP boundary between the client and the application runtime. It
contains both resource queries and named commands. It is not assumed to be a
public network service.

## Binding

A native Deno Desktop in-process call from the client to a runtime or desktop
capability. Bindings are reserved for capabilities that genuinely require a
native surface or materially benefit from bypassing HTTP.

## Library item

A durable record representing a discoverable document, including its path,
metadata, and user curation state.

## Reading state

The durable state of a library item in the reading workflow: unread, queued,
reading, finished, dropped, or abandoned.

## Reading session

A bounded period of active reading activity for one library item. A session is
runtime-owned and may be closed explicitly, by shutdown, or by stale-session
cleanup.

## Resume position

The durable location from which a reader should reopen a document. EPUB CFIs
and PDF page locations are format-specific representations of the same domain
concept.

## Scanner

A runtime-owned process that observes configured filesystem roots and reconciles
discoverable documents with library item records. A missing file is not the
same thing as a deleted library item.
