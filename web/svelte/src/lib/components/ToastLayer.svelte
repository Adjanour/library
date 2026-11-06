<script lang="ts">
  import { fly } from 'svelte/transition';
  import { reducedMotion } from '$lib/motion';
  import { toasts } from '$lib/toast.svelte';
</script>

<div class="pointer-events-none fixed inset-x-0 bottom-7 z-30 flex flex-col items-center gap-1.5" aria-live="polite">
  {#each toasts as t (t.id)}
    <div
      class="pointer-events-none rounded-[10px] bg-text-primary px-3.5 py-2 text-[13px] text-surface-0 shadow-lg shadow-black/25"
      in:fly={{ y: 14, duration: reducedMotion() ? 0 : 200 }}
      out:fly={{ y: 8, duration: reducedMotion() ? 0 : 140 }}
      role="status"
    >{t.message}</div>
  {/each}
</div>
