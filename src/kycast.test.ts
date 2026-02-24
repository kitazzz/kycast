import Database from "better-sqlite3";
import { Kysely, SqliteDialect, sql } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { kycast } from "./kycast.js";

// --- テスト用スキーマ ---

interface Order {
  id: string;
  status: string;
  amount: number;
  createdAt: string;
}

interface DB {
  orders: Order;
}

// --- ヘルパー ---

function createTestDb(): Kysely<DB> {
  return new Kysely<DB>({
    dialect: new SqliteDialect({ database: new Database(":memory:") }),
  });
}

async function setupSchema(db: Kysely<DB>) {
  await sql`
    CREATE TABLE orders (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      amount INTEGER NOT NULL,
      createdAt TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `.execute(db);
}

// --- テスト ---

let db: Kysely<DB>;

beforeEach(async () => {
  db = createTestDb();
  await setupSchema(db);
});

afterEach(async () => {
  await db.destroy();
});

describe("cast.query()", () => {
  it("selectFrom でレコードを取得できる", async () => {
    await db
      .insertInto("orders")
      .values({ id: "1", status: "PENDING", amount: 100, createdAt: "2024-01-01" })
      .execute();

    const cast = kycast(db);
    const rows = await cast.query(({ selectFrom }) =>
      selectFrom("orders").selectAll().execute()
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("1");
  });

  it("insertInto でレコードを挿入できる", async () => {
    const cast = kycast(db);
    await cast.query(({ insertInto }) =>
      insertInto("orders")
        .values({ id: "2", status: "PENDING", amount: 200, createdAt: "2024-01-01" })
        .execute()
    );
    const rows = await db.selectFrom("orders").selectAll().execute();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("2");
  });

  it("updateTable でレコードを更新できる", async () => {
    await db
      .insertInto("orders")
      .values({ id: "1", status: "PENDING", amount: 100, createdAt: "2024-01-01" })
      .execute();

    const cast = kycast(db);
    await cast.query(({ updateTable }) =>
      updateTable("orders").set({ status: "DONE" }).where("id", "=", "1").execute()
    );
    const row = await db.selectFrom("orders").selectAll().where("id", "=", "1").executeTakeFirst();
    expect(row?.status).toBe("DONE");
  });

  it("deleteFrom でレコードを削除できる", async () => {
    await db
      .insertInto("orders")
      .values({ id: "1", status: "PENDING", amount: 100, createdAt: "2024-01-01" })
      .execute();

    const cast = kycast(db);
    await cast.query(({ deleteFrom }) =>
      deleteFrom("orders").where("id", "=", "1").execute()
    );
    const rows = await db.selectFrom("orders").selectAll().execute();
    expect(rows).toHaveLength(0);
  });

  it("steps が順番に適用される", async () => {
    await db
      .insertInto("orders")
      .values({ id: "1", status: "PENDING", amount: 100, createdAt: "2024-01-01" })
      .execute();

    const cast = kycast(db);
    const result = await cast.query(
      ({ selectFrom }) => selectFrom("orders").selectAll().execute(),
      [
        (rows) => rows.filter((r) => r.amount > 0),
        (rows) => rows.map((r) => ({ ...r, status: "ENRICHED" })),
      ]
    );
    expect(result[0].status).toBe("ENRICHED");
  });
});

describe("cast.table()", () => {
  beforeEach(async () => {
    await db
      .insertInto("orders")
      .values([
        { id: "1", status: "PENDING", amount: 100, createdAt: "2024-01-01" },
        { id: "2", status: "DONE", amount: 200, createdAt: "2024-01-02" },
      ])
      .execute();
  });

  it("get() - 存在するレコードを返す", async () => {
    const cast = kycast(db);
    const order = await cast.table("orders")(({ get }) => get("1"));
    expect(order?.id).toBe("1");
  });

  it("get() - 存在しない場合 null を返す", async () => {
    const cast = kycast(db);
    const order = await cast.table("orders")(({ get }) => get("999"));
    expect(order).toBeNull();
  });

  it("getOrThrow() - 存在する場合レコードを返す", async () => {
    const cast = kycast(db);
    const order = await cast.table("orders")(({ getOrThrow }) => getOrThrow("1"));
    expect(order.id).toBe("1");
  });

  it("getOrThrow() - 存在しない場合 throw する", async () => {
    const cast = kycast(db);
    await expect(
      cast.table("orders")(({ getOrThrow }) => getOrThrow("999"))
    ).rejects.toThrow('Record not found in table "orders" with id: 999');
  });

  it("find() - 全件取得", async () => {
    const cast = kycast(db);
    const orders = await cast.table("orders")(({ find }) => find());
    expect(orders).toHaveLength(2);
  });

  it("find() - condition フィルター", async () => {
    const cast = kycast(db);
    const orders = await cast.table("orders")(({ find }) =>
      find({ condition: (eb) => eb.eb("status", "=", "PENDING") })
    );
    expect(orders).toHaveLength(1);
    expect(orders[0].id).toBe("1");
  });

  it("find() - limit", async () => {
    const cast = kycast(db);
    const orders = await cast.table("orders")(({ find }) => find({ limit: 1 }));
    expect(orders).toHaveLength(1);
  });

  it("create() - レコードを作成して返す", async () => {
    const cast = kycast(db);
    const order = await cast.table("orders")(({ create }) =>
      create({ id: "3", status: "PENDING", amount: 300, createdAt: "2024-01-03" })
    );
    expect(order.id).toBe("3");
  });

  it("update() - レコードを更新して返す", async () => {
    const cast = kycast(db);
    const order = await cast.table("orders")(({ update }) =>
      update("1", { status: "CANCELLED" })
    );
    expect(order.status).toBe("CANCELLED");
  });

  it("upsert() - 存在しない場合は insert", async () => {
    const cast = kycast(db);
    const order = await cast.table("orders")(({ upsert }) =>
      upsert({ id: "3", status: "PENDING", amount: 300, createdAt: "2024-01-03" })
    );
    expect(order.id).toBe("3");
  });

  it("upsert() - 存在する場合は update", async () => {
    const cast = kycast(db);
    const order = await cast.table("orders")(({ upsert }) =>
      upsert({ id: "1", status: "RESERVED", amount: 100, createdAt: "2024-01-01" })
    );
    expect(order.status).toBe("RESERVED");
  });

  it("bulkUpsert() - 複数件 upsert", async () => {
    const cast = kycast(db);
    const orders = await cast.table("orders")(({ bulkUpsert }) =>
      bulkUpsert([
        { id: "1", status: "BULK", amount: 100, createdAt: "2024-01-01" },
        { id: "3", status: "NEW", amount: 300, createdAt: "2024-01-03" },
      ])
    );
    expect(orders).toHaveLength(2);
    const updated = orders.find((o) => o.id === "1");
    expect(updated?.status).toBe("BULK");
  });

  it("bulkUpsert() - 空配列は空配列を返す", async () => {
    const cast = kycast(db);
    const result = await cast.table("orders")(({ bulkUpsert }) => bulkUpsert([]));
    expect(result).toEqual([]);
  });

  it("delete() - レコードを削除する", async () => {
    const cast = kycast(db);
    await cast.table("orders")(({ delete: del }) => del("1"));
    const row = await db.selectFrom("orders").selectAll().where("id", "=", "1").executeTakeFirst();
    expect(row).toBeUndefined();
  });

  it("steps が順番に適用される", async () => {
    const cast = kycast(db);
    const result = await cast.table("orders")(
      ({ getOrThrow }) => getOrThrow("1"),
      [
        (order) => ({ ...order, status: "PROCESSED" }),
        (order) => ({ ...order, amount: order.amount * 2 }),
      ]
    );
    expect(result.status).toBe("PROCESSED");
    expect(result.amount).toBe(200);
  });

  it("tx を外から渡した場合も動作する", async () => {
    await db.transaction().execute(async (tx) => {
      const cast = kycast(tx);
      const order = await cast.table("orders")(({ getOrThrow }) =>
        getOrThrow("1")
      );
      expect(order.id).toBe("1");
    });
  });

  it("同じ db + テーブル名は同じ TableEnv インスタンスを返す（キャッシュ）", async () => {
    const cast = kycast(db);
    let env1: any;
    let env2: any;
    await cast.table("orders")((e) => { env1 = e; return Promise.resolve(null as any); });
    await cast.table("orders")((e) => { env2 = e; return Promise.resolve(null as any); });
    expect(env1).toBe(env2);
  });
});
