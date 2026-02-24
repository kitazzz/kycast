import type {
  ExpressionBuilder,
  Insertable,
  Kysely,
  Selectable,
  Transaction,
  Updateable,
} from "kysely";

// --- Base types ---

export type KyselyDb<DB> = Kysely<DB> | Transaction<DB>;

export type Step<T> = (value: T) => T | Promise<T>;

// --- Query API ---

/**
 * Kysely DSL の低レベルアクセス環境
 * Pick を使うことで、Transaction<DB> も含む KyselyDb<DB> から安全にキャストできる
 */
export type QueryEnv<DB> = Pick<
  Kysely<DB>,
  "selectFrom" | "insertInto" | "updateTable" | "deleteFrom"
>;

// --- Table API ---

/** id カラムを持つテーブルのみ抽出 */
export type TableWithId<DB> = {
  [K in keyof DB]: DB[K] extends { id: any } ? K : never;
}[keyof DB];

/** 型安全な where 条件 */
export type FilterCondition<DB, TTable extends keyof DB & string> = (
  eb: ExpressionBuilder<DB, TTable>
) => ReturnType<ExpressionBuilder<DB, TTable>["eb"]>;

export type OrderByDirection = "asc" | "desc";

export type FindOptions<DB, TTable extends keyof DB & string> = {
  condition?: FilterCondition<DB, TTable>;
  orderBy?: Array<{
    column: keyof DB[TTable] & string;
    direction?: OrderByDirection;
  }>;
  limit?: number;
  select?: readonly (keyof DB[TTable] & string)[];
};

export type FindOneOptions<DB, TTable extends keyof DB & string> = {
  condition: FilterCondition<DB, TTable>;
  orderBy?: Array<{
    column: keyof DB[TTable] & string;
    direction?: OrderByDirection;
  }>;
  select?: readonly (keyof DB[TTable] & string)[];
};

export type MutationOptions<DB, TTable extends keyof DB & string> = {
  returning?: readonly (keyof DB[TTable] & string)[];
};

export type UpsertOptions<DB, TTable extends keyof DB & string> =
  MutationOptions<DB, TTable> & {
    conflictColumns?: (keyof DB[TTable] & string)[];
  };

/** cast.table() の queryFn に渡される環境 */
export interface TableEnv<
  DB,
  TTable extends TableWithId<DB> & keyof DB & string,
> {
  get(id: string): Promise<Selectable<DB[TTable]> | null>;
  getOrThrow(id: string): Promise<Selectable<DB[TTable]>>;
  find<TResult = Selectable<DB[TTable]>>(
    options?: FindOptions<DB, TTable>
  ): Promise<TResult[]>;
  findOne<TResult = Selectable<DB[TTable]>>(
    options: FindOneOptions<DB, TTable>
  ): Promise<TResult | null>;
  create<TResult = Selectable<DB[TTable]>>(
    input: Insertable<DB[TTable]>,
    options?: MutationOptions<DB, TTable>
  ): Promise<TResult>;
  update<TResult = Selectable<DB[TTable]>>(
    id: string,
    data: Updateable<DB[TTable]>,
    options?: MutationOptions<DB, TTable>
  ): Promise<TResult>;
  upsert<TResult = Selectable<DB[TTable]>>(
    input: Insertable<DB[TTable]>,
    options?: UpsertOptions<DB, TTable>
  ): Promise<TResult>;
  bulkUpsert<TResult = Selectable<DB[TTable]>>(
    inputs: Insertable<DB[TTable]>[],
    options?: UpsertOptions<DB, TTable>
  ): Promise<TResult[]>;
  delete(id: string): Promise<void>;
}
