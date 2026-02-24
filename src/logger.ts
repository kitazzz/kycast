import type { LogEvent } from "kysely";

export interface KycastLogEvent {
  sql: string;
  parameters: readonly unknown[];
  durationMs: number;
}

export type KycastLogger = (event: KycastLogEvent) => void;

/**
 * Kysely の `log` オプションに渡すロガーを生成する。
 *
 * table() / query() のどちらで実行されたクエリも全て記録される。
 * jig はこの出力を解析してモックデータを作成する。
 *
 * @example
 * ```ts
 * const db = new Kysely<DB>({
 *   dialect: ...,
 *   log: kycastLogger(),
 * })
 * ```
 *
 * @example カスタムロガー
 * ```ts
 * const db = new Kysely<DB>({
 *   dialect: ...,
 *   log: kycastLogger((event) => {
 *     myLogger.info(event)
 *   }),
 * })
 * ```
 */
export function kycastLogger(fn?: KycastLogger): (event: LogEvent) => void {
  const logger = fn ?? defaultLogger;
  return (event: LogEvent) => {
    if (event.level === "query") {
      logger({
        sql: event.query.sql,
        parameters: event.query.parameters,
        durationMs: event.queryDurationMillis,
      });
    }
  };
}

function defaultLogger(event: KycastLogEvent): void {
  console.log(
    JSON.stringify({
      kycast: true,
      sql: event.sql,
      parameters: event.parameters,
      durationMs: event.durationMs,
    })
  );
}
