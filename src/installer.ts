import { renderSVG } from "uqr";
import "./app.css";
import "./installer.css";
import { registerSW } from "./lib/pwa.ts";

type Platform = "ios" | "android" | "desktop";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const ua = navigator.userAgent;
const isIOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isAndroid = /Android/.test(ua);
const isStandalone = matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
const detected: Platform = isIOS ? "ios" : isAndroid ? "android" : "desktop";

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

function show(p: Platform) {
  document.querySelectorAll<HTMLElement>("[data-panel]").forEach((el) => (el.hidden = el.dataset.panel !== p));
  document.querySelectorAll<HTMLButtonElement>("#picker button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.p === p)));
}

document.querySelectorAll<HTMLButtonElement>("#picker button").forEach((b) => (b.onclick = () => show(b.dataset.p as Platform)));

if (isStandalone) {
  $("#installed").hidden = false;
  $("#picker").hidden = true;
} else {
  show(detected);
}

// iOS outside Safari
if (isIOS && /CriOS|FxiOS|EdgiOS|OPiOS|GSA|Instagram|FBAN|FBAV/.test(ua)) $("#ios-other").hidden = false;

// QR code pointing at the game, for desktop visitors
const target = location.origin + "/installer/";
$("#qr").innerHTML = renderSVG(target, { border: 1, pixelSize: 6, whiteColor: "#fff6ee", blackColor: "#2a1440" });
$("#url").textContent = target.replace(/^https?:\/\//, "");

// Chromium (Android, desktop): native install prompt
let deferred: BeforeInstallPromptEvent | null = null;
addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferred = e as BeforeInstallPromptEvent;
  $("#install-btn").hidden = false;
  $("#install-btn-desktop").hidden = false;
  $("#android-steps").classList.add("secondary");
});

async function promptInstall() {
  if (!deferred) return;
  await deferred.prompt();
  const { outcome } = await deferred.userChoice;
  deferred = null;
  if (outcome === "accepted") {
    $("#install-btn").hidden = true;
    $("#install-btn-desktop").hidden = true;
  }
}
$("#install-btn").onclick = promptInstall;
$("#install-btn-desktop").onclick = promptInstall;

addEventListener("appinstalled", () => {
  $("#installed").hidden = false;
  $("#picker").hidden = true;
  document.querySelectorAll<HTMLElement>("[data-panel]").forEach((el) => (el.hidden = true));
});

registerSW();
