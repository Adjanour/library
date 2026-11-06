<script lang="ts">
  /**
   * Numbered pagination in the shadcn / Base UI style: chevron buttons on the
   * ends, a rolling window of pages with ellipsoid gaps, keyboard focus rings.
   */
  let { page, totalPages, onChange, label = 'Pagination' }: {
    page: number;
    totalPages: number;
    onChange: (next: number) => void;
    label?: string;
  } = $props();

  /** Numbers and 'gap' markers: 1 … (page-1..page+1) … totalPages */
  function pages(): (number | 'gap')[] {
    if (totalPages <= 7) {
      return Array.from({ length: totalPages }, (_, index) => index + 1);
    }
    const list: (number | 'gap')[] = [1];
    let start = Math.max(2, page - 1);
    let end = Math.min(totalPages - 1, page + 1);
    // Keep the middle window three wide when the ends eat into it.
    if (end - start < 2) {
      if (page <= 3) end = Math.min(totalPages - 1, 4);
      else start = Math.max(2, totalPages - 4);
    }
    if (start > 2) list.push('gap');
    for (let current = start; current <= end; current++) list.push(current);
    if (end < totalPages - 1) list.push('gap');
    list.push(totalPages);
    return list;
  }
</script>

<nav class="flex items-center gap-1" aria-label={label}>
  <button
    type="button"
    class="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-surface-0 px-2 text-[11px] text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary disabled:pointer-events-none disabled:opacity-40"
    disabled={page <= 1}
    aria-label="Go to previous page"
    onclick={() => onChange(page - 1)}
  >
    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
  </button>
  {#each pages() as entry, index (index)}
    {#if entry === 'gap'}
      <span class="flex h-7 min-w-7 items-center justify-center text-[11px] text-text-muted" aria-hidden="true">…</span>
    {:else}
      <button
        type="button"
        class="inline-flex h-7 min-w-7 items-center justify-center rounded-md border px-1.5 text-[11px] transition-colors {entry === page
          ? 'border-accent bg-accent text-white'
          : 'border-transparent bg-surface-0 text-text-secondary hover:bg-surface-2 hover:text-text-primary'}"
        aria-current={entry === page ? 'page' : undefined}
        aria-label={`Go to page ${entry}`}
        onclick={() => onChange(entry)}
      >{entry}</button>
    {/if}
  {/each}
  <button
    type="button"
    class="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-surface-0 px-2 text-[11px] text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary disabled:pointer-events-none disabled:opacity-40"
    disabled={page >= totalPages}
    aria-label="Go to next page"
    onclick={() => onChange(page + 1)}
  >
    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>
  </button>
</nav>
