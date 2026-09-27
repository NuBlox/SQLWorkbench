# Architecture Overview

## Product boundary

NuBlox SQL Workbench is an application product. It must orchestrate database drivers and metadata packages rather than absorb their responsibilities.

```text
Desktop / future web surfaces
          |
          v
  Workbench application services
          |
          +--> connection lifecycle
          +--> SQL execution
          +--> catalogue/introspection
          +--> schema engineering
          +--> migration workflows
          +--> data transfer
          +--> administration
          |
          v
  DatabaseProvider contract
          |
   +------+------+---------+
   |             |         |
 MySQL       PostgreSQL   ...
   |
@nublox/mysql
```

## Architectural rules

1. `@nublox/workbench-core` depends only on provider and catalogue abstractions.
2. Vendor-specific SQL and metadata queries stay inside provider packages.
3. The normalized catalogue is immutable application data, not a database-driver result shape.
4. Provider capabilities determine which Workbench commands are enabled.
5. Credentials are passed to providers only when connecting; persistent credential storage belongs to the future desktop security service.
6. SQL execution and metaobject persistence are separate concerns.
7. `@nublox/metaobject` remains database-neutral. Workbench integration happens through a bridge package rather than by adding Workbench concepts to metaobject.

## Initial package graph

```text
@nublox/workbench-catalog
          ^
          |
@nublox/workbench-provider-api
          ^
          |
@nublox/workbench-core

@nublox/workbench-provider-mysql
      |             |
      v             v
provider-api    @nublox/mysql
```

## Next application layer

The desktop application will sit above these packages and provide:

- connection profiles and secure secret storage;
- database explorer;
- Monaco SQL editor;
- result grids;
- query history;
- explain-plan viewer;
- table/view/routine editors;
- schema designer and diff/migration surfaces.
