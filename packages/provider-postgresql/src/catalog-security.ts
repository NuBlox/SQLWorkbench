import type {
  DatabasePrincipal,
  DatabasePrivilege,
  DatabaseSearchResult,
  RoleGrantDefinition,
  RoutineDefinition,
  TriggerDefinition,
} from "@nublox/workbench-catalog";

export interface PostgreSqlRoutineRow {
  readonly schemaName: string;
  readonly routineName: string;
  readonly routineType: string;
  readonly dataType: string | null;
  readonly definition: string | null;
  readonly securityType: string | null;
  readonly deterministic: string | null;
}

export interface PostgreSqlTriggerRow {
  readonly schemaName: string;
  readonly triggerName: string;
  readonly tableName: string;
  readonly event: string;
  readonly timing: string;
  readonly statement: string | null;
}

export interface PostgreSqlPrincipalRow {
  readonly roleName: string;
  readonly canLogin: boolean;
}

export interface PostgreSqlRoleGrantRow {
  readonly grantee: string;
  readonly role: string;
  readonly grantable: boolean;
}

export interface PostgreSqlPrivilegeRow {
  readonly grantee: string;
  readonly privilege: string;
  readonly scope: "schema" | "table" | "column";
  readonly schemaName: string | null;
  readonly tableName: string | null;
  readonly columnName: string | null;
  readonly grantable: boolean;
}

export interface PostgreSqlSearchRow {
  readonly schemaName: string;
  readonly objectName: string;
  readonly objectKind: "table" | "view" | "procedure" | "function" | "trigger";
}

export const POSTGRESQL_ROUTINES_SQL = `
SELECT
  routine_schema AS "schemaName",
  routine_name AS "routineName",
  routine_type AS "routineType",
  data_type AS "dataType",
  routine_definition AS "definition",
  security_type AS "securityType",
  is_deterministic AS "deterministic"
FROM information_schema.routines
WHERE routine_schema = $1
ORDER BY routine_name, specific_name`;

export const POSTGRESQL_TRIGGERS_SQL = `
SELECT
  trigger_schema AS "schemaName",
  trigger_name AS "triggerName",
  event_object_table AS "tableName",
  event_manipulation AS "event",
  action_timing AS "timing",
  action_statement AS "statement"
FROM information_schema.triggers
WHERE trigger_schema = $1
ORDER BY trigger_name, event_manipulation`;

export const POSTGRESQL_PRINCIPALS_SQL = `
SELECT
  rolname AS "roleName",
  rolcanlogin AS "canLogin"
FROM pg_catalog.pg_roles
ORDER BY rolname`;

export const POSTGRESQL_ROLE_GRANTS_SQL = `
SELECT
  member.rolname AS "grantee",
  granted.rolname AS "role",
  memberships.admin_option AS "grantable"
FROM pg_catalog.pg_auth_members memberships
JOIN pg_catalog.pg_roles granted ON granted.oid = memberships.roleid
JOIN pg_catalog.pg_roles member ON member.oid = memberships.member
ORDER BY member.rolname, granted.rolname`;

export const POSTGRESQL_PRIVILEGES_SQL = `
SELECT
  grantee,
  privilege_type AS "privilege",
  'table'::text AS "scope",
  table_schema AS "schemaName",
  table_name AS "tableName",
  NULL::text AS "columnName",
  (is_grantable = 'YES') AS "grantable"
FROM information_schema.role_table_grants
WHERE ($1::text IS NULL OR grantee = $1)
UNION ALL
SELECT
  grantee,
  privilege_type AS "privilege",
  'column'::text AS "scope",
  table_schema AS "schemaName",
  table_name AS "tableName",
  column_name AS "columnName",
  (is_grantable = 'YES') AS "grantable"
FROM information_schema.role_column_grants
WHERE ($1::text IS NULL OR grantee = $1)
ORDER BY grantee, "scope", "schemaName", "tableName", "columnName", "privilege"`;

export const POSTGRESQL_SEARCH_SQL = `
WITH searchable_objects AS (
  SELECT
    namespace.nspname AS "schemaName",
    class.relname AS "objectName",
    CASE class.relkind
      WHEN 'v' THEN 'view'
      WHEN 'm' THEN 'view'
      ELSE 'table'
    END::text AS "objectKind"
  FROM pg_catalog.pg_class class
  JOIN pg_catalog.pg_namespace namespace ON namespace.oid = class.relnamespace
  WHERE class.relkind IN ('r', 'p', 'v', 'm', 'f')

  UNION ALL

  SELECT
    namespace.nspname AS "schemaName",
    procedure.proname AS "objectName",
    CASE procedure.prokind
      WHEN 'p' THEN 'procedure'
      ELSE 'function'
    END::text AS "objectKind"
  FROM pg_catalog.pg_proc procedure
  JOIN pg_catalog.pg_namespace namespace ON namespace.oid = procedure.pronamespace

  UNION ALL

  SELECT
    namespace.nspname AS "schemaName",
    trigger.tgname AS "objectName",
    'trigger'::text AS "objectKind"
  FROM pg_catalog.pg_trigger trigger
  JOIN pg_catalog.pg_class class ON class.oid = trigger.tgrelid
  JOIN pg_catalog.pg_namespace namespace ON namespace.oid = class.relnamespace
  WHERE NOT trigger.tgisinternal
)
SELECT "schemaName", "objectName", "objectKind"
FROM searchable_objects
WHERE lower("objectName") LIKE lower($1)
  AND ($2::text IS NULL OR "schemaName" = $2)
  AND "schemaName" <> 'information_schema'
  AND "schemaName" !~ '^pg_(catalog|toast)'
ORDER BY "schemaName", "objectKind", "objectName"
LIMIT $3`;

export const POSTGRESQL_FOREIGN_KEYS_SQL = `
SELECT
  source_namespace.nspname AS "schemaName",
  source_table.relname AS "tableName",
  constraint_record.conname AS "constraintName",
  source_columns.ordinality AS "sequence",
  source_attribute.attname AS "columnName",
  target_namespace.nspname AS "referencedSchemaName",
  target_table.relname AS "referencedTableName",
  target_attribute.attname AS "referencedColumnName",
  CASE constraint_record.confupdtype
    WHEN 'a' THEN 'NO ACTION'
    WHEN 'r' THEN 'RESTRICT'
    WHEN 'c' THEN 'CASCADE'
    WHEN 'n' THEN 'SET NULL'
    WHEN 'd' THEN 'SET DEFAULT'
  END AS "updateRule",
  CASE constraint_record.confdeltype
    WHEN 'a' THEN 'NO ACTION'
    WHEN 'r' THEN 'RESTRICT'
    WHEN 'c' THEN 'CASCADE'
    WHEN 'n' THEN 'SET NULL'
    WHEN 'd' THEN 'SET DEFAULT'
  END AS "deleteRule"
FROM pg_catalog.pg_constraint constraint_record
JOIN pg_catalog.pg_class source_table ON source_table.oid = constraint_record.conrelid
JOIN pg_catalog.pg_namespace source_namespace ON source_namespace.oid = source_table.relnamespace
JOIN pg_catalog.pg_class target_table ON target_table.oid = constraint_record.confrelid
JOIN pg_catalog.pg_namespace target_namespace ON target_namespace.oid = target_table.relnamespace
CROSS JOIN LATERAL unnest(constraint_record.conkey) WITH ORDINALITY AS source_columns(attnum, ordinality)
JOIN LATERAL unnest(constraint_record.confkey) WITH ORDINALITY AS target_columns(attnum, ordinality)
  ON target_columns.ordinality = source_columns.ordinality
JOIN pg_catalog.pg_attribute source_attribute
  ON source_attribute.attrelid = source_table.oid
 AND source_attribute.attnum = source_columns.attnum
JOIN pg_catalog.pg_attribute target_attribute
  ON target_attribute.attrelid = target_table.oid
 AND target_attribute.attnum = target_columns.attnum
WHERE constraint_record.contype = 'f'
  AND source_namespace.nspname = ANY($1::text[])
ORDER BY source_namespace.nspname, source_table.relname, constraint_record.conname, source_columns.ordinality`;

export function mapPostgreSqlRoutines(rows: readonly PostgreSqlRoutineRow[]): RoutineDefinition[] {
  return rows.map((row) => ({
    schema: row.schemaName,
    name: row.routineName,
    kind: row.routineType.toUpperCase() === "PROCEDURE" ? "procedure" : "function",
    ...(row.dataType ? { dataType: row.dataType } : {}),
    ...(row.definition ? { definition: row.definition } : {}),
    ...(row.securityType ? { securityType: row.securityType } : {}),
    ...(row.deterministic ? { deterministic: row.deterministic.toUpperCase() === "YES" } : {}),
  }));
}

export function mapPostgreSqlTriggers(rows: readonly PostgreSqlTriggerRow[]): TriggerDefinition[] {
  return rows.map((row) => ({
    schema: row.schemaName,
    name: row.triggerName,
    kind: "trigger",
    table: row.tableName,
    event: row.event,
    timing: row.timing,
    ...(row.statement ? { statement: row.statement } : {}),
  }));
}

export function mapPostgreSqlPrincipals(rows: readonly PostgreSqlPrincipalRow[]): DatabasePrincipal[] {
  return rows.map((row) => ({
    grantee: row.roleName,
    name: row.roleName,
    kind: row.canLogin ? "user" : "role",
  }));
}

export function mapPostgreSqlRoleGrants(rows: readonly PostgreSqlRoleGrantRow[]): RoleGrantDefinition[] {
  return rows.map((row) => ({ grantee: row.grantee, role: row.role, grantable: row.grantable }));
}

export function mapPostgreSqlPrivileges(rows: readonly PostgreSqlPrivilegeRow[]): DatabasePrivilege[] {
  return rows.map((row) => ({
    grantee: row.grantee,
    privilege: row.privilege,
    scope: row.scope,
    ...(row.schemaName ? { schema: row.schemaName } : {}),
    ...(row.tableName ? { table: row.tableName } : {}),
    ...(row.columnName ? { column: row.columnName } : {}),
    grantable: row.grantable,
  }));
}

export function mapPostgreSqlSearchResults(rows: readonly PostgreSqlSearchRow[]): DatabaseSearchResult[] {
  return rows.map((row) => ({
    schema: row.schemaName,
    name: row.objectName,
    kind: row.objectKind,
  }));
}

export function postgreSqlSearchPattern(term: string): string {
  return `%${term.trim().replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
}

export function normalizePostgreSqlSearchLimit(limit?: number): number {
  if (limit === undefined) return 100;
  if (!Number.isFinite(limit)) return 100;
  return Math.max(1, Math.min(500, Math.trunc(limit)));
}
