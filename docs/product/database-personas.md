# Database Personas and Workbench Capabilities

The SQL Workbench is designed around database jobs-to-be-done rather than a single generic SQL-editor persona. These personas guide navigation, workflows and capability priorities; they are not an authorization model. Runtime authorization must still reflect the connected database account and enterprise policy.

## Primary database-native personas

| Persona | Typical jobs in the Workbench | Priority capability areas |
| --- | --- | --- |
| Database Administrator (DBA) | configure, monitor, secure, back up, restore, diagnose and maintain databases | administration, sessions, users, privileges, storage, backup/restore |
| Database Developer | create SQL, views, routines, triggers and database objects | SQL execution, schema DDL, routines, data edit |
| SQL Developer | author, execute, debug and optimise SQL | SQL execution, transactions, explain, result tooling |
| Database Engineer | automate and operate database platforms | connections, administration, migrations, diagnostics |
| Database Architect | define database structures, standards and topology | modelling, schema introspection, DDL, migrations |
| Data Architect | define data domains, canonical structures and information architecture | modelling, introspection, metadata, schema evolution |
| Data Modeller | build conceptual, logical and physical models | metadata modelling, schema generation, reverse engineering |
| Data Engineer | ingest, transform and move data | SQL execution, import/export, data browse, migrations |
| Database Reliability Engineer (DBRE) | improve reliability, resilience and operational automation | sessions, diagnostics, storage, backup/restore, performance |
| Database Security Administrator | manage identities, privileges and database security | users, privileges, connection security, audit surfaces |
| Database Performance Engineer | analyse expensive workloads and tune performance | explain, sessions, variables, schema/index inspection |
| Database Migration Engineer | plan and execute schema/data migrations | introspection, schema DDL, migrations, import/export |
| Database Support Engineer | diagnose database and application incidents | query execution, introspection, sessions, variables, diagnostics |
| Database Consultant | assess, design, migrate and optimise database estates | broad cross-domain capability set |
| Database Engine/Kernel Engineer | inspect and develop database-engine internals | advanced diagnostics and engine-specific extensions |

## Database-consuming personas

The same workbench should also serve application developers, backend developers, full-stack developers, software engineers, analytics engineers, ETL/ELT developers, warehouse developers, BI developers, reporting developers, data analysts, data scientists, ML engineers, platform engineers, DevOps engineers, SREs, infrastructure engineers, security engineers, auditors, data stewards and data-governance specialists.

These users usually need a narrower task surface than a DBA. Persona-aware workspaces can later provide focused navigation without removing access to capabilities the user is authorized to use.

## Product capability domains

### 1. Connection and session management

- saved connection profiles
- secure credential integration
- connection testing
- connection/session lifecycle
- multiple simultaneous database connections
- session properties and server identity

### 2. SQL development

- multi-tab SQL editor
- syntax support by dialect
- statement execution and cancellation
- parameters and bind variables
- transactions
- query history
- snippets/templates
- formatting
- result grids
- result export
- execution statistics

### 3. Database exploration

- server/catalog/schema browser
- tables, columns and indexes
- constraints and relationships
- views
- procedures/functions
- triggers/events
- generated DDL
- dependency navigation
- search across database objects

### 4. Data operations

- browse/filter/sort data
- safe row editing
- inserts/updates/deletes
- import/export
- data comparison
- data generation and sampling

### 5. Schema engineering

- create/alter/drop workflows
- visual object editors
- schema comparison
- DDL preview
- migration planning
- migration execution
- rollback strategy
- change history

### 6. Performance engineering

- explain plans
- execution statistics
- active sessions/statements
- locks and waits
- index analysis
- server variables
- workload diagnostics
- query tuning workflows

### 7. Administration

- sessions/processes
- server variables/configuration
- users and roles
- privileges/grants
- storage/capacity
- maintenance operations
- backup/restore orchestration

### 8. Metadata-driven modelling

This domain should integrate `@nublox/metaobject` for:

- object-type definitions
- attribute and relationship modelling
- validation/constraints
- schema generation
- reverse engineering into metadata
- semantic schema comparison
- governed schema evolution
- reproducible generated artifacts

## Persona-to-workspace direction

The eventual UI should allow the same provider and connection to be viewed through task-oriented workspaces such as:

- **Developer** — editor, objects, results, history and explain plans
- **DBA** — health, sessions, configuration, security, storage and maintenance
- **Architect/Modeller** — catalogue, diagrams, metadata, comparison and migrations
- **Data Engineer** — query, import/export, transformation and movement
- **Analyst** — query, browse, results and export
- **Security/Governance** — users, privileges, metadata, lineage and audit-oriented views

This is a presentation model, not a hard-coded occupational restriction. A user can use multiple workspaces when their responsibilities span multiple roles.
