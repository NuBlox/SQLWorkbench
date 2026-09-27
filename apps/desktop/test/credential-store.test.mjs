import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { EncryptedFileCredentialStore } from "../dist/electron/main/encrypted-credential-store.js";

class FakeCipher {
  isAvailable() {
    return true;
  }

  encrypt(value) {
    return Buffer.from(`sealed:${Buffer.from(value, "utf8").toString("base64")}`, "utf8");
  }

  decrypt(value) {
    const text = value.toString("utf8");
    assert.match(text, /^sealed:/);
    return Buffer.from(text.slice("sealed:".length), "base64").toString("utf8");
  }
}

test("encrypted credential store never writes plaintext secrets", async () => {
  const directory = await mkdtemp(join(tmpdir(), "nublox-workbench-secrets-"));
  const filePath = join(directory, "credentials.json");
  const store = new EncryptedFileCredentialStore(filePath, new FakeCipher());

  try {
    await store.set("connection:test", {
      password: "correct-horse-battery-staple",
      tlsPrivateKey: "private-key-material",
    });

    const persisted = await readFile(filePath, "utf8");
    assert.doesNotMatch(persisted, /correct-horse-battery-staple/);
    assert.doesNotMatch(persisted, /private-key-material/);

    assert.deepEqual(await store.get("connection:test"), {
      password: "correct-horse-battery-staple",
      tlsPrivateKey: "private-key-material",
    });

    await store.delete("connection:test");
    assert.equal(await store.get("connection:test"), undefined);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("encrypted credential store fails closed when OS encryption is unavailable", async () => {
  const directory = await mkdtemp(join(tmpdir(), "nublox-workbench-secrets-"));
  const filePath = join(directory, "credentials.json");
  const store = new EncryptedFileCredentialStore(filePath, {
    isAvailable: () => false,
    encrypt: () => Buffer.alloc(0),
    decrypt: () => "",
  });

  try {
    assert.throws(
      () => store.set("connection:test", { password: "secret" }),
      /encryption is unavailable/i,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
