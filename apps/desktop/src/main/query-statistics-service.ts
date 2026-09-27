import type { QueryStatisticsView } from "../lib/desktop-api.js";
import { fingerprintSql } from "./plan-history-store.js";
import { QueryPlanHistoryStore } from "./plan-history-store.js";
import { QueryHistoryStore } from "./query-history-store.js";

export class QueryStatisticsService {
  constructor(
    readonly queryHistory: QueryHistoryStore,
    readonly planHistory: QueryPlanHistoryStore,
  ) {}

  async forQuery(connectionId: string, sql: string): Promise<QueryStatisticsView> {
    const fingerprint = fingerprintSql(sql);
    const [executions, plans] = await Promise.all([
      this.queryHistory.list(250),
      this.planHistory.list(250),
    ]);
    const matchingExecutions = executions.filter((entry) => entry.connectionId === connectionId && fingerprintSql(entry.sql) === fingerprint);
    const matchingPlans = plans.filter((entry) => entry.connectionId === connectionId && entry.sqlFingerprint === fingerprint);
    const elapsed = matchingExecutions.map((entry) => entry.elapsedMs);
    const successCount = matchingExecutions.filter((entry) => entry.status === "success").length;
    const errorCount = matchingExecutions.filter((entry) => entry.status === "error").length;
    const cancelledCount = matchingExecutions.filter((entry) => entry.status === "cancelled").length;
    const latest = matchingPlans[0];
    const previous = matchingPlans[1];
    const latestCost = latest?.plan.queryCost;
    const previousCost = previous?.plan.queryCost;

    return {
      connectionId,
      sqlFingerprint: fingerprint,
      executionCount: matchingExecutions.length,
      successCount,
      errorCount,
      cancelledCount,
      ...(elapsed.length > 0 ? {
        averageElapsedMs: elapsed.reduce((sum, value) => sum + value, 0) / elapsed.length,
        minimumElapsedMs: Math.min(...elapsed),
        maximumElapsedMs: Math.max(...elapsed),
        lastExecutedAt: matchingExecutions[0]?.startedAt,
      } : {}),
      explainCount: matchingPlans.length,
      ...(latest ? {
        lastExplainedAt: latest.capturedAt,
        latestExplainElapsedMs: latest.explainElapsedMs,
        latestPlanNodeCount: latest.plan.nodeCount,
      } : {}),
      ...(latestCost !== undefined ? { latestPlanCost: latestCost } : {}),
      ...(previousCost !== undefined ? { previousPlanCost: previousCost } : {}),
      ...(latestCost !== undefined && previousCost !== undefined ? { planCostDelta: latestCost - previousCost } : {}),
    };
  }
}
