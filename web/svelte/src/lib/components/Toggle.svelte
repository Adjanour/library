<script lang="ts">
  /** Switch-style toggle, styled after shadcn's Switch. */
  let { checked, onChange, label }: {
    checked: boolean;
    onChange: (next: boolean) => void;
    label: string;
  } = $props();
</script>

<button
  type="button"
  role="switch"
  aria-checked={checked}
  class="group inline-flex items-center gap-2 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-0"
  onclick={() => onChange(!checked)}
>
  <span
    class="relative inline-flex h-4.5 w-8 shrink-0 rounded-full border border-border transition-colors duration-200 {checked
      ? 'border-accent bg-accent'
      : 'bg-surface-3 group-hover:bg-surface-3/80'}"
    aria-hidden="true"
  >
    <span
      class="pointer-events-none absolute left-[3px] top-1/2 block h-3 w-3 -translate-y-1/2 rounded-full bg-white shadow transition-transform duration-200 {checked
        ? 'translate-x-[14px]'
        : 'translate-x-0'}"
    ></span>
  </span>
  <span class="text-[11px] text-text-secondary group-hover:text-text-primary">{label}</span>
</button>
