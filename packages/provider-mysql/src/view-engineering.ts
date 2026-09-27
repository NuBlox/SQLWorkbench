import type {
  DatabaseMigrationPreview,
  DatabaseProvider,
  DatabaseSession,
  DatabaseViewAlgorithm,
  DatabaseViewChangePlan,
  DatabaseViewCheckOption,
  DatabaseViewDefinition,
  DatabaseViewProvider,
  DatabaseViewSecurityType,
  ExplorerObjectReference,
} from "@nublox/workbench-provider-api";

type ViewHost = Pick<DatabaseProvider, "execute" | "quoteIdentifier">;

type Row = Readonly<Record<string, unknown>>;

export class MySqlViewEngineeringProvider implements DatabaseViewProvider {
  readonly providerId = "mysql";

  constructor(readonly host: ViewHost) {}

  async load(session: DatabaseSession, view: ExplorerObjectReference): Promise<DatabaseViewDefinition> {
    const catalog = requireName(view.catalog ?? view.schema ?? "", "Catalog");
    const name = requireName(view.name, "View name");
    const details = await this.host.execute(session, {
      mode: "text",
      sql: VIEW_DETAIL_SQL,
      values: [catalog, name],
    });
    const row = details.resultSets[0]?.rows[0];
    if (!row) throw new Error(`MySQL view '${catalog}.${name}' does not exist or is not visible.`);

    const showCreate = await this.host.execute(session, {
      mode: "text",
      sql: `SHOW CREATE VIEW ${qualified(this.host, catalog, name)}`,
    });
    const createRow = showCreate.resultSets[0]?.rows[0];
    const createSql = stringValue(createRow, "Create View");

    return {
      catalog,
      name,
      selectSql: requireName(stringValue(row, "definition"), "View definition"),
      algorithm: parseAlgorithm(createSql),
      ...(optionalString(row, "definer") ? { definer: optionalString(row, "definer")! } : {}),
      securityType: parseSecurityType(stringValue(row, "securityType")),
      checkOption: parseCheckOption(stringValue(row, "checkOption")),
      ...(optionalString(row, "isUpdatable") ? { updatable: optionalString(row, "isUpdatable")!.toUpperCase() === "YES" } : {}),
    };
  }

  preview(plan: DatabaseViewChangePlan): DatabaseMigrationPreview {
    const catalog = requireName(plan.catalog ?? plan.schema ?? "", "Catalog");
    const name = requireName(plan.name, "View name");
    const selectSql = normalizedDefinition(plan.selectSql);
    const algorithm = renderAlgorithm(plan.algorithm);
    const security = renderSecurityType(plan.securityType);
    const check = renderCheckOption(plan.checkOption);
    const definer = renderDefiner(plan.definer);
    const statement = `ALTER ALGORITHM = ${algorithm}${definer ? ` DEFINER = ${definer}` : ""} SQL SECURITY ${security} VIEW ${qualified(this.host, catalog, name)} AS ${selectSql}${check};`;
    const warnings: string[] = [];
    if (!definer && plan.definer) warnings.push("The live view definer was not emitted because it was not in a safe MySQL account format. Applying this preview would use the executing account as definer.");
    return {
      providerId: this.providerId,
      statements: [statement],
      destructive: false,
      warnings,
    };
  }
}

function normalizedDefinition(value: string): string {
  let sql = requireName(value, "View definition");
  while (sql.endsWith(";")) sql = sql.slice(0, -1).trimEnd();
  if (!/^(SELECT|WITH|TABLE|VALUES)\b/iu.test(sql)) {
    throw new Error("View definition must begin with SELECT, WITH, TABLE or VALUES.");
  }
  return sql;
}

function qualified(host: ViewHost, catalog: string, name: string): string {
  return `${host.quoteIdentifier(catalog)}.${host.quoteIdentifier(name)}`;
}

function renderDefiner(value: string | undefined): string | undefined {
  const candidate = value?.trim();
  if (!candidate) return undefined;
  if (/^'(?:''|[^'])*'@'(?:''|[^'])*'$/u.test(candidate)) return candidate;
  if (/^CURRENT_USER(?:\(\))?$/iu.test(candidate)) return candidate.toUpperCase();
  return undefined;
}

function parseAlgorithm(createSql: string): DatabaseViewAlgorithm {
  const match = /\bALGORITHM\s*=\s*(UNDEFINED|MERGE|TEMPTABLE)\b/iu.exec(createSql);
  const value = match?.[1]?.toLowerCase();
  if (value === "merge" || value === "temptable") return value;
  return "undefined";
}

function parseSecurityType(value: string): DatabaseViewSecurityType {
  return value.trim().toUpperCase() === "INVOKER" ? "invoker" : "definer";
}

function parseCheckOption(value: string): DatabaseViewCheckOption {
  const normalized = value.trim().toUpperCase();
  if (normalized === "CASCADED") return "cascaded";
  if (normalized === "LOCAL") return "local";
  return "none";
}

function renderAlgorithm(value: DatabaseViewAlgorithm): string {
  if (value === "merge") return "MERGE";
  if (value === "temptable") return "TEMPTABLE";
  return "UNDEFINED";
}

function renderSecurityType(value: DatabaseViewSecurityType): string {
  return value === "invoker" ? "INVOKER" : "DEFINER";
}

function renderCheckOption(value: DatabaseViewCheckOption): string {
  if (value === "cascaded") return " WITH CASCADED CHECK OPTION";
  if (value === "local") return " WITH LOCAL CHECK OPTION";
  return "";
}

function stringValue(row: Row | undefined, key: string): string {
  const value = row?.[key];
  return value === null || value === undefined ? "" : String(value);
}

function optionalString(row: Row | undefined, key: string): string | undefined {
  const value = stringValue(row, key).trim();
  return value || undefined;
}

function requireName(value: string, label: string): string {
  const result = value.trim();
  if (!result) throw new Error(`${label} cannot be empty.`);
  return result;
}

const VIEW_DETAIL_SQL = `SELECT VIEW_DEFINITION AS definition, CHECK_OPTION AS checkOption, IS_UPDATABLE AS isUpdatable, DEFINER AS definer, SECURITY_TYPE AS securityType FROM INFORMATION_SCHEMA.VIEWS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`;
