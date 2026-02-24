# kycast

A lightweight [Kysely](https://kysely.dev/) wrapper that enforces a clear boundary between database I/O and pure business logic.

## Motivation

In typical business applications, database access and business logic tend to get mixed together, making code hard to review and test.

```ts
// Hard to test: DB access and logic are interleaved
async function reserveOrder(orderId: string) {
  const order = await db.selectFrom("orders").where("id", "=", orderId).executeTakeFirstOrThrow()
  if (order.status !== "PENDING") throw new Error("Cannot reserve")
  const updated = { ...order, status: "RESERVED", total: order.amount * 1.1 }
  await db.updateTable("orders").set(updated).where("id", "=", orderId).execute()
  return updated
}
```

kycast makes the separation explicit:

```ts
// DB access is isolated in queryFn; logic lives in pure steps
await cast.table("orders")(
  async ({ getOrThrow, update }) => {
    const order = await getOrThrow(orderId)
    return update(orderId, order)
  },
  [
    (order) => {
      if (order.status !== "PENDING") throw new Error("Cannot reserve")
      return { ...order, status: "RESERVED", total: order.amount * 1.1 }
    },
  ]
)
```

### Design principles

- **I/O boundary** — DB access is confined to `queryFn`. Reviewers know exactly where to look for side effects.
- **Pure steps** — Business logic lives in `steps`: plain functions of `value → value`. Easy to unit test without a database.
- **No magic** — kycast does not manage transactions, collect effects, or enforce DDD patterns. Bring your own tx and pass it in.
- **Two levels of access** — `cast.table()` for everyday CRUD; `cast.query()` as an escape hatch for complex queries.

## Installation

> **Note:** kycast is not yet published to npm. Install directly from GitHub in the meantime.

```sh
# From GitHub
pnpm add github:kitazzz/kycast

# From a local path (during development)
pnpm add /path/to/kycast
```

kysely is a peer dependency — install it separately:

```sh
pnpm add kysely
```

## Setup

```ts
import { Kysely, PostgresDialect } from "kysely"
import { kycast, kycastLogger } from "kycast"
import { Pool } from "pg"

const db = new Kysely<DB>({
  dialect: new PostgresDialect({ pool: new Pool({ ... }) }),
  log: kycastLogger(),  // logs every query as JSON to console
})

const cast = kycast(db)
```

`kycastLogger()` hooks into Kysely's built-in `log` option and captures every SQL query — from both `cast.table()` and `cast.query()` — in a structured JSON format. The output is designed to be parsed by jig for regression testing.

```json
{ "kycast": true, "sql": "select * from ...", "parameters": ["1"], "durationMs": 3 }
```

You can also pass a custom function to send logs to your own logger:

```ts
log: kycastLogger((event) => {
  myLogger.info({ sql: event.sql, params: event.parameters, ms: event.durationMs })
})
```

## Usage

### Table API (recommended)

High-level CRUD methods scoped to a single table. Requires the table to have an `id: string` column.

```ts
// Fetch by ID (returns null if not found)
const order = await cast.table("orders")(
  ({ get }) => get(orderId)
)

// Fetch by ID (throws if not found)
const order = await cast.table("orders")(
  ({ getOrThrow }) => getOrThrow(orderId)
)

// Filter, sort, limit
const orders = await cast.table("orders")(
  ({ find }) => find({
    condition: (eb) => eb.eb("status", "=", "PENDING"),
    orderBy: [{ column: "createdAt", direction: "desc" }],
    limit: 10,
  })
)

// Find one (defaults to createdAt desc when orderBy is omitted)
const latest = await cast.table("orders")(
  ({ findOne }) => findOne({
    condition: (eb) => eb.eb("userId", "=", userId),
  })
)

// Create
const newOrder = await cast.table("orders")(
  ({ create }) => create({ id: "...", status: "PENDING", amount: 1000 })
)

// Update
const updated = await cast.table("orders")(
  ({ update }) => update(orderId, { status: "RESERVED" })
)

// Upsert
await cast.table("orders")(
  ({ upsert }) => upsert({ id: "...", status: "DONE", amount: 1000 })
)

// Bulk upsert (processed in chunks of 500)
await cast.table("orders")(
  ({ bulkUpsert }) => bulkUpsert([...records])
)

// Delete
await cast.table("orders")(
  ({ delete: del }) => del(orderId)
)
```

#### Adding pure steps

```ts
const result = await cast.table("orders")(
  async ({ getOrThrow }) => getOrThrow(orderId),
  [
    (order) => {
      if (order.status !== "PENDING") throw new Error("Cannot reserve")
      return { ...order, status: "RESERVED" }
    },
    computeTotal,
    enrichForResponse,
  ]
)
```

Steps receive only the value — no `db`, no `env`. This makes them trivial to unit test:

```ts
it("rejects non-pending orders", () => {
  expect(() => reserveStep({ ...order, status: "DONE" })).toThrow("Cannot reserve")
})
```

### Query API (escape hatch)

Use `cast.query()` when Table API is not enough — JOINs, aggregations, complex filters.

```ts
const rows = await cast.query(
  async ({ selectFrom }) =>
    selectFrom("orders")
      .innerJoin("users", "users.id", "orders.userId")
      .selectAll("orders")
      .select("users.name")
      .where("orders.status", "=", "PENDING")
      .execute(),
  [(rows) => rows.map(normalize)]
)
```

Available in `queryFn`: `selectFrom`, `insertInto`, `updateTable`, `deleteFrom`.

### Transactions

kycast does not manage transactions. Create a transaction externally and pass it to `kycast()`.

```ts
await db.transaction().execute(async (tx) => {
  const cast = kycast(tx)

  const order = await cast.table("orders")(
    ({ getOrThrow }) => getOrThrow(orderId),
    [validateOrder]
  )

  await cast.table("payments")(
    ({ create }) => create({ orderId: order.id, amount: order.amount })
  )
})
```

### TypeScript types

```ts
import type { TableWithId, FilterCondition, Step } from "kycast"

// Tables that have an id column
type MyTable = TableWithId<DB>  // => "orders" | "users" | ...

// Type-safe where condition
const activeOnly: FilterCondition<DB, "orders"> = (eb) =>
  eb.eb("status", "!=", "CANCELLED")

// Pure step
const enrichOrder: Step<Order> = (order) => ({
  ...order,
  displayName: `Order #${order.id}`,
})
```

## API Reference

### `kycast(db)`

```ts
const cast = kycast(db)  // db: Kysely<DB> | Transaction<DB>
```

### `cast.table(tableName)(queryFn, steps?)`

Requires `tableName` to reference a table with an `id: string` column.

| Method | Signature |
|--------|-----------|
| `get` | `(id: string) => Promise<Row \| null>` |
| `getOrThrow` | `(id: string) => Promise<Row>` |
| `find` | `(options?) => Promise<Row[]>` |
| `findOne` | `(options) => Promise<Row \| null>` |
| `create` | `(input, options?) => Promise<Row>` |
| `update` | `(id, data, options?) => Promise<Row>` |
| `upsert` | `(input, options?) => Promise<Row>` |
| `bulkUpsert` | `(inputs[], options?) => Promise<Row[]>` |
| `delete` | `(id) => Promise<void>` |

### `cast.query(queryFn, steps?)`

| Available in `queryFn` |
|------------------------|
| `selectFrom` |
| `insertInto` |
| `updateTable` |
| `deleteFrom` |

### `Step<T>`

```ts
type Step<T> = (value: T) => T | Promise<T>
```

## Development

```sh
pnpm install
pnpm test:run   # run tests
pnpm typecheck  # type check
pnpm build      # build CJS + ESM
```

## License

MIT
