import { QueryService, type ConnectionManager } from "@nublox/workbench-core";
import type {
  DatabaseMigrationPreview,
  DatabaseViewChangePlan,
  DatabaseViewDefinition,
  DatabaseViewProvider,
} from "@nublox/workbench-provider-api";

import type {
  ViewExecuteRequest,
  ViewExecutionResult,
  ViewLoadRequest,
  ViewPreparedPreview,
  ViewPreviewRequest,
} from "../lib/desktop-api.js";
import {
  assertViewExecutionGuard,
  VIEW_CONFIRMATION,
  viewExecutionFingerprint,
} from "./view-execution-guard.js";

export class DesktopViewService {
  readonly #queries: QueryService;

  constructor(readonly connections: ConnectionManager) {
    this.#queries = new QueryService(connections);
  }

  async load(request: ViewLoadRequest): Promise<DatabaseViewDefinition> {
    const { viewEngineering, session } = this.#viewProvider(request.connectionId);
    return viewEngineering.load(session, reference(request));
  }

  async preview(request: ViewPreviewRequest): Promise<ViewPreparedPreview> {
    const prepared = await this.#prepare(request);
    return {
      live: prepared.live,
      draft: request.draft,
      preview: prepared.preview,
      guard: {
        fingerprint: viewExecutionFingerprint(request.connectionId, prepared.live, request.draft, prepared.preview),
        confirmationPhrase: VIEW_CONFIRMATION,
      },
    };
  }

  async execute(request: ViewExecuteRequest): Promise<ViewExecutionResult> {
    const prepared = await this.#prepare(request);
    const fingerprint = viewExecutionFingerprint(request.connectionId, prepared.live, request.draft, prepared.preview);
    assertViewExecutionGuard(fingerprint, request.fingerprint, request.confirmation);

    const statements = prepared.preview.statements;
    let executedStatements = 0;
    for (let index = 0; index < statements.length; index += 1) {
      try {
        await this.#queries.execute(request.connectionId, { sql: statements[index]!, mode: "text" });
        executedStatements += 1;
      } catch (error) {
        return {
          completed: false,
          executedStatements,
          totalStatements: statements.length,
          failedStatementIndex: index,
          error: error instanceof Error ? error.message : String(error),
          ...(await this.#safeReload(request)),
        };
      }
    }

    return {
      completed: true,
      executedStatements,
      totalStatements: statements.length,
      ...(await this.#safeReload(request)),
    };
  }

  async #prepare(request: ViewPreviewRequest): Promise<{
    live: DatabaseViewDefinition;
    preview: DatabaseMigrationPreview;
  }> {
    const { viewEngineering, session } = this.#viewProvider(request.connectionId);
    const live = await viewEngineering.load(session, reference(request));
    assertDraftIdentity(live, request.draft);
    const preview = viewEngineering.preview(request.draft);
    return { live, preview };
  }

  #viewProvider(connectionId: string): {
    viewEngineering: DatabaseViewProvider;
    session: ReturnType<ConnectionManager["get"]>["session"];
  } {
    const { provider, session } = this.connections.get(connectionId);
    if (!provider.capabilities.viewDefinitionEditing || !provider.viewEngineering) {
      throw new Error(`Database provider '${provider.id}' does not support view definition engineering.`);
    }
    return { viewEngineering: provider.viewEngineering, session };
  }

  async #safeReload(request: ViewLoadRequest): Promise<{ refreshedView?: DatabaseViewDefinition }> {
    try {
      return { refreshedView: await this.load(request) };
    } catch {
      return {};
    }
  }
}

function reference(request: ViewLoadRequest) {
  return {
    ...(request.catalog ? { catalog: request.catalog } : {}),
    ...(request.schema ? { schema: request.schema } : {}),
    name: request.name,
  };
}

function assertDraftIdentity(live: DatabaseViewDefinition, draft: DatabaseViewChangePlan): void {
  if (live.name !== draft.name || live.catalog !== draft.catalog || live.schema !== draft.schema) {
    throw new Error("View draft identity does not match the selected live view.");
  }
}
