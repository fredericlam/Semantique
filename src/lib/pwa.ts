/** Register the service worker in production builds only (it would fight Vite's dev server). */
export function registerSW(): void {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
}

/** Reload the page, after asking the service worker to fetch a newer version of the app if any. */
export async function hardReload(): Promise<void> {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    await reg?.update();
  } catch {}
  location.reload();
}

export const isStandalone = (): boolean =>
  matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
