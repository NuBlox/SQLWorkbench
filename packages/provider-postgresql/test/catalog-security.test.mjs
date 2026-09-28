import assert from "node:assert/strict";
import test from "node:test";
import {
  POSTGRESQL_FOREIGN_KEYS_SQL,
  POSTGRESQL_PRINCIPALS_SQL,
  POSTGRESQL_PRIVILEGES_SQL,
  POSTGRESQL_ROLE_GRANTS_SQL,
  POSTGRESQL_ROUTINES_SQL,
  POSTGRESQL_SEARCH_SQL,
  POSTGRESQL_TRIGGERS_SQL,
  mapPostgreSqlPrincipals,
  mapPostgreSqlPrivileges,
  mapPostgreSqlRoleGrants,
  mapPostgreSqlRoutines,
  mapPostgreSqlSearchResults,
  mapPostgreSqlTriggers,
  normalizePostgreSqlSearchLimit,
  postgreSqlSearchPattern,
} from "../dist/catalog-security.js";

test("maps PostgreSQL routines into the normalized catalog model", () => {
  const mapped = mapPostgreSqlRoutines([
    {
      schemaName: "public",
      routineName: "refresh_orders",
      routineType: "PROCEDURE",
      dataType: null,
      definition: "BEGIN NULL; END",
      securityType: "DEFINER",
      deterministic: "NO",
    },
    {
      schemaName: "reporting",
      routineName: "net_total",
      routineType: "FUNCTION",
      dataType: "numeric",
      definition: "SELECT 1::numeric",
      securityType: "INVOKER",
      deterministic: "YES",
    },
  ]);

  assert.equal(mapped[0].kind, "procedure");
  assert.equal(mapped[0].schema, "public");
  assert.equal(mapped[1].kind, "function");
  assert.equal(mapped[1].dataType, "numeric");
  assert.equal(mapped[1].deterministic, true);
});

test("maps triggers with table, event and timing", () => {
  const [trigger] = mapPostgreSqlTriggers([
    {
      schemaName: "public",
      triggerName: "orders_audit",
      tableName: "orders",
      event: "UPDATE",
      timing: "AFTER",
      statement: "EXECUTE FUNCTION audit_orders()",
    },
  ]);

  assert.deepEqual(trigger, {
    schema: "public",
    name: "orders_audit",
    kind: "trigger",
    table: "orders",
    event: "UPDATE",
    timing: "AFTER",
    statement: "EXECUTE FUNCTION audit_orders()",
  });
});

test("distinguishes login principals from group roles", () => {
  assert.deepEqual(
    mapPostgreSqlPrincipals([
      { roleName: "stephen", canLogin: true },
      { roleName: "reporting_read", canLogin: false },
    ]),
    [
      { grantee: "stephen", name: "stephen", kind: "user" },
      { grantee: "reporting_read", name: "reporting_read", kind: "role" },
    ],
  );
});

test("maps role grants and table/column privileges", () => {
  assert.deepEqual(
    mapPostgreSqlRoleGrants([{ grantee: "stephen", role: "reporting_read", grantable: false }]),
    [{ grantee: "stephen", role: "reporting_read", grantable: false }],
  );

  assert.deepEqual(
    mapPostgreSqlPrivileges([
      {
        grantee: "reporting_read",
        privilege: "SELECT",
        scope: "table",
        schemaName: "reporting",
        tableName: "orders",
        columnName: null,
        grantable: false,
      },
      {
        grantee: "analyst",
        privilege: "UPDATE",
        scope: "column",
        schemaName: "public",
        tableName: "orders",
        columnName: "status",
        grantable: true,
      },
    ]),
    [
      {
        grantee: "reporting_read",
        privilege: "SELECT",
        scope: "table",
        schema: "reporting",
        table: "orders",
        grantable: false,
      },
      {
        grantee: "analyst",
        privilege: "UPDATE",
        scope: "column",
        schema: "public",
        table: "orders",
        column: "status",
        grantable: true,
      },
    ],
  );
});

test("maps search rows and clamps search limits", () => {
  assert.deepEqual(
    mapPostgreSqlSearchResults([
      { schemaName: "public", objectName: "orders", objectKind: "table" },
      { schemaName: "public", objectName: "orders_audit", objectKind: "trigger" },
    ]),
    [
      { schema: "public", name: "orders", kind: "table" },
      { schema: "public", name: "orders_audit", kind: "trigger" },
    ],
  );

  assert.equal(normalizePostgreSqlSearchLimit(), 100);
  assert.equal(normalizePostgreSqlSearchLimit(0), 1);
  assert.equal(normalizePostgreSqlSearchLimit(25.8), 25);
  assert.equal(normalizePostgreSqlSearchLimit(9999), 500);
});

test("escapes PostgreSQL LIKE metacharacters for object search", () => {
  assert.equal(postgreSqlSearchPattern(" order_% "), "%order\\_\\%%");
});

test("catalog queries use PostgreSQL-native metadata and ordinal foreign-key pairing", () => {
  assert.match(POSTGRESQL_ROUTINES_SQL, /information_schema\.routines/);
  assert.match(POSTGRESQL_TRIGGERS_SQL, /information_schema\.triggers/);
  assert.match(POSTGRESQL_PRINCIPALS_SQL, /pg_catalog\.pg_roles/);
  assert.match(POSTGRESQL_ROLE_GRANTS_SQL, /pg_catalog\.pg_auth_members/);
  assert.match(POSTGRESQL_PRIVILEGES_SQL, /role_table_grants/);
  assert.match(POSTGRESQL_PRIVILEGES_SQL, /role_column_grants/);
  assert.match(POSTGRESQL_SEARCH_SQL, /pg_catalog\.pg_proc/);
  assert.match(POSTGRESQL_SEARCH_SQL, /pg_catalog\.pg_trigger/);
  assert.match(POSTGRESQL_FOREIGN_KEYS_SQL, /WITH ORDINALITY/);
  assert.match(POSTGRESQL_FOREIGN_KEYS_SQL, /target_columns\.ordinality = source_columns\.ordinality/);
});
