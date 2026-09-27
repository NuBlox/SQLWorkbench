import type { QueryPlanView } from "./explain-plan.js";
import type { QueryStatisticsView } from "./query-insights.js";

export interface QueryPlanHistoryEntry {
  readonly id: string;
  readonly connectionId: string;
  readonly providerId: string;
  readonly sql: string;
  readonly fingerprint: string;
  readonly capturedAt: string;
  readonly plan: QueryPlanView;
}

export interface QueryInsightsSnapshot {
  readonly statistics: QueryStatisticsView;
  readonly recentPlans: readonly QueryPlanHistoryEntry[];
}
