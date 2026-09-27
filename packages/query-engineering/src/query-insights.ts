export type QuerySampleStatus = "success" | "error" | "cancelled";

export interface QueryExecutionSample {
  readonly id: string;
  readonly sql: string;
  readonly startedAt: string;
  readonly elapsedMs: number;
  readonly status: QuerySampleStatus;
  readonly statementCount: number;
  readonly resultSetCount: number;
}

export interface QueryPlanSample {
  readonly fingerprint: string;
  readonly capturedAt: string;
  readonly queryCost?: number;
  readonly nodeCount: number;
}

export interface QueryStatisticsSummary {
  readonly totalExecutions: number;
  readonly successfulExecutions: number;
  readonly failedExecutions: number;
  readonly cancelledExecutions: number;
  readonly successRate: number;
  readonly averageElapsedMs: number;
  readonly p95ElapsedMs: number;
  readonly minimumElapsedMs: number;
  readonly maximumElapsedMs: number;
  readonly totalStatements: number;
  readonly totalResultSets: number;
  readonly uniqueQueries: number;
  readonly capturedPlans: number;
}

export interface QueryStatementStatistics {
  readonly fingerprint: string;
  readonly sampleSql: string;
  readonly executions: number;
  readonly successfulExecutions: number;
  readonly failedExecutions: number;
  readonly cancelledExecutions: number;
  readonly averageElapsedMs: number;
  readonly p95ElapsedMs: number;
  readonly minimumElapsedMs: number;
  readonly maximumElapsedMs: number;
  readonly lastExecutedAt: string;
  readonly planCount: number;
  readonly lastPlanAt?: string;
  readonly lastQueryCost?: number;
}

export interface QueryStatisticsView {
  readonly summary: QueryStatisticsSummary;
  readonly queries: readonly QueryStatementStatistics[];
}

export function normalizeSqlForFingerprint(sql: string): string {
  const input = sql.trim();
  if (!input) return "";

  let output = "";
  let pendingSpace = false;
  let quote: "'" | '"' | "`" | undefined;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index]!;
    if (quote) {
      output += char;
      if (char === quote) {
        if (input[index + 1] === quote) {
          output += input[++index]!;
        } else if (quote === "'" && input[index - 1] === "\\") {
          // Backslash-escaped quote in MySQL string mode; stay quoted.
        } else {
          quote = undefined;
        }
      }
      continue;
    }

    if (char === "'" || char === '"' || char === "`") {
      if (pendingSpace && output && !output.endsWith(" ")) output += " ";
      pendingSpace = false;
      quote = char;
      output += char;
      continue;
    }

    if (/\s/u.test(char)) {
      pendingSpace = true;
      continue;
    }

    if (pendingSpace && output && !output.endsWith(" ")) output += " ";
    pendingSpace = false;
    output += char;
  }

  return output.trim().replace(/;+$/u, "").trim();
}

export function fingerprintSql(sql: string): string {
  const normalized = normalizeSqlForFingerprint(sql);
  let high = 0x811c9dc5;
  let low = 0x811c9dc5;
  for (let index = 0; index < normalized.length; index += 1) {
    const code = normalized.charCodeAt(index);
    low ^= code & 0xff;
    low = Math.imul(low, 0x01000193);
    high ^= code >>> 8;
    high = Math.imul(high, 0x01000193);
  }
  return `q-${(high >>> 0).toString(16).padStart(8, "0")}${(low >>> 0).toString(16).padStart(8, "0")}`;
}

export function calculateQueryStatistics(
  executions: readonly QueryExecutionSample[],
  plans: readonly QueryPlanSample[] = [],
): QueryStatisticsView {
  const elapsed = executions.map((sample) => sample.elapsedMs);
  const grouped = new Map<string, QueryExecutionSample[]>();
  for (const sample of executions) {
    const fingerprint = fingerprintSql(sample.sql);
    const bucket = grouped.get(fingerprint) ?? [];
    bucket.push(sample);
    grouped.set(fingerprint, bucket);
  }

  const plansByFingerprint = new Map<string, QueryPlanSample[]>();
  for (const plan of plans) {
    const bucket = plansByFingerprint.get(plan.fingerprint) ?? [];
    bucket.push(plan);
    plansByFingerprint.set(plan.fingerprint, bucket);
  }

  const successfulExecutions = executions.filter((sample) => sample.status === "success").length;
  const failedExecutions = executions.filter((sample) => sample.status === "error").length;
  const cancelledExecutions = executions.filter((sample) => sample.status === "cancelled").length;
  const totalExecutions = executions.length;

  const queries = [...grouped.entries()].map(([fingerprint, samples]): QueryStatementStatistics => {
    const durations = samples.map((sample) => sample.elapsedMs);
    const queryPlans = [...(plansByFingerprint.get(fingerprint) ?? [])]
      .sort((left, right) => right.capturedAt.localeCompare(left.capturedAt));
    const lastPlan = queryPlans[0];
    const lastExecution = [...samples].sort((left, right) => right.startedAt.localeCompare(left.startedAt))[0]!;
    return {
      fingerprint,
      sampleSql: normalizeSqlForFingerprint(lastExecution.sql),
      executions: samples.length,
      successfulExecutions: samples.filter((sample) => sample.status === "success").length,
      failedExecutions: samples.filter((sample) => sample.status === "error").length,
      cancelledExecutions: samples.filter((sample) => sample.status === "cancelled").length,
      averageElapsedMs: average(durations),
      p95ElapsedMs: percentile(durations, 0.95),
      minimumElapsedMs: minimum(durations),
      maximumElapsedMs: maximum(durations),
      lastExecutedAt: lastExecution.startedAt,
      planCount: queryPlans.length,
      ...(lastPlan ? { lastPlanAt: lastPlan.capturedAt } : {}),
      ...(lastPlan?.queryCost !== undefined ? { lastQueryCost: lastPlan.queryCost } : {}),
    };
  }).sort((left, right) => right.lastExecutedAt.localeCompare(left.lastExecutedAt));

  return {
    summary: {
      totalExecutions,
      successfulExecutions,
      failedExecutions,
      cancelledExecutions,
      successRate: totalExecutions === 0 ? 0 : successfulExecutions / totalExecutions,
      averageElapsedMs: average(elapsed),
      p95ElapsedMs: percentile(elapsed, 0.95),
      minimumElapsedMs: minimum(elapsed),
      maximumElapsedMs: maximum(elapsed),
      totalStatements: executions.reduce((sum, sample) => sum + sample.statementCount, 0),
      totalResultSets: executions.reduce((sum, sample) => sum + sample.resultSetCount, 0),
      uniqueQueries: grouped.size,
      capturedPlans: plans.length,
    },
    queries,
  };
}

function average(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function minimum(values: readonly number[]): number {
  return values.length === 0 ? 0 : Math.min(...values);
}

function maximum(values: readonly number[]): number {
  return values.length === 0 ? 0 : Math.max(...values);
}

function percentile(values: readonly number[], percentileValue: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.max(0, Math.ceil(percentileValue * sorted.length) - 1);
  return sorted[rank] ?? 0;
}
