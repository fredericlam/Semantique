/** Register the service worker in production builds only (it would fight Vite's dev server). */
export function registerSW(): void {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
}

export const isStandalone = (): boolean =>
  matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
