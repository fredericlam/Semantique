// Pixelarticons (MIT) — only the icons we use, inlined as raw SVG so they inherit currentColor.
import target from "pixelarticons/svg/target.svg?raw";
import fire from "pixelarticons/svg/fire.svg?raw";
import sunSolid from "pixelarticons/svg/sun-solid.svg?raw";
import sun from "pixelarticons/svg/sun.svg?raw";
import cloudSun from "pixelarticons/svg/cloud-sun.svg?raw";
import waves from "pixelarticons/svg/waves.svg?raw";
import snowflake from "pixelarticons/svg/snowflake.svg?raw";
import lightbulb from "pixelarticons/svg/lightbulb.svg?raw";
import chart from "pixelarticons/svg/chart-bar-big.svg?raw";
import question from "pixelarticons/svg/circle-question.svg?raw";
import smartphone from "pixelarticons/svg/smartphone.svg?raw";
import clock from "pixelarticons/svg/clock.svg?raw";
import share from "pixelarticons/svg/share.svg?raw";
import flag from "pixelarticons/svg/flag.svg?raw";
import zap from "pixelarticons/svg/zap.svg?raw";
import lock from "pixelarticons/svg/lock.svg?raw";
import download from "pixelarticons/svg/download.svg?raw";
import laptop from "pixelarticons/svg/laptop.svg?raw";
import check from "pixelarticons/svg/check.svg?raw";
import arrowRight from "pixelarticons/svg/arrow-right.svg?raw";
import trophy from "pixelarticons/svg/trophy.svg?raw";
import gamepad from "pixelarticons/svg/gamepad.svg?raw";
import moon from "pixelarticons/svg/moon.svg?raw";
import sparkles from "pixelarticons/svg/sparkles.svg?raw";

export const ICONS = {
  target, fire, "sun-solid": sunSolid, sun, "cloud-sun": cloudSun, waves, snowflake,
  lightbulb, chart, question, smartphone, clock, share, flag, zap, lock, download, laptop,
  check, "arrow-right": arrowRight, trophy, gamepad, moon, sparkles,
} as const;

export type IconName = keyof typeof ICONS;

/** SVG markup sized by CSS (1em by default), pixel-crisp. */
export function iconSvg(name: IconName, cls = "px-icon"): string {
  return ICONS[name]
    .replace(/\s(width|height)="24"/g, "")
    .replace("<svg ", `<svg class="${cls}" aria-hidden="true" focusable="false" `);
}
