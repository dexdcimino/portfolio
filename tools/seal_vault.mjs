#!/usr/bin/env node
/**
 * Seal the Idea Vault.
 *
 * The vault is not a password CHECK. There is no code in the page and no
 * comparison to bypass: what ships is a block of AES-GCM ciphertext, the code is
 * what derives the key, and a wrong code fails to decrypt rather than failing an
 * `if`. Reading the source, editing script.js, or stepping through the debugger
 * gets you nothing, because the words are not in the page at all.
 *
 * This writes the blob. index.html carries it in one attribute:
 *
 *     <section class="resume-strip vault" id="vault" data-vault="v1.310000.…">
 *
 * Usage:
 *     node tools/seal_vault.mjs --pin SNAIL --show snail      # open a named view
 *     node tools/seal_vault.mjs --pin SNAIL --text "the secret"
 *     node tools/seal_vault.mjs --pin SNAIL --file notes.txt
 *     node tools/seal_vault.mjs --pin OTHER --show snail --append   # a second code
 *     node tools/seal_vault.mjs --pin SNAIL --show snail --print    # don't touch index.html
 *
 * --show <name> seals the line "show:<name>", which the page reads as "open the
 * overlay called <name>" — the table of names is VIEWS in initVault(). The code
 * never names the door; the sealed text does, which is what lets a second code
 * open a different thing without a line of page code changing.
 *
 * --append keeps the blobs already in the attribute and adds this one. Every
 * blob is tried against whatever is typed, and only its own key can read it, so
 * a vault can hold several codes at once. Each one costs a key derivation per
 * attempt, so keep the list short.
 *
 * CODES ARE CASE-INSENSITIVE. The code is folded to upper case here before it
 * derives anything, and the page folds what is typed the same way, so SNAIL,
 * Snail and snail are one code. Digits and symbols are unchanged by folding, so
 * any code works: letters, numbers, punctuation, or a whole passphrase.
 *
 * Format: v1.<iterations>.<base64( salt[16] | iv[12] | ciphertext+tag )>
 * PBKDF2-SHA256 -> AES-256-GCM, which is exactly what SubtleCrypto in the
 * browser reads back. Both halves are stdlib; there is nothing to install.
 *
 * A WORD ON THE CODE. Five characters is a small space, and someone who wants in
 * can grind it offline against the blob. The iteration count below is what
 * stands between that and a laptop: at ~310k iterations a guess costs a few
 * hundred milliseconds. That is a speed bump, not a safe. It is the right shape
 * for "my half-finished ideas" and the wrong shape for anything that would
 * actually hurt to lose — for that, seal a passphrase. This tool does not care
 * how long it is; only the row of boxes on the page is five wide.
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
const show = arg('show');
const text = show !== null ? `show:${show}` : (file ? readFileSync(file, 'utf8') : arg('text'));

if (!pin || text === null) {
  console.error('usage: node tools/seal_vault.mjs --pin <code> '
                + '(--show <view> | --text "…" | --file <path>) [--append] [--print]');
  process.exit(2);
}

// Fold before deriving. The page folds what is typed the same way; these two
// lines are the whole of "codes are not case-sensitive" and have to agree.
const secret = pin.toUpperCase();

const salt = randomBytes(16);
const iv = randomBytes(12);
const key = pbkdf2Sync(secret, salt, ITERATIONS, 32, 'sha256');
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
const before = readFileSync(HTML).toString('utf8');
const found = before.match(/data-vault="([^"]*)"/);
if (!found) {
  console.error(`no data-vault attribute found in ${HTML} — nothing to reseal`);
  process.exit(1);
}
const kept = process.argv.includes('--append')
  ? found[1].trim().split(/\s+/).filter(Boolean)
  : [];
const attribute = [...kept, blob].join(' ');
writeFileSync(HTML, Buffer.from(before.replace(/data-vault="[^"]*"/,
  `data-vault="${attribute}"`), 'utf8'));

console.log(`sealed ${Buffer.byteLength(text)} bytes into ${HTML}`);
console.log(`  code       ${secret}${secret === pin ? '' : `  (folded from "${pin}")`}`);
console.log(`  payload    ${text.length > 60 ? text.slice(0, 57) + '…' : text}`);
console.log(`  entries    ${kept.length + 1} in the vault`);
console.log(`  iterations ${ITERATIONS}`);
