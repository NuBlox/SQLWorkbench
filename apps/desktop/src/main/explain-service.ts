import { randomUUID } from "node:crypto";

import { ConnectionManager, QueryService } from "@nublox/workbench-core";
import { normalizeExplainPlan } from "@nublox/workbench-query-engineering/explain-plan";
import { fingerprintSql } from "@nublox/workbench-query-engineering/query-insights";

import type { ExplainQueryRequest, QueryPlanView } from "../lib/desktop-api.js";
import { QueryPlanHistoryStore } from "./query-plan-history-store.js";

export class DesktopExplainService {
  readonly #queries: QueryService;

  constructor(
    readonly connections: ConnectionManager,
    readonly planHistory?: QueryPlanHistoryStore,
  ) {
    this.#queries = new QueryService(connections);
  }

  async explain(request: ExplainQueryRequest): Promise<QueryPlanView> {
    const connectionId = requireNonEmpty(request.connectionId, "Connection id");
    const sql = requireNonEmpty(request.sql, "SQL");
    const connection = this.connections.get(connectionId);
    if (!connection.provider.capabilities.explainPlan) {
      throw new Error(`Database provider '${connection.provider.id}' does not support explain plans.`);
    }

    const plan = await this.#queries.explain(connectionId, {
      sql,
      mode: "text",
      ...(request.timeoutMs !== undefined ? { timeoutMs: request.timeoutMs } : {}),
    });
    const normalized = normalizeExplainPlan(connection.provider.id, plan.format, plan.raw);
    if (this.planHistory) {
      try {
        await this.planHistory.add({
          id: randomUUID(),
          connectionId,
          providerId: connection.provider.id,
          sql,
          fingerprint: fingerprintSql(sql),
          capturedAt: new Date().toISOString(),
          plan: normalized,
        });
      } catch (error) {
        console.error("Failed to persist query plan history.", error);
      }
    }
    return normalized;
  }
}

function requireNonEmpty(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} cannot be empty.`);
  return normalized;
}
