import { test } from "node:test";
import assert from "node:assert/strict";

import { generateKeys, openJson, publicKeyOf, sealJson, sha256Text } from "./sign.mjs";

test("a sealed value opens with the matching public key", () => {
  const { privateKey, publicKey } = generateKeys();
  const { text, signed } = sealJson({ a: 1 }, privateKey);
  const opened = openJson(text, publicKey);
  assert.deepEqual(opened.value, { a: 1 });
  assert.equal(opened.signed, signed);
  assert.equal(publicKeyOf(privateKey), publicKey);
});

test("a changed signed text is refused", () => {
  const { privateKey, publicKey } = generateKeys();
  const env = JSON.parse(sealJson({ a: 1 }, privateKey).text);
  env.signed = JSON.stringify({ a: 2 });
  assert.throws(() => openJson(JSON.stringify(env), publicKey), /bad signature/);
});

test("another key's signature is refused", () => {
  const { privateKey } = generateKeys();
  const other = generateKeys();
  assert.throws(() => openJson(sealJson({ a: 1 }, privateKey).text, other.publicKey), /bad signature/);
});

test("plain JSON is not an envelope", () => {
  assert.throws(() => openJson('{"a":1}', generateKeys().publicKey), /not a signed envelope/);
});

test("sha256Text hashes UTF-8 text", () => {
  assert.equal(sha256Text("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});
