# @nublox/workbench-query-engineering

Provider-aware SQL language intelligence for NuBlox SQL Workbench.

The package owns the Workbench-facing contracts for:

- dialect-aware SQL parsing;
- positioned syntax diagnostics;
- statement boundaries;
- SQL entity discovery;
- grammar-aware completion candidates;
- live-catalogue table, view and column completion.

The current MySQL implementation is backed by `sqllens@1.11.0`, an error-tolerant TypeScript SQL language engine designed for editor use. Consumers use `createQueryLanguageService(providerId)` rather than importing the language engine directly, so future provider dialects can be added or supplemented without changing Monaco or Workbench application code.

`sqllens` currently gives the NuBlox abstraction native paths for MySQL/MariaDB, PostgreSQL, SQLite and T-SQL/SQL Server alongside several analytics dialects. Oracle remains a future provider adapter and is intentionally not claimed by the current implementation.

The live catalogue is supplied separately through `QueryCompletionCatalog`. Query-engineering does not open database connections and does not depend on a specific database provider implementation.
