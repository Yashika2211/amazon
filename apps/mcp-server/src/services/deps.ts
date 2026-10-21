import type { Config } from "../config.js";
import type { Store } from "../store/store.js";
import type { Table } from "../store/table.js";
import type { Clock } from "./clock.js";
import type { DigestTrigger, DigestWriter } from "./digest.js";
import type { Notifier } from "./notifier.js";

/** Everything the app needs, injected so tests and local runs swap AWS for in-memory fakes. */
export interface Deps {
  config: Config;
  table: Table;
  store: Store;
  clock: Clock;
  notifier: Notifier;
  digest: DigestTrigger;
  digestWriter: DigestWriter;
}
