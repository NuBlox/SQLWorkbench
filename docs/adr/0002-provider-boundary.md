# ADR 0002: Database access uses capability-driven providers

- Status: Accepted
- Date: 2026-09-27

## Decision

All database-specific connectivity, introspection, execution, explain-plan behaviour and identifier quoting lives behind `DatabaseProvider`.

Workbench core must not import `@nublox/mysql` or any future PostgreSQL, SQLite, SQL Server or Oracle driver.

## Consequences

The initial MySQL implementation can exploit NuBloxSQL-specific resilience and observability while the application core remains portable. New engines are added as packages implementing the same contract.
