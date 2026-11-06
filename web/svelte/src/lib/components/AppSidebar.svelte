<script lang="ts">
  import { page } from '$app/state';
  import { fly } from 'svelte/transition';
  import { firstAppPaint, reducedMotion } from '$lib/motion';

  type Link = { href: string; label: string; hint?: string; group: 'main' | 'meta' };

  const items: Link[] = [
    { href: '/', label: 'Dashboard', group: 'main' },
    { href: '/continue', label: 'Continue Reading', group: 'main' },
    { href: '/queue', label: 'Queue', group: 'main' },
    { href: '/recent', label: 'Recent', group: 'main' },
    { href: '/collections', label: 'Collections', group: 'main' },
    { href: '/library', label: 'All Library', group: 'main' },
    { href: '/review', label: 'Metadata Review', group: 'main' },
    { href: '/settings', label: 'Settings', hint: '⌘,', group: 'meta' },
    { href: '/diagnostics', label: 'Diagnostics', group: 'meta' },
    { href: '/shortcuts', label: 'Shortcuts', hint: '⌘/', group: 'meta' }
  ];

  let refs: HTMLAnchorElement[] = [];
  let highlight = $state({ top: 0, height: 0, visible: false });

  const activeIndex = $derived(items.findIndex((item) => item.href === page.url.pathname));

  // Entrance cascade plays once per session, on the first app paint.
  const playIntro = firstAppPaint() && !reducedMotion();
  function intro(index: number) {
    return playIntro ? { x: -8, duration: 200, delay: 100 + index * 25 } : {};
  }

  const highlightStrength = 'cubic-bezier(0.32, 0.72, 0, 1)';

  function measure() {
    const element = refs[activeIndex];
    // The capture must not read-then-write the same $state in one effect run
    // except through a no-op second pass, or the update depth explodes on
    // routes with no active item (e.g. the boot redirect at "/").
    if (element) {
      const top = element.offsetTop;
      const height = element.offsetHeight;
      if (highlight.top !== top || highlight.height !== height || !highlight.visible) {
        highlight = { top, height, visible: true };
      }
    } else if (highlight.visible) {
      highlight = { top: highlight.top, height: highlight.height, visible: false };
    }
  }

  // Re-measure whenever the active link changes, after every link exists.
  $effect(() => {
    for (const _ of refs) void _;
    void activeIndex;
    measure();
  });

  function ref(index: number) {
    return (node: HTMLAnchorElement) => { refs[index] = node; };
  }
</script>

<aside class="flex h-full flex-col border-border bg-surface-1 p-4">
  <a class="mb-6 block text-base font-semibold tracking-[-0.01em]" href="/continue">Library</a>
  <nav class="relative" aria-label="Primary navigation">
    <div
      class="sidebar-highlight"
      class:on={highlight.visible}
      style:top={`${highlight.top}px`}
      style:height={`${highlight.height}px`}
      style:transition-timing-function={highlightStrength}
    ></div>
    {#each items as item, index (item.href)}
      {#if item.group === 'meta' && items[index - 1]?.group === 'main'}<div class="my-2 h-px bg-border"></div>{/if}
      <a
        use:ref(index)
        class="block rounded-md px-3 py-2 text-xs text-text-secondary transition-colors hover:text-text-primary"
        class:selected={activeIndex === index}
        in:fly={intro(index)}
        href={item.href}
      >{item.label}{#if item.hint}<span class="float-right"><kbd>{item.hint}</kbd></span>{/if}</a>
    {/each}
  </nav>
  <div class="mt-auto border-t border-border pt-3 text-[11px] text-text-muted">
    <p class="mt-1.5 flex items-center gap-2"><kbd>⌘K</kbd> search &amp; commands</p>
    <p class="mt-1 flex items-center gap-2"><kbd>⌘\</kbd> toggle sidebar</p>
  </div>
</aside>

<style>
  .sidebar-highlight {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    border-radius: 6px;
    background: var(--surface-3);
    opacity: 0;
    transition:
      top 220ms,
      height 220ms,
      opacity 160ms;
    pointer-events: none;
  }
  .sidebar-highlight.on { opacity: 1; }
  a.selected { color: var(--text-primary); z-index: 1; position: relative; }
  kbd {
    font: inherit;
    font-size: 10px;
    padding: 1px 4px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--surface-2);
    color: var(--text-secondary);
  }
</style>
