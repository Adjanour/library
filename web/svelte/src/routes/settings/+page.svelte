<script lang="ts">
  import SettingsPanel from '$lib/components/SettingsPanel.svelte';
  import { onMount } from 'svelte';
  import { api, type AppSettings } from '$lib/api';
  import { toast } from '$lib/toast.svelte';

  let settings = $state<AppSettings | null>(null);
  onMount(async () => settings = await api.settings());

  async function save(directories: string[], pageSize: number) {
    settings = await api.updateSettings({ scan_directories: directories, catalog_page_size: pageSize });
    await api.scan();
    toast('Settings saved and library rescanned');
  }
</script>

{#if settings}
  <SettingsPanel {settings} embedded onSave={save} onSaveReading={async (prefs: Parameters<typeof api.updateReadingPreferences>[0]) => { await api.updateReadingPreferences(prefs); toast('Reading preferences saved'); }} />
{:else}
  <p class="text-text-secondary">Loading settings…</p>
{/if}
