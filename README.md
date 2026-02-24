# kycast

Kysely の軽量ラッパー。DB アクセス（I/O境界）と純粋ロジック（steps）を分離し、レビューとテストを容易にする。

## コンセプト

```ts
await cast.table("orders")(
  async ({ getOrThrow }) => getOrThrow(orderId),  // DB に触れてよいのはここだけ
  [validateOrder, computeTotal]                    // steps: 純粋関数のみ
)
```

- **queryFn** — DB に触れてよい唯一の場所（I/O 境界）
- **steps** — `value => value` の純粋変換列。DB 禁止
- **tx** — kycast は関与しない。外側で用意して渡す

## インストール

### npm 公開後（予定）

```sh
pnpm add kysely kycast
```

### 現時点（GitHub から直接）

```sh
# GitHub から
pnpm add github:kitazzz/kycast

# ローカル開発中のパスから
pnpm add /path/to/kycast
```

> **前提**: `kysely` は peerDependency なので別途インストールが必要です。

## セットアップ

```ts
import { Kysely, PostgresDialect } from "kysely"
import { kycast } from "kycast"
import { Pool } from "pg"

// 1. Kysely の db を用意する（既存の設定をそのまま使う）
const db = new Kysely<DB>({
  dialect: new PostgresDialect({ pool: new Pool({ ... }) }),
})

// 2. db を渡して cast を作る
const cast = kycast(db)
```

## 使い方

### Table API（推奨）

テーブル単位の便利メソッドを使う高レベル API。

```ts
// ID でレコードを取得
const order = await cast.table("orders")(
  ({ getOrThrow }) => getOrThrow(orderId)
)

// 条件でフィルター
const orders = await cast.table("orders")(
  ({ find }) => find({
    condition: (eb) => eb.eb("status", "=", "PENDING"),
    orderBy: [{ column: "createdAt", direction: "desc" }],
    limit: 10,
  })
)

// 作成
const newOrder = await cast.table("orders")(
  ({ create }) => create({ id: "...", status: "PENDING", amount: 1000 })
)

// 更新
const updated = await cast.table("orders")(
  ({ update }) => update(orderId, { status: "RESERVED" })
)

// Upsert
await cast.table("orders")(
  ({ upsert }) => upsert({ id: "...", status: "DONE", amount: 1000 })
)

// 一括 Upsert（500件チャンク処理）
await cast.table("orders")(
  ({ bulkUpsert }) => bulkUpsert([...records])
)

// 削除
await cast.table("orders")(
  ({ delete: del }) => del(orderId)
)
```

#### steps で純粋ロジックを挟む

```ts
const result = await cast.table("orders")(
  async ({ getOrThrow }) => getOrThrow(orderId),
  [
    (order) => {
      if (order.status !== "PENDING") throw new Error("予約できない状態")
      return { ...order, status: "RESERVED" }
    },
    computeTotal,
  ]
)
```

### Query API（複雑クエリ用）

JOIN や集計など、Table API では対応できないケースで使う。

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

### トランザクション

tx の管理は kycast の外側で行い、tx を `kycast()` に渡す。

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

### 型定義

Kysely のスキーマ型をそのまま使う。

```ts
import type { TableWithId, FilterCondition, Step } from "kycast"

// id カラムを持つテーブルのみ受け付ける型
type MyTable = TableWithId<DB>  // => "orders" | "users" | ...

// 型安全な where 条件
const activeOnly: FilterCondition<DB, "orders"> = (eb) =>
  eb.eb("status", "!=", "CANCELLED")

// 純粋変換
const enrichOrder: Step<Order> = (order) => ({
  ...order,
  displayName: `Order #${order.id}`,
})
```

## API リファレンス

### `kycast(db)`

```ts
const cast = kycast(db)  // db は Kysely<DB> または Transaction<DB>
```

### `cast.table(tableName)(queryFn, steps?)`

`id` カラムを持つテーブルを対象とした高レベル API。

| メソッド | シグネチャ |
|----------|-----------|
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

Kysely DSL への低レベルアクセス。

| 提供されるメソッド |
|-------------------|
| `selectFrom` |
| `insertInto` |
| `updateTable` |
| `deleteFrom` |

### `Step<T>`

```ts
type Step<T> = (value: T) => T | Promise<T>
```

## 開発

```sh
pnpm install
pnpm test:run   # テスト
pnpm typecheck  # 型チェック
pnpm build      # ビルド
```

## License

MIT
