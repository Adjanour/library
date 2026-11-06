<script lang="ts">
  let { title, theme, onToggleTheme, onToggleSidebar, sidebarCollapsed = false, onQuit, onScan, scanning = false }:
    { title: string; theme: 'dark' | 'light'; onToggleTheme: () => void; onToggleSidebar?: () => void; sidebarCollapsed?: boolean; onQuit?: () => void; onScan?: () => void; scanning?: boolean } = $props();
</script>
<header class="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-surface-0/95 px-6 py-4 backdrop-blur">
  <div class="flex items-center gap-2.5">
    {#if onToggleSidebar}
      <button
        class="hidden rounded border border-border p-1.5 text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary md:block"
        title="Toggle sidebar (⌘\)"
        aria-label="Toggle sidebar"
        onclick={onToggleSidebar}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4">
          <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="2.5" />
          <path d={sidebarCollapsed ? 'M4 3v10' : 'M6 3v10'} />
        </svg>
      </button>
    {/if}
    <h1 class="text-lg font-medium tracking-[-0.015em]">{title}</h1>
  </div>
  <div class="flex items-center gap-2">
    <a class="inline-flex h-8 items-center rounded-lg border border-border px-3 text-xs text-text-secondary hover:bg-surface-2" href="/library">⌘K Search</a>
    {#if onScan}
      <button class="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-xs text-text-secondary transition-colors hover:bg-surface-2 disabled:cursor-wait disabled:opacity-60" disabled={scanning} title="Scan library folders" onclick={onScan}>
        <svg class:animate-spin={scanning} width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6" /><path d="M1 20v-6h6" /><path d="M3.5 9a9 9 0 0 1 14.8-3.4L23 10M1 14l4.6 4.4A9 9 0 0 0 20.5 15" /></svg>
        {scanning ? 'Scanning…' : 'Scan library'}
      </button>
    {/if}
    <button class="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border text-xs text-text-secondary transition-colors hover:bg-surface-2" aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`} title="Toggle theme" onclick={onToggleTheme}>{theme === 'dark' ? '☼' : '☾'}</button>
    {#if onQuit}
      <button class="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border text-text-muted transition-colors hover:border-error/60 hover:bg-error/15 hover:text-error" title="Quit Library" aria-label="Quit Library" onclick={onQuit}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <path d="M18.36 6.64a9 9 0 11-12.73 0" /><line x1="12" y1="2" x2="12" y2="12" />
        </svg>
      </button>
    {/if}
  </div>
</header>
