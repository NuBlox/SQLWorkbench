import { ConnectionManager, QueryService } from "@nublox/workbench-core";
import { normalizeExplainPlan } from "@nublox/workbench-query-engineering/explain-plan";

import type { ExplainQueryRequest, QueryPlanView } from "../lib/desktop-api.js";
import { QueryPlanHistoryStore } from "./plan-history-store.js";

export class DesktopExplainService {
  readonly #queries: QueryService;

  constructor(
    readonly connections: ConnectionManager,
    readonly history: QueryPlanHistoryStore,
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

    const startedAt = Date.now();
    const plan = await this.#queries.explain(connectionId, {
      sql,
      mode: "text",
      ...(request.timeoutMs !== undefined ? { timeoutMs: request.timeoutMs } : {}),
    });
    const normalized = normalizeExplainPlan(connection.provider.id, plan.format, plan.raw);
    await this.history.add({
      connectionId,
      sql,
      capturedAt: new Date().toISOString(),
      explainElapsedMs: Date.now() - startedAt,
      plan: normalized,
    });
    return normalized;
  }
}

function requireNonEmpty(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} cannot be empty.`);
  return normalized;
}
