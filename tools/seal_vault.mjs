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
 *     <section class="resume-strip vault" id="vault" data-vault="v2.32768.8.1.…">
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
 * Format: v2.<N>.<r>.<p>.<base64( salt[16] | iv[12] | ciphertext+tag )>
 * scrypt -> AES-256-GCM. The parameters travel with the blob, so raising them
 * later does not strand anything already sealed. Both halves are stdlib; there
 * is nothing to install.
 *
 * A WORD ON THE CODE, and it is the whole ballgame. The ciphertext is public,
 * so the only defence is how many guesses it takes and what each one costs.
 * scrypt at 32 MiB makes a guess cost roughly a thousand times what PBKDF2 did
 * on the hardware an attacker would actually use — but a thousand times a very
 * small number is still a small number if the code is guessable.
 *
 *   SNAIL, or any dictionary word: found in seconds. A wordlist is the first
 *          thing anyone runs, and no KDF saves a word that is in it.
 *   5 random characters (a-z0-9): ~60 million; days to weeks on one GPU.
 *   4 random dictionary words:    ~2^52; nothing anyone can afford.
 *
 * So: the KDF is as strong as this can reasonably be made, and the passphrase is
 * the part that decides whether that matters. Seal anything that would actually
 * hurt to lose with four random words, not five characters.
 */

import { scryptSync, randomBytes, createCipheriv } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/* scrypt, not PBKDF2, and this is the most important line in the file. The
   ciphertext is public — it ships in a static page — so the only thing between a
   determined attacker and the plaintext is the cost of a guess. PBKDF2 is cheap
   on a GPU no matter how high the iteration count goes; scrypt makes every guess
   allocate and randomly walk 32 MiB, and memory is the one cost a GPU cannot
   multiply away. Same parameters as the page's own implementation, which is
   verified against this one. */
const N = 32768, R = 8, P = 1;      // 128 * N * r = 32 MiB per guess
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
// maxmem has to be raised by hand: node's default ceiling is 32 MiB and these
// parameters need exactly that for V plus the working blocks around it.
const key = scryptSync(secret, salt, 32, { N, r: R, p: P, maxmem: 192 * 1024 * 1024 });
const cipher = createCipheriv('aes-256-gcm', key, iv);
const body = Buffer.concat([cipher.update(text, 'utf8'), cipher.final(), cipher.getAuthTag()]);
const blob = `v2.${N}.${R}.${P}.${Buffer.concat([salt, iv, body]).toString('base64')}`;

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
console.log(`  kdf        scrypt N=${N} r=${R} p=${P}  (${(128 * N * R) / 1048576} MiB per guess)`);
