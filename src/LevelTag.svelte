<script lang="ts">
  import Icon from "./Icon.svelte";
  import { LEVEL_INFO } from "./lib/game.ts";
  let { level, size = "1.15em" }: { level: string; size?: string } = $props();
  const info = $derived(LEVEL_INFO[level]);
</script>

<span class="lt">{#if info}<Icon name={info.icon} {size} />{/if}{info?.label ?? level}</span>

<style>
  .lt { display: inline-flex; align-items: center; gap: 0.3em; white-space: nowrap; }
</style>
