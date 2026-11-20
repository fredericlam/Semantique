import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

export default defineConfig({
  plugins: [svelte()],
  build: {
    rollupOptions: {
      input: { main: "index.html", installer: "installer/index.html" },
    },
  },
  preview: {
    port: 4173,
    proxy: { "/api": { target: "http://localhost:8787", ws: true } },
  },
  server: {
    port: 5173,
    proxy: { "/api": { target: "http://localhost:8787", ws: true } },
  },
});
