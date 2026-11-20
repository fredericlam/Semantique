import type { Directory } from "./directory.ts";
import type { Room } from "./room.ts";

export interface Env {
  DATA: R2Bucket;
  ROOMS: DurableObjectNamespace<Room>;
  DIRECTORY: DurableObjectNamespace<Directory>;
  ASSETS: Fetcher;
  GITHUB_REPO?: string; // "owner/name", in wrangler.jsonc vars
  GITHUB_TOKEN?: string; // secret: wrangler secret put GITHUB_TOKEN
}
