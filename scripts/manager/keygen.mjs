#!/usr/bin/env node
// Makes the channel's signing key pair. The private key goes in the publisher's environment and
// backup; the public key goes in manager/src/main/packs-key.ts.
import { generateKeys } from "./sign.mjs";

const { privateKey, publicKey } = generateKeys();
console.log(`private (SPOKEN_PACKS_SIGNING_KEY): ${privateKey}`);
console.log(`public  (PACKS_PUBLIC_KEY):         ${publicKey}`);
