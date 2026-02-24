import type { KyselyDb, QueryEnv, Step } from "./types.js";

export function createQuery<DB>(db: KyselyDb<DB>) {
  return async function query<T>(
    queryFn: (env: QueryEnv<DB>) => Promise<T>,
    steps: Step<T>[] = []
  ): Promise<T> {
    // メソッドを db にバインドしてデストラクチャ時の this 喪失を防ぐ
    // as unknown as QueryEnv<DB>: bind() は Kysely のジェネリックを保持しないため
    const env = {
      selectFrom: (from: any) => (db as any).selectFrom(from),
      insertInto: (table: any) => (db as any).insertInto(table),
      updateTable: (table: any) => (db as any).updateTable(table),
      deleteFrom: (from: any) => (db as any).deleteFrom(from),
    } as unknown as QueryEnv<DB>;

    // [拡張ポイント] jig: queryFn 実行前後にフック可能
    let value = await queryFn(env);

    for (const step of steps) {
      value = await step(value);
    }

    return value;
  };
}
