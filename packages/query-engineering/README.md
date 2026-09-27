# @nublox/workbench-query-engineering

Provider-aware SQL language intelligence for NuBlox SQL Workbench.

The package owns the Workbench-facing contracts for:

- dialect-aware SQL parsing;
- positioned syntax diagnostics;
- statement boundaries;
- SQL entity discovery;
- grammar-aware completion candidates;
- live-catalogue table, view and column completion.

The current dialect implementation is MySQL and is backed by `dt-sql-parser@4.5.1`. Consumers use `createQueryLanguageService(providerId)` rather than importing the parser dependency directly so future provider dialects can be added or the parser implementation can be replaced without changing Monaco or Workbench application code.

The live catalogue is supplied separately through `QueryCompletionCatalog`. Query-engineering does not open database connections and does not depend on a specific database provider implementation.
