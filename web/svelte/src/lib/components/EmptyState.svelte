<script lang="ts">
  let { title, message, actionHref = '/library', actionLabel = 'Browse library' }: { title: string; message: string; actionHref?: string; actionLabel?: string } = $props();
</script>
<section class="rounded-xl border border-dashed border-border bg-surface-1 p-12 text-center">
  <h2 class="text-base font-medium tracking-[-0.01em]">{title}</h2>
  <p class="mx-auto mt-2 max-w-md text-sm text-text-secondary">{message}</p>
  <a class="mt-6 inline-block rounded bg-accent px-4 py-2 text-sm text-white" href={actionHref}>{actionLabel}</a>
</section>
