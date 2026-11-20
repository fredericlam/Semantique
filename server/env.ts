import type { Room } from "./room.ts";

export interface Env {
  DATA: R2Bucket;
  ROOMS: DurableObjectNamespace<Room>;
  ASSETS: Fetcher;
}
