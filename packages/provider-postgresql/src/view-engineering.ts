import type {
  DatabaseMigrationPreview,
  DatabaseProvider,
  DatabaseSession,
  DatabaseViewAlgorithm,
  DatabaseViewChangePlan,
  DatabaseViewCheckOption,
  DatabaseViewDefinition,
  DatabaseViewProvider,
  ExplorerObjectReference,
} from "@nublox/workbench-provider-api";

type ViewHost = Pick<DatabaseProvider, "execute" | "quoteIdentifier">;
type Row = Readonly<Record<string, unknown>>;

export class PostgreSqlViewEngineeringProvider implements DatabaseViewProvider {
  readonly providerId = "postgresql";

  constructor(readonly host: ViewHost) {}

  async load(session: DatabaseSession, view: ExplorerObjectReference): Promise<DatabaseViewDefinition> {
    const schema = requireName(view.schema ?? "", "Schema");
    const name = requireName(view.name, "View name");
    const details = await this.host.execute(session, {
      mode: "text",
      sql: VIEW_DETAIL_SQL,
      values: [schema, name],
    });
    const row = details.resultSets[0]?.rows[0];
    if (!row) throw new Error(`PostgreSQL view '${schema}.${name}' does not exist or is not visible.`);

    return {
      schema,
      name,
      selectSql: requireName(stringValue(row, "definition"), "View definition"),
      algorithm: "undefined",
      ...(optionalString(row, "owner") ? { definer: optionalString(row, "owner")! } : {}),
      securityType: booleanValue(row, "securityInvoker") ? "invoker" : "definer",
      checkOption: parseCheckOption(stringValue(row, "checkOption")),
      ...(optionalString(row, "isUpdatable") ? { updatable: optionalString(row, "isUpdatable")!.toUpperCase() === "YES" } : {}),
    };
  }

  preview(plan: DatabaseViewChangePlan): DatabaseMigrationPreview {
    const schema = requireName(plan.schema ?? "", "Schema");
    const name = requireName(plan.name, "View name");
    const selectSql = normalizedDefinition(plan.selectSql);
    const options = plan.securityType === "invoker" ? " WITH (security_invoker = true)" : "";
    const check = renderCheckOption(plan.checkOption);
    const statement = `CREATE OR REPLACE VIEW ${qualified(this.host, schema, name)}${options} AS ${selectSql}${check};`;
    const warnings: string[] = [];

    if (plan.algorithm !== "undefined") {
      warnings.push(`PostgreSQL does not support the '${renderAlgorithm(plan.algorithm)}' view algorithm; the algorithm setting is ignored.`);
    }
    if (plan.catalog) {
      warnings.push("PostgreSQL database/catalog qualifiers are not emitted in view DDL because cross-database object qualification is not supported.");
    }

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

function qualified(host: ViewHost, schema: string, name: string): string {
  return `${host.quoteIdentifier(schema)}.${host.quoteIdentifier(name)}`;
}

function parseCheckOption(value: string): DatabaseViewCheckOption {
  const normalized = value.trim().toUpperCase();
  if (normalized === "CASCADED") return "cascaded";
  if (normalized === "LOCAL") return "local";
  return "none";
}

function renderCheckOption(value: DatabaseViewCheckOption): string {
  if (value === "cascaded") return " WITH CASCADED CHECK OPTION";
  if (value === "local") return " WITH LOCAL CHECK OPTION";
  return "";
}

function renderAlgorithm(value: DatabaseViewAlgorithm): string {
  if (value === "merge") return "merge";
  if (value === "temptable") return "temptable";
  return "undefined";
}

function stringValue(row: Row | undefined, key: string): string {
  const value = row?.[key];
  return value === null || value === undefined ? "" : String(value);
}

function optionalString(row: Row | undefined, key: string): string | undefined {
  const value = stringValue(row, key).trim();
  return value || undefined;
}

function booleanValue(row: Row | undefined, key: string): boolean {
  const value = row?.[key];
  return value === true || value === "true" || value === "t" || value === 1;
}

function requireName(value: string, label: string): string {
  const result = value.trim();
  if (!result) throw new Error(`${label} cannot be empty.`);
  return result;
}

const VIEW_DETAIL_SQL = `
SELECT
  pg_get_viewdef(c.oid, true) AS definition,
  COALESCE(v.check_option, 'NONE') AS "checkOption",
  COALESCE(v.is_updatable, 'NO') AS "isUpdatable",
  pg_get_userbyid(c.relowner) AS owner,
  COALESCE(array_position(c.reloptions, 'security_invoker=true') IS NOT NULL, false) AS "securityInvoker"
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN information_schema.views v
  ON v.table_schema = n.nspname
 AND v.table_name = c.relname
WHERE c.relkind = 'v'
  AND n.nspname = $1
  AND c.relname = $2
`;
