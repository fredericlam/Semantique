<script lang="ts" module>
  // Phosphor Icons (MIT) — only the few we use, inlined so they inherit currentColor.
  import usersThree from "@phosphor-icons/core/assets/duotone/users-three-duotone.svg?raw";
  import lightbulb from "@phosphor-icons/core/assets/duotone/lightbulb-filament-duotone.svg?raw";
  import arrowRight from "@phosphor-icons/core/assets/bold/arrow-right-bold.svg?raw";
  import arrowLeft from "@phosphor-icons/core/assets/bold/arrow-left-bold.svg?raw";
  import backpack from "@phosphor-icons/core/assets/duotone/backpack-duotone.svg?raw";
  import headphones from "@phosphor-icons/core/assets/duotone/headphones-duotone.svg?raw";
  import coffee from "@phosphor-icons/core/assets/duotone/coffee-duotone.svg?raw";
  import circleHalf from "@phosphor-icons/core/assets/duotone/circle-half-duotone.svg?raw";
  import sun from "@phosphor-icons/core/assets/duotone/sun-duotone.svg?raw";
  import moon from "@phosphor-icons/core/assets/duotone/moon-stars-duotone.svg?raw";
  import reload from "@phosphor-icons/core/assets/bold/arrow-clockwise-bold.svg?raw";

  const ICONS = {
    users: usersThree, lightbulb, "arrow-right": arrowRight, "arrow-left": arrowLeft,
    backpack, headphones, coffee, "circle-half": circleHalf, sun, moon, reload,
  } as const;
  export type IconName = keyof typeof ICONS;
</script>

<script lang="ts">
  let { name, size = "1.2em" }: { name: IconName; size?: string } = $props();
</script>

<span class="ico" style:--size={size} aria-hidden="true">{@html ICONS[name]}</span>

<style>
  .ico { display: inline-flex; width: var(--size); height: var(--size); vertical-align: -0.2em; flex: none; }
  .ico :global(svg) { width: 100%; height: 100%; }
</style>
