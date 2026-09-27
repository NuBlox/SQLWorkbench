# Connection Profiles and Credential Storage

## Decision

NuBlox SQL Workbench separates durable connection metadata from secret material.

`@nublox/workbench-connection-profiles` owns the persistent connection-profile model and the credential-resolution contract. Database providers continue to receive a normal `DatabaseConnectionConfig`; they do not know where profiles or secrets are stored.

## Persistent profile data

A connection profile may persist:

- stable profile id and display name;
- provider id;
- host and port;
- user name;
- default database/catalog;
- connection timeout;
- TLS CA and client certificate material;
- non-secret, JSON-serializable provider options;
- an opaque credential id;
- optimistic revision and timestamps.

A profile must not persist passwords, access tokens, API keys, TLS private keys or other secret values.

`JsonConnectionProfileRepository` rejects common secret-like option keys to reduce the chance that provider-specific options accidentally bypass this boundary.

## Credential boundary

`CredentialStore` exposes only three operations:

```text
get(credentialId)
set(credentialId, credential)
delete(credentialId)
```

The credential payload currently contains password and TLS-private-key material. The contract can be extended when providers require additional secret types.

`MemoryCredentialStore` is explicitly non-production and exists for tests and ephemeral development only.

The desktop milestone must provide an OS-backed implementation:

- macOS: Keychain;
- Windows: Credential Manager;
- Linux: Secret Service/keyring.

No plaintext fallback should be introduced for production use.

## Resolution flow

```text
Connection selector
       |
       v
ConnectionProfileRepository ----> non-secret profile metadata
       |
       +------ credentialId ------> CredentialStore
                                      |
                                      v
                              secret material
       |                              |
       +--------------+---------------+
                      v
           ConnectionProfileResolver
                      |
                      v
          DatabaseConnectionConfig
                      |
                      v
              DatabaseProvider
```

Secrets therefore exist in application memory only when they are required to establish a database connection.

## Persistence guarantees

The JSON repository:

- writes a versioned snapshot;
- serializes mutations within the process;
- writes to a temporary file and renames it into place;
- uses owner-only file/directory modes where POSIX permissions are honoured;
- uses optimistic revisions to detect stale profile editors;
- validates loaded snapshots before returning them to the application.

The JSON file is configuration data, not a credential vault. File permissions are defence-in-depth rather than the secret-storage mechanism.

## Future desktop integration

The desktop shell should choose the application-data location for the profile JSON file and provide the platform credential-store implementation. UI workflows should save profile metadata and credentials independently so changing a host or database does not require rewriting secret material.
