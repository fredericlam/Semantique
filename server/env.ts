import type { Directory } from "./directory.ts";
import type { Room } from "./room.ts";

export interface Env {
  DATA: R2Bucket;
  ROOMS: DurableObjectNamespace<Room>;
  DIRECTORY: DurableObjectNamespace<Directory>;
  ASSETS: Fetcher;
}
