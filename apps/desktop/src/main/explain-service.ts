import { ConnectionManager, QueryService } from "@nublox/workbench-core";
import { normalizeExplainPlan } from "@nublox/workbench-query-engineering/explain-plan";

import type { ExplainQueryRequest, QueryPlanView } from "../lib/desktop-api.js";

export class DesktopExplainService {
  readonly #queries: QueryService;

  constructor(readonly connections: ConnectionManager) {
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
    return normalizeExplainPlan(connection.provider.id, plan.format, plan.raw);
  }
}

function requireNonEmpty(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} cannot be empty.`);
  return normalized;
}
