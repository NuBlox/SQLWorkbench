import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  ConnectionProfileResolver,
  JsonConnectionProfileRepository,
  MemoryCredentialStore,
} from "../dist/index.js";

async function createHarness(t) {
  const directory = await mkdtemp(join(tmpdir(), "nublox-workbench-profiles-"));
  t.after(async () => {
    await rm(directory, { recursive: true, force: true });
  });
  const file = join(directory, "connections.json");
  return {
    file,
    profiles: new JsonConnectionProfileRepository(file, () => "2026-09-27T10:00:00.000Z"),
  };
}

function profileDraft(overrides = {}) {
  return {
    id: "local-mysql",
    name: "Local MySQL",
    providerId: "MYSQL",
    host: "127.0.0.1",
    port: 3306,
    user: "stephen",
    database: "nublox",
    credentialId: "credential:local-mysql",
    tls: {
      ca: "public-ca",
      rejectUnauthorized: true,
    },
    options: {
      charset: "utf8mb4",
      nested: { enabled: true },
    },
    ...overrides,
  };
}

test("JSON repository persists normalized profiles and enforces optimistic revisions", async (t) => {
  const { file, profiles } = await createHarness(t);

  const created = await profiles.create(profileDraft());
  assert.equal(created.providerId, "mysql");
  assert.equal(created.revision, 1);

  const updated = await profiles.update(
    profileDraft({ name: "Local Development MySQL" }),
    created.revision,
  );
  assert.equal(updated.name, "Local Development MySQL");
  assert.equal(updated.revision, 2);
  assert.equal(updated.createdAt, created.createdAt);

  await assert.rejects(
    profiles.update(profileDraft({ name: "Stale editor" }), created.revision),
    /revision conflict/,
  );

  const reloaded = new JsonConnectionProfileRepository(file);
  assert.equal((await reloaded.get("local-mysql"))?.revision, 2);
});

test("resolver combines OS-store credentials without persisting secrets", async (t) => {
  const { file, profiles } = await createHarness(t);
  await profiles.create(profileDraft());

  const credentials = new MemoryCredentialStore();
  await credentials.set("credential:local-mysql", {
    password: "super-secret-password",
    tlsPrivateKey: "super-secret-private-key",
  });

  const resolver = new ConnectionProfileResolver(profiles, credentials);
  const config = await resolver.resolve("local-mysql");

  assert.equal(config.providerId, "mysql");
  assert.equal(config.password, "super-secret-password");
  assert.equal(config.tls?.key, "super-secret-private-key");
  assert.equal(config.tls?.ca, "public-ca");

  const persisted = await readFile(file, "utf8");
  assert.equal(persisted.includes("super-secret-password"), false);
  assert.equal(persisted.includes("super-secret-private-key"), false);
  assert.equal(persisted.includes("credential:local-mysql"), true);
});

test("profile options reject secret-like keys", async (t) => {
  const { profiles } = await createHarness(t);

  await assert.rejects(
    profiles.create(
      profileDraft({
        options: {
          ssl: {
            privateKey: "do-not-persist-this",
          },
        },
      }),
    ),
    /must be stored through CredentialStore/,
  );
});
