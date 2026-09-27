# Metaobject Bridge

M3 introduces a one-way dependency from NuBlox SQL Workbench to the standalone [`@nublox/metaobject`](https://github.com/NuBlox/metaobject) package. Metaobject remains database-neutral and does not depend on Workbench, NuBloxSQL or a database driver.

## Responsibilities

`@nublox/workbench-metaobject-bridge` translates the normalized physical catalogue into logical metaobject drafts and retains a separate physical mapping for round-trip fidelity.

The bridge is responsible for:

- converting physical tables and views to `ObjectTypeDefinition` drafts;
- mapping columns to native metaobject attribute types;
- mapping foreign keys to metaobject relationships;
- mapping non-primary physical indexes to logical metaobject indexes;
- retaining exact database names and physical type information outside the logical definition;
- comparing a live physical table with an evolved logical draft;
- producing provider-neutral reconciliation operations.

It is not responsible for emitting MySQL, PostgreSQL, SQL Server or Oracle DDL. That belongs to provider-specific migration adapters.

## Type mapping

The bridge deliberately uses conservative mappings. In particular, SQL `BIGINT` is represented as a metaobject `string` because the current metaobject integer type requires a JavaScript safe integer. Exact SQL type information remains available in the physical mapping.

Representative mappings:

| Database family | Metaobject type |
| --- | --- |
| boolean / `TINYINT(1)` | `boolean` |
| small/medium/int | `integer` |
| bigint/serial | `string` |
| decimal/numeric | `decimal` |
| float/double/real | `number` |
| date | `date` |
| datetime/timestamp | `datetime` |
| JSON | `json` |
| binary/blob | `binary` |
| other textual/domain-specific values | `string` |

## Physical mapping

Every draft carries a `PhysicalObjectMapping` independently of `ObjectTypeDefinition`. This preserves:

- catalogue and schema;
- physical table/view name;
- physical column name, ordinal, database type, default and generated/autoincrement state;
- primary-key columns;
- physical index names and columns;
- foreign-key names, source columns, referenced object/columns and update/delete rules.

Logical names can therefore be improved without throwing away the information required to reconcile back to the database.

## Relationships

Foreign keys become associations. A foreign-key column set covered exactly by a unique index is inferred as `one-to-one`; other foreign keys are `many-to-one`. Non-null source columns make the relationship required. Physical delete behaviour maps to metaobject referential actions:

- `CASCADE` -> `cascade`;
- `RESTRICT` / `NO ACTION` -> `restrict`;
- `SET NULL`, `SET DEFAULT` or an unknown rule -> `detach`.

## Drift and reconciliation

`compareTableToMetaobject` identifies structural drift between a live physical table and a logical draft. The initial comparison surface covers:

- missing logical attributes / physical columns;
- type and nullability mismatches;
- missing logical relationships / physical foreign keys;
- missing logical / physical indexes.

`generateSchemaChangePlan` converts those differences into database-neutral operations: add/drop/alter column, add/drop foreign key and create/drop index. Operations that remove data structures or tighten/replace types are explicitly marked destructive.

The remaining M3 provider-handoff step converts these neutral operations into provider-specific migration previews. Guarded execution remains an M4 concern.
