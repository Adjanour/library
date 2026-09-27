<script lang="ts">
  import { onMount } from 'svelte';
  import type { AppSettings } from '$lib/api';
  import {
    CONTENT_WIDTHS,
    DEFAULT_READER_PREFERENCES,
    FONT_SIZES,
    LINE_HEIGHTS,
    PDF_ZOOMS,
    loadReaderPreferences,
    saveReaderPreferences,
  } from '$lib/readerPreferences';

  let { settings, onClose, onSave, onSaveReading }: {
    settings: AppSettings;
    onClose: () => void;
    onSave: (directories: string[]) => Promise<void>;
    onSaveReading: (preferences: typeof DEFAULT_READER_PREFERENCES) => Promise<void>;
  } = $props();

  let section = $state<'library' | 'reading' | 'about'>('library');
  let directories = $state<string[]>([]);
  let newDirectory = $state('');
  let saving = $state(false);
  let error = $state('');
  let readingSaved = $state(false);
  let savingReading = $state(false);
  let readerPreferences = $state({ ...DEFAULT_READER_PREFERENCES });

  onMount(() => {
    directories = [...settings.scan_directories];
    readerPreferences = settings.reading_preferences || loadReaderPreferences();
  });

  async function saveReadingPreferences() {
    savingReading = true;
    try {
      await onSaveReading(readerPreferences);
      saveReaderPreferences(readerPreferences);
      readingSaved = true;
    } finally {
      savingReading = false;
    }
  }

  function resetReadingPreferences() {
    readerPreferences = { ...DEFAULT_READER_PREFERENCES };
    readingSaved = false;
  }

  function addDirectory() {
    const path = newDirectory.trim();
    if (!path || directories.includes(path)) return;
    directories = [...directories, path];
    newDirectory = '';
    error = '';
  }

  async function save() {
    if (directories.length === 0) {
      error = 'Keep at least one folder in your library.';
      return;
    }
    saving = true;
    error = '';
    try {
      await onSave(directories);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Could not save settings.';
    } finally {
      saving = false;
    }
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="fixed inset-0 z-50 bg-black/55 backdrop-blur-[2px] flex items-center justify-center p-5" onclick={onClose} onkeydown={(event) => event.key === 'Escape' && onClose()}>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="w-full max-w-3xl h-[min(620px,88vh)] overflow-hidden rounded-2xl border border-border bg-surface-0 shadow-2xl flex" role="dialog" aria-modal="true" aria-label="Settings" tabindex="-1" onclick={(event) => event.stopPropagation()} onkeydown={(event) => { event.stopPropagation(); if (event.key === 'Escape') onClose(); }}>
    <aside class="w-44 shrink-0 border-r border-border bg-surface-1 p-3">
      <div class="px-2 pt-1 pb-4 text-base font-semibold">Settings</div>
      <nav class="space-y-1" aria-label="Settings sections">
        <button class="w-full rounded-lg px-2.5 py-2 text-left text-sm" class:bg-accent={section === 'library'} class:text-white={section === 'library'} class:hover:bg-surface-3={section !== 'library'} onclick={() => section = 'library'}>Library</button>
        <button class="w-full rounded-lg px-2.5 py-2 text-left text-sm" class:bg-accent={section === 'reading'} class:text-white={section === 'reading'} class:hover:bg-surface-3={section !== 'reading'} onclick={() => section = 'reading'}>Reading</button>
        <button class="w-full rounded-lg px-2.5 py-2 text-left text-sm" class:bg-accent={section === 'about'} class:text-white={section === 'about'} class:hover:bg-surface-3={section !== 'about'} onclick={() => section = 'about'}>About</button>
      </nav>
    </aside>

    <section class="min-w-0 flex-1 flex flex-col">
      <header class="h-14 shrink-0 border-b border-border flex items-center px-6">
        <h2 class="text-sm font-semibold capitalize">{section}</h2>
        <div class="flex-1"></div>
        <button class="rounded-lg p-1.5 text-text-muted hover:bg-surface-2 hover:text-text-primary" aria-label="Close settings" onclick={onClose}>✕</button>
      </header>

      <div class="flex-1 overflow-y-auto p-6">
        {#if section === 'library'}
          <div class="max-w-xl">
            <h3 class="text-lg font-semibold">Your library folders</h3>
            <p class="mt-1 text-sm leading-5 text-text-secondary">Library watches these folders recursively for PDFs and ebooks. Changes stay on this device.</p>

            <div class="mt-6 overflow-hidden rounded-xl border border-border bg-surface-1">
              {#each directories as directory, index}
                <div class="flex items-center gap-3 px-4 py-3" class:border-b={index < directories.length - 1} class:border-border={index < directories.length - 1}>
                  <svg class="shrink-0 text-accent" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 6.5h6l2 2h10v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M3 9h18"/></svg>
                  <span class="min-w-0 flex-1 truncate text-sm" title={directory}>{directory}</span>
                  <button class="rounded-md px-2 py-1 text-xs text-text-muted hover:bg-error/15 hover:text-error" aria-label={`Remove ${directory}`} onclick={() => directories = directories.filter((_, i) => i !== index)}>Remove</button>
                </div>
              {/each}
              {#if directories.length === 0}
                <div class="px-4 py-8 text-center text-sm text-text-muted">No folders selected</div>
              {/if}
            </div>

            <form class="mt-3 flex gap-2" onsubmit={(event) => { event.preventDefault(); addDirectory(); }}>
              <input class="min-w-0 flex-1 rounded-lg border border-border bg-surface-1 px-3 py-2 text-sm outline-none focus:border-accent" bind:value={newDirectory} placeholder={settings.platform === 'windows' ? 'C:\\Users\\you\\Books' : '/Users/you/Books'} aria-label="Folder path" />
              <button class="rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm hover:bg-surface-3" type="submit">Add folder</button>
            </form>
            <p class="mt-2 text-xs text-text-muted">Folder picker support will arrive with the signed macOS and Windows shells; paths are validated before saving.</p>
          </div>
        {:else if section === 'reading'}
          <div class="max-w-xl">
            <h3 class="text-lg font-semibold">Reading preferences</h3>
            <p class="mt-1 text-sm leading-5 text-text-secondary">Set the defaults used whenever a PDF or EPUB opens. EPUB controls remain available inside the reader for quick adjustments.</p>
            <div class="mt-6 grid grid-cols-[1fr_180px] items-center gap-x-8 gap-y-4 rounded-xl border border-border bg-surface-1 p-5 text-sm">
              <label for="reader-font">Typeface</label>
              <select id="reader-font" class="rounded-lg border border-border bg-surface-2 px-3 py-2" bind:value={readerPreferences.fontFamily}>
                <option value="default">IBM Plex Serif</option><option value="sans">IBM Plex Sans</option><option value="serif">Serif</option><option value="mono">Monospace</option>
              </select>
              <label for="reader-size">EPUB text size</label>
              <select id="reader-size" class="rounded-lg border border-border bg-surface-2 px-3 py-2" bind:value={readerPreferences.fontSize}>
                {#each FONT_SIZES as value}<option value={value}>{value}%</option>{/each}
              </select>
              <label for="reader-line">Line spacing</label>
              <select id="reader-line" class="rounded-lg border border-border bg-surface-2 px-3 py-2" bind:value={readerPreferences.lineHeight}>
                {#each LINE_HEIGHTS as value}<option value={value}>{value}</option>{/each}
              </select>
              <label for="reader-width">Text column</label>
              <select id="reader-width" class="rounded-lg border border-border bg-surface-2 px-3 py-2" bind:value={readerPreferences.contentWidth}>
                {#each CONTENT_WIDTHS as value}<option value={value}>{value}px</option>{/each}
              </select>
              <label for="reader-theme">EPUB theme</label>
              <select id="reader-theme" class="rounded-lg border border-border bg-surface-2 px-3 py-2 capitalize" bind:value={readerPreferences.theme}>
                <option value="light">Light</option><option value="sepia">Sepia</option><option value="dark">Dark</option><option value="black">Black</option>
              </select>
              <label for="reader-flow">Page flow</label>
              <select id="reader-flow" class="rounded-lg border border-border bg-surface-2 px-3 py-2" bind:value={readerPreferences.flow}>
                <option value="paginated">Paginated</option><option value="scrolled">Continuous scroll</option>
              </select>
              <label for="reader-spread">Page spread</label>
              <select id="reader-spread" class="rounded-lg border border-border bg-surface-2 px-3 py-2" bind:value={readerPreferences.spread}>
                <option value="none">Single page</option><option value="both">Two pages</option>
              </select>
              <label for="pdf-zoom">PDF zoom</label>
              <select id="pdf-zoom" class="rounded-lg border border-border bg-surface-2 px-3 py-2" bind:value={readerPreferences.pdfZoom}>
                {#each PDF_ZOOMS as value}<option value={value}>{value}%</option>{/each}
              </select>
            </div>
          </div>
        {:else}
          <div class="max-w-xl">
            <h3 class="text-lg font-semibold">Library</h3>
            <p class="mt-1 text-sm text-text-secondary">A private, local-first home for books and papers.</p>
            <div class="mt-6 grid grid-cols-[110px_1fr] gap-y-3 text-sm">
              <span class="text-text-muted">Version</span><span>{settings.version}</span>
              <span class="text-text-muted">Platform</span><span class="capitalize">{settings.platform}</span>
              <span class="text-text-muted">Storage</span><span>On this device</span>
            </div>
          </div>
        {/if}
      </div>

      {#if section === 'library'}
        <footer class="min-h-16 shrink-0 border-t border-border px-6 py-3 flex items-center gap-3">
          {#if error}<p class="min-w-0 flex-1 text-xs text-error">{error}</p>{:else}<div class="flex-1"></div>{/if}
          <button class="rounded-lg px-3 py-2 text-sm text-text-secondary hover:bg-surface-2" onclick={onClose}>Cancel</button>
          <button class="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50" disabled={saving} onclick={save}>{saving ? 'Saving…' : 'Save & rescan'}</button>
        </footer>
      {:else if section === 'reading'}
        <footer class="min-h-16 shrink-0 border-t border-border px-6 py-3 flex items-center gap-3">
          <div class="flex-1 text-xs text-success">{readingSaved ? 'Reading defaults saved.' : ''}</div>
          <button class="rounded-lg px-3 py-2 text-sm text-text-secondary hover:bg-surface-2" onclick={resetReadingPreferences}>Reset defaults</button>
          <button class="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50" disabled={savingReading} onclick={saveReadingPreferences}>{savingReading ? 'Saving…' : 'Save preferences'}</button>
        </footer>
      {/if}
    </section>
  </div>
</div>
