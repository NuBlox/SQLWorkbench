# ADR 0003: Metaobject integration is a bridge, not a dependency inversion

- Status: Accepted
- Date: 2026-09-27

## Decision

Workbench will add an explicit `@nublox/workbench-metaobject-bridge` package for physical-schema-to-logical-model mapping and logical-model-to-schema planning.

`@nublox/metaobject` will not import Workbench packages and Workbench provider packages will not use metaobject as their database catalogue representation.

## Consequences

Physical database metadata and logical business/object metadata remain distinct but transformable. Schema reverse engineering, governed model releases and migration planning can later compose the strengths of both products without coupling their kernels.
