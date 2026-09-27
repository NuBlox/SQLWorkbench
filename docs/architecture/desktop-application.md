# Desktop Application Architecture

## Decision

The first NuBlox SQL Workbench application surface is an Electron desktop application with a SvelteKit/Svelte renderer.

The Electron main process is the local trust boundary. Database drivers, live database sessions, connection-profile persistence, operating-system credential encryption and filesystem access stay outside the renderer.

## Process model

```text
SvelteKit renderer
      |
      | typed contextBridge API
      v
Electron preload
      |
      | allow-listed IPC channels
      v
Electron main process
      |
      +--> JsonConnectionProfileRepository
      +--> EncryptedFileCredentialStore
      |       |
      |       +--> Electron safeStorage / OS key provider
      |
      +--> ConnectionProfileResolver
      +--> ProviderRegistry
      +--> ConnectionManager
              |
              +--> MySqlDatabaseProvider
                      |
                      +--> @nublox/mysql
```

## Renderer security

The renderer is built as static SvelteKit output and loaded from the local application bundle.

- `nodeIntegration` is disabled.
- `contextIsolation` is enabled.
- Electron renderer sandboxing is enabled.
- A restrictive Content Security Policy is emitted by `app.html`.
- New windows are denied.
- Subsequent top-level navigation is denied after the local renderer has loaded.
- The renderer receives only the functions exposed by the preload `contextBridge`.

The renderer never receives native MySQL pools, filesystem APIs, Electron's `ipcRenderer` object or decrypted credentials.

## Connection data

Application data is stored under Electron's platform-specific `app.getPath("userData")` directory.

`connection-profiles.json` contains non-secret profile metadata and uses the existing revisioned `JsonConnectionProfileRepository`.

`connection-credentials.json` contains only encrypted ciphertext. Passwords and TLS private keys are encrypted before being written and are decrypted only inside the Electron main process when a connection profile is resolved.

On Linux the desktop application rejects Electron's `basic_text` safe-storage backend. A machine without a real supported secret-store backend may still use profiles, but NuBlox refuses to persist credentials there.

## Credential lifecycle

Profile and credential mutations compensate for partial failures:

- a failed profile save restores the previous credential state;
- deleting a profile removes its stored credential and restores it if profile deletion fails;
- clearing a credential removes the profile's credential reference;
- database connection configuration is assembled only at connect time.

No secret is copied into `ConnectionProfile` persistence.

## Live sessions

The main process owns a single `ProviderRegistry` and `ConnectionManager` for the application lifetime. The MySQL provider is registered at startup.

The renderer can ask the main process to:

- list saved profiles;
- create or update a profile;
- clear a stored credential;
- delete a profile;
- connect a profile;
- disconnect a profile;
- list active connection health.

The application closes all active database sessions before quitting.

## Current M1 surface

The first Svelte workspace provides:

- persona/workspace selection;
- connection profile list;
- profile create/edit/delete;
- host, port, user, database and timeout fields;
- optional TLS certificate material;
- OS-encrypted password and TLS private-key persistence;
- live connect/disconnect actions;
- session health and latency display;
- navigation placeholders for SQL Editor, Database Explorer, Schema Designer and Administration.

The next M1 slice is the Monaco SQL editor and result-grid execution workflow using the already implemented `QueryService`.

## Development

From the repository root:

```bash
corepack enable
pnpm install
pnpm check
pnpm --filter @nublox/sql-workbench-desktop start
```

`start` expects the renderer and Electron main/preload files to have been built first. `pnpm check` performs the repository build before tests.
