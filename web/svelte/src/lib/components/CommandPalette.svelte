<script lang="ts">
  import { onMount } from 'svelte';

  type Command = { id: string; label: string; hint: string; shortcut?: string; run: () => void };
  let { commands, onClose }: { commands: Command[]; onClose: () => void } = $props();
  let query = $state('');
  let active = $state(0);
  let input: HTMLInputElement;

  let filtered = $derived(commands.filter((command) =>
    `${command.label} ${command.hint}`.toLowerCase().includes(query.toLowerCase().trim()),
  ));

  function execute(command: Command | undefined) {
    if (!command) return;
    command.run();
    onClose();
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') { event.preventDefault(); onClose(); }
    else if (event.key === 'ArrowDown') { event.preventDefault(); active = Math.min(active + 1, filtered.length - 1); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); active = Math.max(active - 1, 0); }
    else if (event.key === 'Enter') { event.preventDefault(); execute(filtered[active]); }
  }

  $effect(() => { query; active = 0; });
  onMount(() => input?.focus());
</script>

<div class="fixed inset-0 z-50 bg-black/45 backdrop-blur-[2px] p-[12vh_1rem]" role="presentation" onclick={onClose}>
  <!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role a11y_click_events_have_key_events -->
  <div class="mx-auto max-w-xl overflow-hidden rounded-xl border border-border bg-surface-1 shadow-2xl" role="dialog" aria-modal="true" aria-label="Command palette" tabindex="-1" onclick={(event) => event.stopPropagation()} onkeydown={(event) => event.stopPropagation()}>
    <div class="flex items-center gap-3 border-b border-border px-4 py-3">
      <span class="text-accent text-lg">⌘</span>
      <input bind:this={input} bind:value={query} onkeydown={onKeydown} class="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-text-muted" placeholder="Jump to an action…" aria-label="Search commands" />
      <kbd class="rounded border border-border bg-surface-2 px-1.5 py-0.5 text-[10px] text-text-muted">Esc</kbd>
    </div>
    <div class="max-h-[52vh] overflow-y-auto p-2">
      {#if filtered.length === 0}
        <div class="px-3 py-8 text-center text-xs text-text-muted">No matching commands</div>
      {:else}
        {#each filtered as command, index (command.id)}
          <button class="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors focus-visible:bg-surface-3 focus-visible:outline-none" class:bg-surface-2={active === index} onclick={() => execute(command)} onmouseenter={() => (active = index)}>
            <span class="min-w-0 flex-1"><span class="block text-sm text-text-primary">{command.label}</span><span class="block text-[10px] text-text-muted">{command.hint}</span></span>
            {#if command.shortcut}<kbd class="rounded border border-border bg-surface-2 px-1.5 py-0.5 text-[10px] text-text-muted">{command.shortcut}</kbd>{/if}
          </button>
        {/each}
      {/if}
    </div>
  </div>
</div>
