<script lang="ts">
  import { onMount } from 'svelte';
  import { fade, fly } from 'svelte/transition';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { api } from '$lib/api';
import { reducedMotion } from '$lib/motion';
  import { toast } from '$lib/toast.svelte';
  import AppSidebar from './AppSidebar.svelte';
  import CommandPalette from './CommandPalette.svelte';
  import SurfaceHeader from './SurfaceHeader.svelte';
  let { title = 'Library', children } = $props<{ title?: string; children: () => unknown }>();
  let showPalette = $state(false);
  let isMac = $state(true);
  let sidebarWidth = $state(256);
  let sidebarCollapsed = $state(false);
  let resizing = $state(false);
  let theme = $state<'dark' | 'light'>('light');
  let scanning = $state(false);
  const navigate = (path: string) => { void goto(path); };
  /** The desktop shell does not reliably exit with its window, so quit is explicit. */
  function quitApp() { void api.quit().catch(() => { /* the server stops before answering on some runtimes */ }); }
  async function scanLibrary() {
    if (scanning) return;
    scanning = true;
    try {
      const result = await api.scan();
      toast(`Scan complete · ${result.indexed} catalog items updated`);
      window.location.reload();
    } catch {
      scanning = false;
      toast('Scan failed. Check Diagnostics for details.');
    }
  }
  const commands = $derived([
    { id: 'continue', label: 'Continue Reading', hint: 'Open your active reading', shortcut: isMac ? '⌘J' : 'Ctrl J', run: () => navigate('/continue') },
    { id: 'queue', label: 'Open Queue', hint: 'Review and reorder what comes next', shortcut: isMac ? '⌘Q' : 'Ctrl Q', run: () => navigate('/queue') },
    { id: 'library', label: 'All Library', hint: 'Search every item', run: () => navigate('/library') },
    { id: 'settings', label: 'Settings', hint: 'Library and reader preferences', shortcut: isMac ? '⌘,' : 'Ctrl ,', run: () => navigate('/settings') },
    { id: 'shortcuts', label: 'Keyboard shortcuts', hint: 'Show the interaction grammar', shortcut: isMac ? '⌘/' : 'Ctrl /', run: () => navigate('/shortcuts') },
    { id: 'quit', label: 'Quit Library', hint: 'Close and save all state', run: quitApp }
  ]);
  function handleKeydown(event: KeyboardEvent) {
    const target = event.target as HTMLElement | null;
    if (target?.matches('input, textarea, select, [contenteditable="true"]')) return;
    const modifier = event.metaKey || event.ctrlKey;
    if (modifier && event.key.toLowerCase() === 'k') { event.preventDefault(); showPalette = true; }
    else if (modifier && event.key.toLowerCase() === 'j') { event.preventDefault(); navigate('/continue'); }
    else if (modifier && event.key.toLowerCase() === 'q') { event.preventDefault(); navigate('/queue'); }
    else if (modifier && event.key === ',') { event.preventDefault(); navigate('/settings'); }
    else if (modifier && event.key === '/') { event.preventDefault(); navigate('/shortcuts'); }
    else if (modifier && event.key === '\\') { event.preventDefault(); toggleSidebar(); }
    else if (event.key === 'Escape' && showPalette) showPalette = false;
  }
  function toggleTheme() {
    theme = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('library-theme', theme);
  }
  function toggleSidebar() {
    sidebarCollapsed = !sidebarCollapsed;
    localStorage.setItem('library-sidebar-collapsed', sidebarCollapsed ? '1' : '');
  }
  function startResize(event: PointerEvent) {
    event.preventDefault();
    resizing = true;
    const startX = event.clientX;
    const startWidth = sidebarWidth;
    const move = (moveEvent: PointerEvent) => { sidebarWidth = Math.max(200, Math.min(420, startWidth + moveEvent.clientX - startX)); };
    const stop = () => {
      resizing = false;
      localStorage.setItem('library-sidebar-width', String(sidebarWidth));
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop, { once: true });
  }
  onMount(() => {
    isMac = /Mac|iPhone|iPad/.test(navigator.platform);
    sidebarWidth = Number(localStorage.getItem('library-sidebar-width')) || 256;
    sidebarCollapsed = localStorage.getItem('library-sidebar-collapsed') === '1';
    const savedTheme = localStorage.getItem('library-theme');
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    theme = savedTheme === 'dark' || savedTheme === 'light'
      ? savedTheme
      : (media.matches ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', theme);
    const syncSystemTheme = (event: MediaQueryListEvent) => {
      if (localStorage.getItem('library-theme')) return;
      theme = event.matches ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', theme);
    };
    media.addEventListener('change', syncSystemTheme);
    window.addEventListener('keydown', handleKeydown);
    return () => {
      media.removeEventListener('change', syncSystemTheme);
      window.removeEventListener('keydown', handleKeydown);
    };
  });
</script>

<div class="flex h-screen bg-surface-0 text-text-primary">
  <div
    class="hidden shrink-0 overflow-hidden transition-[width] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] md:block"
    style:width={sidebarCollapsed ? '0px' : `${sidebarWidth}px`}
  >
    <div class="h-full" style:width={`${sidebarWidth}px`}>
      <AppSidebar />
    </div>
  </div>
  {#if !sidebarCollapsed}
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <div class="hidden w-1 shrink-0 cursor-col-resize border-r border-border bg-surface-1 transition-colors hover:bg-accent/50 md:block" class:bg-accent={resizing} role="separator" aria-label="Resize sidebar" aria-valuemin="200" aria-valuemax="420" aria-valuenow={sidebarWidth} tabindex="0" onpointerdown={startResize} onkeydown={(event) => { if (event.key === 'ArrowLeft') sidebarWidth = Math.max(200, sidebarWidth - 16); if (event.key === 'ArrowRight') sidebarWidth = Math.min(420, sidebarWidth + 16); }}></div>
  {/if}
  <main class="min-w-0 flex-1 overflow-hidden">
    <!-- Old and new pages share one grid cell so the exit fades in place
         while the entrance rises over it. The shell never
         scrolls: each page owns exactly one scroll region. -->
    <div class="grid h-full min-h-0">
      {#key page.url.pathname}
        <div
          class="flex h-full min-h-0 flex-col [grid-area:1/1]"
          in:fly={{ y: 12, duration: reducedMotion() ? 0 : 260 }}
          out:fade={{ duration: reducedMotion() ? 0 : 120 }}
        >
          <SurfaceHeader {title} {theme} {sidebarCollapsed} {scanning} onToggleTheme={toggleTheme} onToggleSidebar={toggleSidebar} onScan={scanLibrary} onQuit={quitApp} />
          {#if page.url.pathname.startsWith('/library')}
            <!-- The catalog lays itself out: filters stay put, only the list scrolls. -->
            <div class="min-h-0 flex-1 overflow-hidden">{@render children()}</div>
          {:else}
            <div class="min-h-0 flex-1 overflow-y-auto"><div class="mx-auto max-w-6xl p-6">{@render children()}</div></div>
          {/if}
        </div>
      {/key}
    </div>
  </main>
</div>
{#if showPalette}<CommandPalette commands={commands} onClose={() => (showPalette = false)} />{/if}
