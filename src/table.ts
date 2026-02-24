import type {
  KyselyDb,
  Step,
  TableEnv,
  TableWithId,
  UpsertOptions,
} from "./types.js";

const BULK_UPSERT_CHUNK_SIZE = 500;

/**
 * WeakMap によるキャッシュ
 * 同じ db インスタンス + テーブル名なら同じ TableEnv インスタンスを返す
 */
const tableCache = new WeakMap<object, Map<string, TableEnv<any, any>>>();

function getOrCreateTableEnv<
  DB,
  TTable extends TableWithId<DB> & keyof DB & string,
>(db: KyselyDb<DB>, tableName: TTable): TableEnv<DB, TTable> {
  let dbCache = tableCache.get(db as object);
  if (!dbCache) {
    dbCache = new Map();
    tableCache.set(db as object, dbCache);
  }

  if (dbCache.has(tableName)) {
    return dbCache.get(tableName) as TableEnv<DB, TTable>;
  }

  const env: TableEnv<DB, TTable> = {
    async get(id) {
      const row = await (db as any)
        .selectFrom(tableName)
        .selectAll()
        .where("id", "=", id)
        .executeTakeFirst();
      return row ?? null;
    },

    async getOrThrow(id) {
      const row = await (db as any)
        .selectFrom(tableName)
        .selectAll()
        .where("id", "=", id)
        .executeTakeFirst();
      if (!row) {
        throw new Error(
          `Record not found in table "${tableName}" with id: ${id}`
        );
      }
      return row;
    },

    async find(options) {
      let query: any = db;
      query = (db as any).selectFrom(tableName);
      query = options?.select
        ? query.select(options.select)
        : query.selectAll();
      if (options?.condition) {
        query = query.where(options.condition);
      }
      if (options?.orderBy) {
        for (const o of options.orderBy) {
          query = query.orderBy(o.column, o.direction ?? "asc");
        }
      }
      if (options?.limit !== undefined) {
        query = query.limit(options.limit);
      }
      return query.execute();
    },

    async findOne({ condition, orderBy, select }) {
      let query: any = (db as any).selectFrom(tableName);
      query = select ? query.select(select) : query.selectAll();
      query = query.where(condition);
      if (orderBy) {
        for (const o of orderBy) {
          query = query.orderBy(o.column, o.direction ?? "asc");
        }
      } else {
        query = query.orderBy("createdAt", "desc");
      }
      const row = await query.executeTakeFirst();
      return row ?? null;
    },

    async create(input, options) {
      let query: any = (db as any).insertInto(tableName).values(input);
      query = options?.returning
        ? query.returning(options.returning)
        : query.returningAll();
      return query.executeTakeFirstOrThrow();
    },

    async update(id, data, options) {
      let query: any = (db as any)
        .updateTable(tableName)
        .set(data)
        .where("id", "=", id);
      query = options?.returning
        ? query.returning(options.returning)
        : query.returningAll();
      return query.executeTakeFirstOrThrow();
    },

    async upsert(input, options) {
      const conflictColumns = (options as UpsertOptions<DB, TTable>)
        ?.conflictColumns ?? ["id"];
      const updateData = Object.fromEntries(
        Object.entries(input as Record<string, unknown>).filter(
          ([key]) => !conflictColumns.includes(key as any)
        )
      );
      let query: any = (db as any)
        .insertInto(tableName)
        .values(input)
        .onConflict((oc: any) =>
          oc.columns(conflictColumns).doUpdateSet(updateData)
        );
      query = options?.returning
        ? query.returning(options.returning)
        : query.returningAll();
      return query.executeTakeFirstOrThrow();
    },

    async bulkUpsert(inputs, options) {
      if (inputs.length === 0) return [];

      const conflictColumns = (options as UpsertOptions<DB, TTable>)
        ?.conflictColumns ?? ["id"];
      const firstInput = inputs[0] as Record<string, unknown>;
      const updateSet = Object.fromEntries(
        Object.keys(firstInput)
          .filter((key) => !conflictColumns.includes(key as any))
          .map((key) => [key, (eb: any) => eb.ref(`excluded.${key}`)])
      );

      const results: any[] = [];
      for (let i = 0; i < inputs.length; i += BULK_UPSERT_CHUNK_SIZE) {
        const chunk = inputs.slice(i, i + BULK_UPSERT_CHUNK_SIZE);
        let query: any = (db as any)
          .insertInto(tableName)
          .values(chunk)
          .onConflict((oc: any) =>
            oc.columns(conflictColumns).doUpdateSet(updateSet)
          );
        query = options?.returning
          ? query.returning(options.returning)
          : query.returningAll();
        results.push(...(await query.execute()));
      }
      return results;
    },

    async delete(id) {
      await (db as any)
        .deleteFrom(tableName)
        .where("id", "=", id)
        .executeTakeFirstOrThrow();
    },
  };

  dbCache.set(tableName, env);
  return env;
}

export function createTable<DB>(db: KyselyDb<DB>) {
  return function table<TTable extends TableWithId<DB> & keyof DB & string>(
    tableName: TTable
  ) {
    return async function run<T>(
      queryFn: (env: TableEnv<DB, TTable>) => Promise<T>,
      steps: Step<T>[] = []
    ): Promise<T> {
      const env = getOrCreateTableEnv(db, tableName);

      // [拡張ポイント] jig: queryFn 実行前後にフック可能
      let value = await queryFn(env);

      for (const step of steps) {
        value = await step(value);
      }

      return value;
    };
  };
}
