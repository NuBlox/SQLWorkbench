# ADR 0001: SQL Workbench is a separate product

- Status: Accepted
- Date: 2026-09-27

## Decision

NuBlox SQL Workbench lives in `NuBlox/SQLWorkbench` rather than inside `NuBloxSQL` or `metaobject`.

`NuBloxSQL` remains a database driver/package. `metaobject` remains an application-agnostic metadata runtime. Workbench consumes both through explicit integration boundaries.

## Consequences

- Driver releases can evolve independently of desktop/application releases.
- Metaobject remains usable by applications that have no Workbench dependency.
- Workbench can support multiple database engines without forcing those drivers into one repository.
- Integration compatibility must be pinned and tested explicitly.
