// Signed JSON for the manager channel. A signed file is an envelope holding the JSON text and an
// ed25519 signature over its exact bytes, so the text and its signature always travel together.
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from "node:crypto";

function privateKeyObject(b64) {
  return createPrivateKey({ key: Buffer.from(b64, "base64"), format: "der", type: "pkcs8" });
}

export function generateKeys() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    privateKey: privateKey.export({ type: "pkcs8", format: "der" }).toString("base64"),
    publicKey: publicKey.export({ type: "spki", format: "der" }).toString("base64"),
  };
}

export function publicKeyOf(privateKeyB64) {
  return createPublicKey(privateKeyObject(privateKeyB64)).export({ type: "spki", format: "der" }).toString("base64");
}

export function sealJson(value, privateKeyB64) {
  const signed = JSON.stringify(value);
  const sig = sign(null, Buffer.from(signed, "utf8"), privateKeyObject(privateKeyB64)).toString("base64");
  return { text: JSON.stringify({ signed, sig }), signed };
}

export function openJson(text, publicKeyB64) {
  const env = JSON.parse(text);
  if (typeof env?.signed !== "string" || typeof env?.sig !== "string") throw new Error("not a signed envelope");
  const key = createPublicKey({ key: Buffer.from(publicKeyB64, "base64"), format: "der", type: "spki" });
  if (!verify(null, Buffer.from(env.signed, "utf8"), key, Buffer.from(env.sig, "base64"))) throw new Error("bad signature");
  return { value: JSON.parse(env.signed), signed: env.signed };
}

export function sha256Text(data) {
  return createHash("sha256").update(data, typeof data === "string" ? "utf8" : undefined).digest("hex");
}
