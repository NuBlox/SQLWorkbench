# @nublox/workbench-connection-profiles

Persistent connection-profile and credential-resolution primitives for NuBlox SQL Workbench.

## Security boundary

Connection profiles persist non-secret metadata only: provider, host, port, user, database, TLS CA/certificate material, connection options and a credential reference.

Passwords and TLS private keys are never part of `ConnectionProfile`. They are resolved through the `CredentialStore` contract at connection time.

`MemoryCredentialStore` exists only for unit tests and ephemeral development. Production desktop code must provide an operating-system-backed credential store (for example macOS Keychain, Windows Credential Manager or Linux Secret Service).

## Persistence

`JsonConnectionProfileRepository` writes a versioned JSON snapshot using a temporary file followed by rename. The containing directory is created with owner-only permissions where the operating system honours POSIX modes, and the profile file is written with mode `0600`.

The repository uses optimistic profile revisions so stale editors cannot silently overwrite a newer saved profile.

## Example

```ts
const profiles = new JsonConnectionProfileRepository(profilePath);
const credentials = new OsCredentialStore();
const resolver = new ConnectionProfileResolver(profiles, credentials);

const config = await resolver.resolve("production-readonly");
await connectionManager.connect("production-readonly", config);
```

Provider-specific connection options must remain JSON-serializable and must not contain secret-like keys. Secrets belong in `CredentialStore`.
