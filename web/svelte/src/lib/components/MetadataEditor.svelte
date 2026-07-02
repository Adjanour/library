<script lang="ts">
  import { api, type Item, type ItemUpdate } from '$lib/api';
  import { PURPOSES } from '$lib/utils';

  let {
    item,
    onSaved
  }: {
    item: Item;
    onSaved: (updated: Item) => void;
  } = $props();

  let editing = $state(false);
  let saving = $state(false);
  let form = $state({
    title: item.title,
    authors: item.authors,
    year: item.year,
    category: item.category,
    purpose: item.purpose,
    tags: item.tags,
    description: item.description
  });

  // Sync form when the selected item changes
  $effect(() => {
    form = {
      title: item.title,
      authors: item.authors,
      year: item.year,
      category: item.category,
      purpose: item.purpose,
      tags: item.tags,
      description: item.description
    };
    editing = false;
  });

  async function save() {
    saving = true;
    try {
      const updates: ItemUpdate = {
        title: form.title,
        authors: form.authors,
        year: Number(form.year) || 0,
        category: form.category,
        purpose: form.purpose,
        tags: form.tags,
        description: form.description
      };
      const updated = await api.updateItem(item.id, updates);
      editing = false;
      onSaved(updated);
    } catch (e) {
      console.error('save failed', e);
    }
    saving = false;
  }

  function cancel() {
    editing = false;
  }
</script>

{#if editing}
  <div class="space-y-2">
    <div>
      <label class="text-[10px] text-text-muted">Title</label>
      <input bind:value={form.title} class="w-full bg-surface-2 border border-border rounded px-2 py-1 text-sm" />
    </div>
    <div>
      <label class="text-[10px] text-text-muted">Authors</label>
      <input bind:value={form.authors} class="w-full bg-surface-2 border border-border rounded px-2 py-1 text-sm" placeholder="Comma-separated" />
    </div>
    <div class="grid grid-cols-2 gap-2">
      <div>
        <label class="text-[10px] text-text-muted">Year</label>
        <input type="number" bind:value={form.year} class="w-full bg-surface-2 border border-border rounded px-2 py-1 text-sm" />
      </div>
      <div>
        <label class="text-[10px] text-text-muted">Category</label>
        <input bind:value={form.category} class="w-full bg-surface-2 border border-border rounded px-2 py-1 text-sm" />
      </div>
    </div>
    <div>
      <label class="text-[10px] text-text-muted">Purpose</label>
      <select bind:value={form.purpose} class="w-full bg-surface-2 border border-border rounded px-2 py-1 text-sm">
        <option value="">None</option>
        {#each PURPOSES as p}<option value={p}>{p}</option>{/each}
      </select>
    </div>
    <div>
      <label class="text-[10px] text-text-muted">Tags (comma-separated)</label>
      <input bind:value={form.tags} class="w-full bg-surface-2 border border-border rounded px-2 py-1 text-sm" />
    </div>
    <div>
      <label class="text-[10px] text-text-muted">Description</label>
      <textarea bind:value={form.description} rows="3" class="w-full bg-surface-2 border border-border rounded px-2 py-1 text-sm resize-none"></textarea>
    </div>
    <div class="flex gap-2 justify-end">
      <button class="px-2.5 py-1 text-xs bg-surface-2 border border-border rounded hover:bg-surface-3 transition-colors" onclick={cancel}>Cancel</button>
      <button class="px-2.5 py-1 text-xs bg-accent text-white rounded hover:bg-accent-hover transition-colors disabled:opacity-50" disabled={saving} onclick={save}>
        {saving ? 'Saving…' : 'Save'}
      </button>
    </div>
  </div>
{:else}
  <button
    class="text-[10px] text-text-muted hover:text-accent transition-colors flex items-center gap-1"
    onclick={() => (editing = true)}
  >
    <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
    Edit metadata (e)
  </button>
{/if}
