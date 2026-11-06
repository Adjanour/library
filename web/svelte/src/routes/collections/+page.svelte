<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import BookCard from '$lib/components/BookCard.svelte';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import Skeleton from '$lib/components/Skeleton.svelte';
  import { api, type Collection, type Item } from '$lib/api';
  import { toast } from '$lib/toast.svelte';

  let collections = $state<Collection[]>([]);
  let loading = $state(true);
  let error = $state('');

  // Create form
  let name = $state('');
  let description = $state('');
  let creating = $state(false);
  let recentlyCreated = $state<number | null>(null);

  // Opened collection
  let openCollection = $state<Collection | null>(null);
  let openItems = $state<Item[]>([]);
  let membership = $state<Set<number>>(new Set());
  let loadingItems = $state(false);
  let confirmingFor = $state<number | null>(null);
  let editingDetails = $state(false);
  let editName = $state('');
  let editDescription = $state('');
  let savingDetails = $state(false);

  // Add-from-library search inside an open collection
  let addItemQuery = $state('');
  let addResults = $state<Item[]>([]);
  let searchTimer: ReturnType<typeof setTimeout> | undefined;

  async function loadCollections() {
    loading = true;
    try {
      collections = await api.collections();
      error = '';
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Could not load collections.';
    } finally { loading = false; }
  }

  async function createCollection(event?: SubmitEvent) {
    event?.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || creating) return;
    creating = true;
    try {
      const created = await api.createCollection(trimmed, description.trim());
      collections = [...collections, created].sort((a, b) => a.name.localeCompare(b.name));
      recentlyCreated = created.id;
      name = ''; description = '';
      toast(`Collection “${trimmed}” created`);
      setTimeout(() => { if (recentlyCreated === created.id) recentlyCreated = null; }, 1600);
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : 'Could not create the collection');
    } finally { creating = false; }
  }

  async function open(collection: Collection) {
    openCollection = collection;
    editingDetails = false;
    editName = collection.name;
    editDescription = collection.description;
    confirmingFor = null;
    addItemQuery = '';
    addResults = [];
    loadingItems = true;
    try {
      openItems = await api.collectionItems(collection.id);
      membership = new Set(openItems.map((item) => item.id));
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Could not load the collection.';
    } finally { loadingItems = false; }
  }

  function startEditingDetails() {
    if (!openCollection) return;
    editName = openCollection.name;
    editDescription = openCollection.description;
    editingDetails = true;
  }

  async function saveDetails() {
    if (!openCollection || !editName.trim() || savingDetails) return;
    savingDetails = true;
    try {
      const updated = await api.updateCollection(openCollection.id, editName, editDescription);
      openCollection = updated;
      collections = collections.map((collection) => collection.id === updated.id ? updated : collection)
        .sort((a, b) => a.name.localeCompare(b.name));
      editingDetails = false;
      toast('Collection details saved');
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : 'Could not save collection details.');
    } finally { savingDetails = false; }
  }

  async function refreshOpen() {
    if (!openCollection) return;
    const [items, collection] = await Promise.all([
      api.collectionItems(openCollection.id).catch(() => openItems),
      api.collection(openCollection.id).catch(() => openCollection!),
    ]);
    openItems = items;
    membership = new Set(items.map((item) => item.id));
    openCollection = collection;
    collections = collections.map((entry) => entry.id === collection.id ? collection : entry);
  }

  async function deleteCollection(collection: Collection) {
    try {
      await api.deleteCollection(collection.id);
      collections = collections.filter((entry) => entry.id !== collection.id);
      toast(`Deleted collection “${collection.name}”`);
      if (openCollection?.id === collection.id) { openCollection = null; openItems = []; }
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : 'Could not delete the collection.');
    }
  }

  async function addItem(item: Item) {
    if (!openCollection) return;
    try {
      await api.addToCollection(openCollection.id, item.id);
      membership = new Set([...membership, item.id]);
      toast(`Added “${item.title}” to “${openCollection.name}”`);
      await refreshOpen();
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : 'Could not add the item.');
    }
  }

  async function removeItem(item: Item) {
    if (!openCollection) return;
    try {
      await api.removeFromCollection(openCollection.id, item.id);
      membership = new Set([...membership].filter((id) => id !== item.id));
      toast(`Removed “${item.title}” from “${openCollection.name}”`);
      await refreshOpen();
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : 'Could not remove the item.');
    }
  }

  async function moveItem(index: number, direction: -1 | 1) {
    if (!openCollection) return;
    const target = index + direction;
    if (target < 0 || target >= openItems.length) return;
    const reordered = [...openItems];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    openItems = reordered;
    try { await api.reorderCollection(openCollection.id, reordered.map((item) => item.id)); }
    catch (cause) { toast(cause instanceof Error ? cause.message : 'Could not reorder collection.'); await refreshOpen(); }
  }

  function addQueryChanged(next: string) {
    addItemQuery = next;
    if (searchTimer) clearTimeout(searchTimer);
    if (!next.trim()) { addResults = []; return; }
    searchTimer = setTimeout(async () => {
      try {
        const result = await api.search(next, { limit: 8 });
        addResults = result.items.filter((item) => !membership.has(item.id)).slice(0, 5);
      } catch { addResults = []; }
    }, 180);
  }

  function backToList() {
    openCollection = null;
    editingDetails = false;
    openItems = [];
    addResults = [];
    void loadCollections();
  }

  onMount(() => { void loadCollections(); });
</script>

{#snippet collectionCard(entry: Collection)}
  <article
    class="library-fade-in group rounded-xl border border-border bg-surface-1 p-4 transition-colors hover:border-accent/50 hover:bg-surface-2"
    class:border-accent={recentlyCreated === entry.id}
  >
    <button class="block w-full rounded text-left outline-none focus-visible:ring-2 focus-visible:ring-accent" onclick={() => void open(entry)}>
      <h2 class="text-sm font-medium tracking-[-0.01em]">{entry.name}</h2>
      {#if entry.description}<p class="mt-1 line-clamp-2 text-xs text-text-secondary">{entry.description}</p>{/if}
      <p class="mt-2 text-[11px] text-text-muted">{entry.item_count} {entry.item_count === 1 ? 'item' : 'items'}</p>
    </button>
    <div class="mt-2 flex justify-end">
      <button
        class="rounded px-1.5 py-1 text-[10px] text-text-muted transition-colors opacity-0 group-hover:opacity-100 focus-visible:opacity-100 {confirmingFor === entry.id
          ? 'text-error'
          : 'hover:text-error'}"
        onclick={(event) => { event.stopPropagation(); if (confirmingFor === entry.id) { confirmingFor = null; void deleteCollection(entry); } else { confirmingFor = entry.id; } }}
        onblur={() => { if (confirmingFor === entry.id) confirmingFor = null; }}
      >{confirmingFor === entry.id ? 'Confirm delete' : 'Delete'}</button>
    </div>
  </article>
{/snippet}

{#if openCollection}
  <!-- Collection detail -->
  <div class="flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-6">
    <div class="shrink-0">
      <button class="text-[11px] text-text-secondary hover:text-text-primary" onclick={backToList}>← Collections</button>
      {#if editingDetails}
        <form class="mt-2 max-w-xl space-y-2" onsubmit={(event) => { event.preventDefault(); void saveDetails(); }}>
          <label class="sr-only" for="edit-collection-name">Collection name</label>
          <input id="edit-collection-name" bind:value={editName} class="ui-field w-full text-sm" maxlength="80" />
          <label class="sr-only" for="edit-collection-description">Collection description</label>
          <textarea id="edit-collection-description" bind:value={editDescription} class="ui-field min-h-20 w-full resize-y text-xs" maxlength="280" placeholder="What is this collection for?"></textarea>
          <div class="flex gap-2"><button class="ui-button-primary px-3 py-1.5 text-xs disabled:opacity-50" disabled={!editName.trim() || savingDetails} type="submit">{savingDetails ? 'Saving…' : 'Save details'}</button><button class="rounded px-3 py-1.5 text-xs text-text-secondary hover:bg-surface-2" type="button" onclick={() => editingDetails = false}>Cancel</button></div>
        </form>
      {:else}
        <div class="mt-1 flex flex-wrap items-center gap-2"><h1 class="text-lg font-medium tracking-[-0.01em]">{openCollection.name}</h1><button class="rounded px-2 py-1 text-[11px] text-text-secondary hover:bg-surface-2 hover:text-text-primary" onclick={startEditingDetails}>Edit details</button></div>
        {#if openCollection.description}<p class="mt-0.5 max-w-xl text-xs text-text-secondary">{openCollection.description}</p>{:else}<p class="mt-0.5 text-xs text-text-muted">No description yet.</p>{/if}
        <p class="mt-1 text-[11px] text-text-muted">{openCollection.item_count} {openCollection.item_count === 1 ? 'item' : 'items'} · use the arrows to set reading order</p>
      {/if}
    </div>

    <!-- Add from library -->
    <form class="shrink-0" onsubmit={(event) => event.preventDefault()}>
      <label class="sr-only" for="collection-add">Search library to add</label>
      <input
        id="collection-add"
        value={addItemQuery}
        oninput={(event) => addQueryChanged((event.currentTarget as HTMLInputElement).value)}
        class="ui-field text-xs"
        placeholder="Search your library to add items…"
        autocomplete="off"
      />
      {#if addItemQuery.trim()}
        <div class="mt-2 rounded-lg border border-border bg-surface-1 p-2">
          {#if addResults.length === 0}<p class="px-1 py-2 text-[11px] text-text-muted">No unadded items match.</p>
          {:else}
            <ul class="divide-y divide-border">
              {#each addResults as result (result.id)}
                <li class="flex items-center justify-between gap-3 px-1 py-2">
                  <span class="min-w-0 truncate text-xs">{result.title}</span>
                  <button class="ui-button-primary shrink-0 px-2 py-1 text-[10px]" onclick={() => void addItem(result)}>Add</button>
                </li>
              {/each}
            </ul>
          {/if}
        </div>
      {/if}
    </form>

    {#if loadingItems}
      <div class="book-grid" aria-hidden="true">
        {#each [0, 1, 2, 3] as _}
          <div class="rounded-xl border border-border bg-surface-1 p-2.5">
            <Skeleton className="mb-2.5 aspect-[3/4] rounded-lg" />
            <Skeleton className="mb-1.5 h-3 rounded" />
            <Skeleton className="h-2 w-2/3 rounded" />
          </div>
        {/each}
      </div>
    {:else if openItems.length === 0}
      <EmptyState title="This collection is empty" message="Search your library above to add its first item." />
    {:else}
      <section class="book-grid min-h-0">
        {#each openItems as item, index (item.id)}
          <div>
            <BookCard {item} isSelected={false} query="" onClick={(entry) => void goto(`/reader/${entry.id}?returnTo=${encodeURIComponent('/collections')}`)} />
            <div class="mt-1 flex gap-1"><button class="flex-1 rounded py-1 text-center text-[10px] text-text-muted hover:bg-surface-2 disabled:opacity-30" disabled={index === 0} title="Move earlier" onclick={() => void moveItem(index, -1)}>↑ Earlier</button><button class="flex-1 rounded py-1 text-center text-[10px] text-text-muted hover:bg-surface-2 disabled:opacity-30" disabled={index === openItems.length - 1} title="Move later" onclick={() => void moveItem(index, 1)}>Later ↓</button></div>
            <button class="mt-1 w-full rounded py-1 text-center text-[10px] text-text-muted transition-colors hover:text-error" onclick={() => void removeItem(item)}>Remove</button>
          </div>
        {/each}
      </section>
    {/if}
  </div>
{:else}
  <!-- Collections index -->
  <div class="flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-6">
    <div class="shrink-0">
      <h1 class="text-lg font-medium tracking-[-0.01em]">Collections</h1>
      <p class="mt-0.5 text-xs text-text-secondary">Group related books into named sets you come back to.</p>
    </div>

    <form class="shrink-0 rounded-xl border border-border bg-surface-0 p-3" onsubmit={createCollection}>
      <div class="flex flex-wrap items-center gap-2">
        <label class="sr-only" for="collection-name">Collection name</label>
        <input id="collection-name" bind:value={name} class="ui-field min-w-[12rem] flex-1 text-xs" placeholder="New collection name" autocomplete="off" maxlength="80" />
        <label class="sr-only" for="collection-description">Description</label>
        <input id="collection-description" bind:value={description} class="ui-field min-w-[10rem] flex-[2] text-xs" placeholder="Optional description" autocomplete="off" maxlength="280" />
        <button class="ui-button-primary text-xs disabled:opacity-50" disabled={!name.trim() || creating} type="submit">Create collection</button>
      </div>
    </form>

    {#if error}<EmptyState title="Collections unavailable" message={error} actionLabel="Retry" actionHref="/collections" />
    {:else if loading}
      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-hidden="true">
        {#each [0, 1, 2] as _}
          <div class="rounded-xl border border-border bg-surface-1 p-4"><Skeleton className="mb-2 h-4 w-1/2 rounded" /><Skeleton className="mb-1.5 h-2.5 w-3/4 rounded" /><Skeleton className="h-2 w-1/4 rounded" /></div>
        {/each}
      </div>
    {:else if collections.length === 0}
      <EmptyState title="No collections yet" message="Create one above — for example “Philosophy finish list” or “Next quarter's reading”." />
    {:else}
      <section class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {#each collections as entry (entry.id)}
          {@render collectionCard(entry)}
        {/each}
      </section>
    {/if}
  </div>
{/if}

<style>
  .book-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(9.75rem, 1fr)); gap: .75rem; align-items: start; }
  @media (min-width: 1500px) { .book-grid { grid-template-columns: repeat(auto-fill, minmax(10.5rem, 1fr)); } }
</style>
