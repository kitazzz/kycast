import Database from "better-sqlite3";
import { Kysely, SqliteDialect, sql } from "kysely";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { kycast } from "./kycast.js";
import { kycastLogger } from "./logger.js";
import type { KycastLogEvent } from "./logger.js";

interface Order {
  id: string;
  status: string;
  amount: number;
  createdAt: string;
}

interface DB {
  orders: Order;
}

let db: Kysely<DB>;
const logs: KycastLogEvent[] = [];

beforeEach(async () => {
  db = new Kysely<DB>({
    dialect: new SqliteDialect({ database: new Database(":memory:") }),
    log: kycastLogger((event) => logs.push(event)),
  });
  await sql`
    CREATE TABLE orders (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      amount INTEGER NOT NULL,
      createdAt TEXT NOT NULL
    )
  `.execute(db);
  await db
    .insertInto("orders")
    .values({ id: "1", status: "PENDING", amount: 100, createdAt: "2024-01-01" })
    .execute();
  // セットアップクエリのログをリセット
  logs.length = 0;
});

afterEach(async () => {
  await db.destroy();
});

describe("kycastLogger()", () => {
  it("cast.table() のクエリが記録される", async () => {
    const cast = kycast(db);
    await cast.table("orders")(({ getOrThrow }) => getOrThrow("1"));

    expect(logs).toHaveLength(1);
    expect(logs[0].sql).toContain("orders");
    expect(logs[0].parameters).toContain("1");
    expect(logs[0].durationMs).toBeGreaterThanOrEqual(0);
  });

  it("cast.query() のクエリが記録される", async () => {
    const cast = kycast(db);
    await cast.query(({ selectFrom }) =>
      selectFrom("orders").selectAll().where("status", "=", "PENDING").execute()
    );

    expect(logs).toHaveLength(1);
    expect(logs[0].sql).toContain("orders");
    expect(logs[0].parameters).toContain("PENDING");
  });

  it("複数クエリはそれぞれ記録される", async () => {
    const cast = kycast(db);
    await cast.table("orders")(({ get }) => get("1"));
    await cast.table("orders")(({ get }) => get("2"));

    expect(logs).toHaveLength(2);
  });

  it("デフォルトロガーは JSON を console.log に出力する", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const defaultDb = new Kysely<DB>({
      dialect: new SqliteDialect({ database: new Database(":memory:") }),
      log: kycastLogger(),
    });
    await sql`CREATE TABLE orders (id TEXT PRIMARY KEY, status TEXT NOT NULL, amount INTEGER NOT NULL, createdAt TEXT NOT NULL)`.execute(defaultDb);
    await defaultDb.selectFrom("orders").selectAll().execute();

    expect(consoleSpy).toHaveBeenCalled();
    const output = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(output.kycast).toBe(true);
    expect(output.sql).toBeDefined();
    expect(output.parameters).toBeDefined();
    expect(output.durationMs).toBeDefined();

    consoleSpy.mockRestore();
    await defaultDb.destroy();
  });
});
