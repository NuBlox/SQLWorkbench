import type { ConnectionManager } from "@nublox/workbench-core";
import type {
  DatabaseAdministrationProvider,
  DatabaseServerSession,
  DatabaseServerStatus,
  DatabaseServerVariable,
  DatabaseSession,
} from "@nublox/workbench-provider-api";

export class DesktopAdministrationService {
  constructor(private readonly connections: ConnectionManager) {}

  listSessions(connectionId: string): Promise<readonly DatabaseServerSession[]> {
    const { administration, session } = this.#require(connectionId, "sessions");
    return administration.listSessions(session);
  }

  listVariables(connectionId: string, filter?: string): Promise<readonly DatabaseServerVariable[]> {
    const { administration, session } = this.#require(connectionId, "serverVariables");
    return administration.listServerVariables(session, normalizeFilter(filter));
  }

  listStatus(connectionId: string, filter?: string): Promise<readonly DatabaseServerStatus[]> {
    const { administration, session } = this.#require(connectionId, "serverStatus");
    return administration.listServerStatus(session, normalizeFilter(filter));
  }

  #require(
    connectionId: string,
    capability: "sessions" | "serverVariables" | "serverStatus",
  ): { administration: DatabaseAdministrationProvider; session: DatabaseSession } {
    const normalized = connectionId.trim();
    if (!normalized) throw new Error("Connection id cannot be empty.");
    const { provider, session } = this.connections.get(normalized);
    const administration = provider.administration;
    if (!administration || !administration.capabilities[capability]) {
      throw new Error(`Database provider '${provider.id}' does not support administration capability '${capability}'.`);
    }
    return { administration, session };
  }
}

function normalizeFilter(filter?: string): string | undefined {
  const value = filter?.trim();
  if (!value) return undefined;
  if (value.length > 200) throw new Error("Administration filter cannot exceed 200 characters.");
  return value;
}
