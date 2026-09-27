import { calculateQueryStatistics } from "@nublox/workbench-query-engineering/query-insights";
import type { QueryInsightsSnapshot } from "@nublox/workbench-query-engineering/query-plan-history";

import { QueryHistoryStore } from "./query-history-store.js";
import { QueryPlanHistoryStore } from "./query-plan-history-store.js";

export class DesktopQueryInsightsService {
  constructor(
    readonly history: QueryHistoryStore,
    readonly planHistory: QueryPlanHistoryStore,
  ) {}

  async snapshot(): Promise<QueryInsightsSnapshot> {
    const [history, plans] = await Promise.all([
      this.history.list(250),
      this.planHistory.list(100),
    ]);
    const statistics = calculateQueryStatistics(
      history.map((entry) => ({
        id: entry.id,
        sql: entry.sql,
        startedAt: entry.startedAt,
        elapsedMs: entry.elapsedMs,
        status: entry.status,
        statementCount: entry.statementCount,
        resultSetCount: entry.resultSetCount,
      })),
      plans.map((entry) => ({
        fingerprint: entry.fingerprint,
        capturedAt: entry.capturedAt,
        nodeCount: entry.plan.nodeCount,
        ...(entry.plan.queryCost !== undefined ? { queryCost: entry.plan.queryCost } : {}),
      })),
    );
    return { statistics, recentPlans: plans };
  }

  clearPlans(): Promise<void> {
    return this.planHistory.clear();
  }
}
