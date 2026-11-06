<script lang="ts">
  import { onMount } from 'svelte';

  type Option = { value: string; label: string };
  let { value, options, placeholder, label, onChange }: {
    value: string;
    options: Option[];
    placeholder: string;
    label: string;
    onChange: (value: string) => void;
  } = $props();

  let open = $state(false);
  let root: HTMLElement;
  let selected = $derived(options.find((option) => option.value === value));

  function choose(next: string) {
    onChange(next);
    open = false;
  }

  onMount(() => {
    const outside = (event: PointerEvent) => {
      if (open && root && !root.contains(event.target as Node)) open = false;
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') open = false;
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  });
</script>

<div class="relative min-w-0" bind:this={root}>
  <button
    type="button"
    class="ui-field flex items-center justify-between gap-2 text-left text-[11px] text-text-secondary"
    aria-label={label}
    aria-haspopup="listbox"
    aria-expanded={open}
    onclick={() => (open = !open)}
  >
    <span class="truncate" class:text-text-primary={!!selected}>{selected?.label ?? placeholder}</span>
    <svg class="shrink-0 text-text-muted transition-transform" class:rotate-180={open} viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5"><path d="m4 6 4 4 4-4" /></svg>
  </button>
  {#if open}
    <div class="absolute left-0 right-0 z-30 mt-1 max-h-64 overflow-auto rounded-lg border border-border bg-surface-1 p-1 shadow-xl shadow-black/25" role="listbox" aria-label={label}>
      <button type="button" role="option" aria-selected={value === ''} class="flex w-full items-center justify-between rounded-md px-2.5 py-2 text-left text-[11px] text-text-secondary hover:bg-surface-3 hover:text-text-primary" onclick={() => choose('')}>
        <span>{placeholder}</span>{#if value === ''}<span class="text-accent">✓</span>{/if}
      </button>
      {#each options as option (option.value)}
        <button type="button" role="option" aria-selected={value === option.value} class="flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left text-[11px] text-text-secondary hover:bg-surface-3 hover:text-text-primary" class:bg-surface-3={value === option.value} onclick={() => choose(option.value)}>
          <span class="truncate">{option.label}</span>{#if value === option.value}<span class="shrink-0 text-accent">✓</span>{/if}
        </button>
      {/each}
    </div>
  {/if}
</div>
