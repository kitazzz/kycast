import { createQuery } from "./query.js";
import { createTable } from "./table.js";
import type { KyselyDb } from "./types.js";

export function kycast<DB>(db: KyselyDb<DB>) {
  return {
    query: createQuery(db),
    table: createTable(db),
  };
}
