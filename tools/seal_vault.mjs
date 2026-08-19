#!/usr/bin/env node
/**
 * Seal the Idea Vault.
 *
 * The vault is not a password CHECK. There is no PIN in the page and no
 * comparison to bypass: what ships is a block of AES-GCM ciphertext, the PIN is
 * what derives the key, and a wrong PIN fails to decrypt rather than failing an
 * `if`. Reading the source, editing script.js, or stepping through the debugger
 * gets you nothing, because the words are not in the page at all.
 *
 * This writes the blob. index.html carries it in one attribute:
 *
 *     <section class="resume-strip vault" id="vault" data-vault="v1.310000.…">
 *
 * Usage:
 *     node tools/seal_vault.mjs --pin 12345 --text "the secret"
 *     node tools/seal_vault.mjs --pin 12345 --file notes.txt
 *     node tools/seal_vault.mjs --pin 12345 --text "…" --print   # don't touch index.html
 *
 * Format: v1.<iterations>.<base64( salt[16] | iv[12] | ciphertext+tag )>
 * PBKDF2-SHA256 -> AES-256-GCM, which is exactly what SubtleCrypto in the
 * browser reads back. Both halves are stdlib; there is nothing to install.
 *
 * A WORD ON THE PIN. Five digits is a hundred thousand combinations. The
 * iteration count below is what stands between that and a laptop: at ~310k
 * iterations a guess costs a few hundred milliseconds, so a full sweep is hours
 * rather than seconds. That is a speed bump, not a safe. It is the right shape
 * for "my half-finished ideas" and the wrong shape for anything that would
 * actually hurt to lose — for that, seal it with a passphrase instead. The
 * format does not care how long the secret is; only the input box is numeric.
 */

import { pbkdf2Sync, randomBytes, createCipheriv } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ITERATIONS = 310000;          // OWASP's PBKDF2-SHA256 floor, 2023
const HTML = join(dirname(dirname(fileURLToPath(import.meta.url))), 'index.html');

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? null : process.argv[i + 1] ?? '';
}

const pin = arg('pin');
const file = arg('file');
const text = file ? readFileSync(file, 'utf8') : arg('text');

if (!pin || text === null) {
  console.error('usage: node tools/seal_vault.mjs --pin <code> (--text "…" | --file <path>) [--print]');
  process.exit(2);
}

const salt = randomBytes(16);
const iv = randomBytes(12);
const key = pbkdf2Sync(pin, salt, ITERATIONS, 32, 'sha256');
const cipher = createCipheriv('aes-256-gcm', key, iv);
const body = Buffer.concat([cipher.update(text, 'utf8'), cipher.final(), cipher.getAuthTag()]);
const blob = `v1.${ITERATIONS}.${Buffer.concat([salt, iv, body]).toString('base64')}`;

if (process.argv.includes('--print')) {
  console.log(blob);
  process.exit(0);
}

/* Read and write as bytes. This file has mixed line endings, and a text-mode
   round trip would rewrite every one of them and turn a one-attribute edit into
   a whole-file diff. */
const html = readFileSync(HTML);
const before = html.toString('utf8');
if (!/data-vault="[^"]*"/.test(before)) {
  console.error(`no data-vault attribute found in ${HTML} — nothing to reseal`);
  process.exit(1);
}
writeFileSync(HTML, Buffer.from(before.replace(/data-vault="[^"]*"/, `data-vault="${blob}"`), 'utf8'));
console.log(`sealed ${Buffer.byteLength(text)} bytes into ${HTML}`);
console.log(`  pin        ${pin}`);
console.log(`  iterations ${ITERATIONS}`);
