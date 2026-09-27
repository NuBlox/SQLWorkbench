# Database Personas and Workbench Capabilities

NuBlox SQL Workbench is not a single-purpose SQL editor. It must support the different jobs performed by people who design, build, operate, secure, analyse and govern databases.

Personas in this document drive product navigation, workspace composition and capability priorities. They are **not** an authorization model. Database permissions remain determined by the connected database identity and future enterprise policy controls.

## Primary database-native personas

| Persona | Typical Workbench jobs | Primary capability areas |
| --- | --- | --- |
| Database Administrator (DBA) | monitor servers, manage sessions, configure databases, maintain availability, manage users, backup/restore | server administration, user administration, catalogue, operations |
| Database Developer | develop SQL, views, routines, triggers and database objects | SQL execution, transactions, catalogue, schema engineering |
| SQL Developer | author, execute, debug and optimise SQL | execution, transactions, cancellation, explain plans, results |
| Database Engineer | automate and operate database platforms | connection lifecycle, administration, migrations, diagnostics |
| Database Architect | define physical database architecture, standards and topology | catalogue, schema modelling, DDL, migrations |
| Data Architect | define enterprise data structures, domains and canonical models | metadata modelling, catalogue, relationships, schema evolution |
| Data Modeller | create conceptual, logical and physical data models | modelling, reverse engineering, relationships, schema generation |
| Data Engineer | ingest, transform, query and move data | execution, transactions, import/export, data transfer |
| Database Reliability Engineer (DBRE) | improve reliability, resilience and operational automation | health, sessions, diagnostics, cancellation, performance, backup/restore |
| Database Security Administrator | manage database identities, roles, grants and security configuration | user administration, privileges, connection security, audit |
| Database Performance Engineer | diagnose workload and query-performance problems | explain plans, sessions, indexes, server metrics, configuration |
| Database Migration Engineer | plan and execute schema/data migrations | catalogue, schema diff, DDL, migration execution, data transfer |
| Database Support Engineer | diagnose database/application incidents | health, execution, catalogue, sessions, server status |
| Database Consultant | assess, design, migrate, troubleshoot and optimise estates | broad cross-domain capability set |
| Database Engine/Kernel Engineer | inspect engine-specific behaviour and internals | advanced diagnostics and provider-specific extensions |

## Database-consuming personas

The Workbench should also serve users for whom the database is an important tool rather than their primary profession:

- application, backend, full-stack and software developers;
- analytics engineers, ETL/ELT developers and data warehouse developers;
- BI developers, reporting developers and data analysts;
- data scientists and machine-learning engineers;
- platform engineers, DevOps engineers and SREs;
- infrastructure and cloud engineers;
- security engineers and auditors;
- data stewards, metadata specialists and data-governance teams.

These personas generally need narrower task surfaces than a DBA. The product should provide focused workspaces without hiding capabilities that the connected identity is permitted to use.

## Current provider capability model

The current `DatabaseCapabilities` contract already exposes the following engine-neutral feature flags:

| Provider capability | Personas that depend on it most |
| --- | --- |
| `catalogIntrospection` | DBA, developer, architect, modeller, data engineer, support |
| `schemas` | architect, developer, modeller, data engineer |
| `views` | developer, analyst, data engineer, architect |
| `indexes` | DBA, performance engineer, developer, architect |
| `foreignKeys` | architect, modeller, developer, migration engineer |
| `procedures` | database developer, DBA, support |
| `functions` | database developer, SQL developer, analyst |
| `triggers` | database developer, DBA, support |
| `partitions` | DBA, architect, performance engineer |
| `transactions` | SQL developer, database developer, data engineer |
| `savepoints` | SQL developer, database developer, migration engineer |
| `explainPlan` | performance engineer, SQL developer, DBA |
| `queryCancellation` | developer, analyst, DBA, DBRE, support |
| `serverAdministration` | DBA, DBRE, database engineer, support |
| `userAdministration` | DBA, database security administrator, auditor |

The UI must continue to gate engine-specific features through provider capabilities rather than checks such as `providerId === "mysql"`.

## Product capability domains

### Connection and session management

- saved connection profiles;
- secure credential storage;
- connection testing and health checks;
- multiple simultaneous sessions;
- session lifecycle and reconnection;
- server identity and session properties.

### SQL development

- multi-tab editor;
- execute statement, selection or script;
- bind parameters;
- transactions and savepoints;
- query cancellation and timeout handling;
- query history and snippets;
- formatting, completion and diagnostics;
- result grids and result export;
- execution timings and messages.

### Database exploration

- servers, catalogues and schemas;
- tables and views;
- columns, indexes and constraints;
- foreign-key relationships;
- procedures, functions, triggers and events;
- partitions;
- object search and dependency navigation;
- generated DDL.

### Data operations

- browse, filter and sort table data;
- safe row editing;
- inserts, updates and deletes;
- import/export;
- data comparison and transfer;
- data sampling and generation.

### Schema engineering

- create/alter/drop workflows;
- visual object editors;
- ER modelling;
- schema comparison;
- DDL preview;
- migration planning and execution;
- rollback planning;
- dependency analysis.

### Performance engineering

- explain-plan visualisation;
- active sessions and statements;
- locks and waits;
- index analysis;
- server variables/status;
- workload diagnostics;
- query statistics and plan history.

### Administration and operations

- sessions/processes;
- server configuration;
- users, roles and privileges;
- storage and capacity;
- maintenance operations;
- backup and restore;
- import/export and transfer operations.

### Metadata-driven modelling

The Workbench should integrate `@nublox/metaobject` through the planned bridge for:

- object-type definitions;
- attributes and relationships;
- validation and constraints;
- reverse engineering physical schemas into logical metadata;
- forward engineering logical metadata into schema plans;
- semantic schema comparison;
- governed schema evolution;
- reproducible generated artifacts.

## Persona-oriented workspace direction

The eventual application shell should support task-oriented workspaces that compose the same underlying provider capabilities differently:

| Workspace | Default emphasis |
| --- | --- |
| Developer | editor, object explorer, results, history, explain |
| DBA | health, sessions, configuration, security, storage, maintenance |
| Architect / Modeller | catalogue, diagrams, metadata, comparison, migrations |
| Data Engineer | query, transformation, import/export, transfer |
| Analyst | query, browse, results, export |
| Security / Governance | users, privileges, metadata, lineage and audit-oriented views |

A person may use multiple workspaces. Workspace selection is a UX preference, not a job-title restriction.

## Capability gaps to model explicitly

The existing provider API is sufficient for the current foundation, but later milestones should add capability contracts for areas that cannot be represented precisely today, including:

- session/process inspection;
- locks and wait diagnostics;
- server status and configuration editing;
- roles, grants and fine-grained privilege administration;
- storage/capacity inspection;
- backup and restore;
- import/export and data transfer;
- schema mutation and migration execution;
- data editing;
- routine/trigger mutation;
- audit/observability features;
- provider-specific advanced diagnostics.

These should be introduced as explicit provider contracts or capability groups as their implementation milestones begin, rather than as MySQL-specific branches in the application layer.

## Design rules

1. Design around jobs-to-be-done, not one generic database user.
2. Keep persona/workspace selection separate from authorization.
3. Enable features from provider capabilities, not provider-name conditionals.
4. Keep database-specific implementation inside provider packages.
5. Keep physical database metadata distinct from `@nublox/metaobject` logical metadata while providing deliberate transformation bridges.
6. Add capability flags only when the associated contract and behaviour are defined clearly enough for multiple providers to implement consistently.
