import { Pool, type QueryResult } from "pg";
import type {
  CancellationSignal,
  DatabaseConnectionConfig,
  QueryExecution,
  QueryRequest,
  QueryResultSet,
} from "@nublox/workbench-provider-api";

type CancellationSource = "signal" | "timeout";

export function createPostgreSqlControlPool(config: DatabaseConnectionConfig): Pool {
  return new Pool({
    host: config.host,
    port: config.port ?? 5432,
    user: config.user,
    ...(config.password !== undefined ? { password: config.password } : {}),
    ...(config.database !== undefined ? { database: config.database } : {}),
    ...(config.connectTimeoutMs !== undefined ? { connectionTimeoutMillis: config.connectTimeoutMs } : {}),
    ...(config.tls ? {
      ssl: {
        ...(config.tls.ca !== undefined ? { ca: config.tls.ca } : {}),
        ...(config.tls.cert !== undefined ? { cert: config.tls.cert } : {}),
        ...(config.tls.key !== undefined ? { key: config.tls.key } : {}),
        rejectUnauthorized: config.tls.rejectUnauthorized ?? true,
      },
    } : {}),
    max: 1,
    idleTimeoutMillis: 10_000,
    allowExitOnIdle: true,
    application_name: "nublox-sql-workbench-control",
  });
}

export async function executePostgreSqlRequest(
  queryPool: Pool,
  controlPool: Pool,
  request: QueryRequest,
): Promise<QueryExecution> {
  if (request.values && !Array.isArray(request.values)) {
    throw new Error("PostgreSQL provider currently accepts positional parameter arrays only.");
  }

  const timeoutMs = normalizeTimeoutMs(request.timeoutMs);
  throwIfAlreadyAborted(request.signal);

  const client = await queryPool.connect();
  let cancellationSource: CancellationSource | undefined;
  let cancellationDispatch: Promise<void> | undefined;
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

  const requestCancellation = (source: CancellationSource): void => {
    if (cancellationSource) return;
    cancellationSource = source;
    cancellationDispatch = cancelBackend(controlPool, client.processID).catch(() => undefined);
  };

  const abortListener = (): void => requestCancellation("signal");

  try {
    throwIfAlreadyAborted(request.signal);
    request.signal?.addEventListener("abort", abortListener, { once: true });
    if (timeoutMs !== undefined) {
      timeoutHandle = setTimeout(() => requestCancellation("timeout"), timeoutMs);
      timeoutHandle.unref?.();
    }

    const startedAt = new Date();
    const startedMs = Date.now();

    try {
      const result: QueryResult = await client.query({
        text: request.sql,
        ...(request.values ? { values: [...request.values] } : {}),
      });

      if (cancellationSource) {
        await cancellationDispatch;
        throw cancellationError(cancellationSource, timeoutMs, request.signal);
      }

      const finishedAt = new Date();
      return {
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        elapsedMs: Date.now() - startedMs,
        resultSets: [normalizeResult(result)],
      };
    } catch (error) {
      if (cancellationSource) {
        await cancellationDispatch;
        throw cancellationError(cancellationSource, timeoutMs, request.signal, error);
      }
      throw error;
    }
  } finally {
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
    request.signal?.removeEventListener("abort", abortListener);
    client.release();
  }
}

export function normalizeTimeoutMs(timeoutMs: number | undefined): number | undefined {
  if (timeoutMs === undefined) return undefined;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error("PostgreSQL query timeoutMs must be a positive finite number.");
  }
  return Math.ceil(timeoutMs);
}

async function cancelBackend(controlPool: Pool, processId: number): Promise<void> {
  const result = await controlPool.query<{ cancelled: boolean }>(
    "SELECT pg_cancel_backend($1) AS cancelled",
    [processId],
  );
  if (result.rows[0]?.cancelled !== true) {
    throw new Error(`PostgreSQL backend ${processId} was no longer cancellable.`);
  }
}

function throwIfAlreadyAborted(signal: CancellationSignal | undefined): void {
  if (!signal?.aborted) return;
  throw cancellationError("signal", undefined, signal);
}

function cancellationError(
  source: CancellationSource,
  timeoutMs: number | undefined,
  signal: CancellationSignal | undefined,
  cause?: unknown,
): Error {
  const message = source === "timeout"
    ? `PostgreSQL query timed out after ${timeoutMs} ms.`
    : "PostgreSQL query was cancelled.";
  const error = new Error(message, cause !== undefined ? { cause } : undefined);
  if (source === "signal" && signal?.reason !== undefined) {
    Object.defineProperty(error, "reason", { value: signal.reason, enumerable: false });
  }
  return error;
}

function normalizeResult(result: QueryResult): QueryResultSet {
  return {
    columns: result.fields.map((field) => ({ name: field.name, databaseType: String(field.dataTypeID) })),
    rows: result.rows as readonly Readonly<Record<string, unknown>>[],
    ...(result.rowCount !== null ? { affectedRows: result.rowCount } : {}),
    message: result.command,
  };
}
