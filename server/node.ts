// Local dev server: serves the API from data/out/ files.
import { readFile } from "node:fs/promises";
import { join, normalize } from "node:path";
import { serve } from "@hono/node-server";
import { createApp, type Store } from "./app.ts";

const DATA = join(import.meta.dirname, "..", "data", "out");

const store: Store = {
  async bytes(key) {
    const path = normalize(join(DATA, key));
    if (!path.startsWith(DATA)) return null;
    try {
      return new Uint8Array(await readFile(path));
    } catch {
      return null;
    }
  },
};

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: createApp(store).fetch, port }, () => console.log(`API → http://localhost:${port}/api/fr/meta`));
