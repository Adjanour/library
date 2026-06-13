<script lang="ts">
  import '../app.css';
  let { children } = $props();
</script>

<div class="flex flex-col h-screen bg-surface-0">
  {@render children()}
</div>
