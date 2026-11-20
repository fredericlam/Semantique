<script lang="ts">
  import { iconSvg, type IconName } from "./lib/icons.ts";
  let { name, size = "1.15em", color }: { name: IconName; size?: string; color?: string } = $props();
</script>

<span class="ico" style:--size={size} style:color={color}>{@html iconSvg(name)}</span>

<style>
  .ico { display: inline-flex; width: var(--size); height: var(--size); vertical-align: -0.2em; flex: none; }
  .ico :global(svg) { width: 100%; height: 100%; shape-rendering: crispEdges; }
</style>
