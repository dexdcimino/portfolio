// The one check that has to run BEFORE anything imports a file with a shader.
//
// Every shader in this game is a JS template literal, so a backtick anywhere
// inside one closes it. What comes back is a SyntaxError naming a GLSL
// identifier — "Unexpected identifier 'thick'" — pointing at a line of English
// prose in the middle of a fragment shader, with nothing in it about quoting.
// That has now cost seven debugging cycles across six passes: z, slope, spec,
// angle, then view, uOpaque, thick, pdepth, and hzn.
//
// WHY THIS IS ITS OWN MODULE, and this is the whole point of the file. The
// assertion in run.mjs reads the source as TEXT and would have caught every one
// of them — but ESM hoists imports, so run.mjs pulls in chunks.js, chunks.js
// pulls in materials.js, and the SyntaxError is thrown before a single line of
// run.mjs executes. A guard that only runs once the file already parses is half
// a guard. Imported FIRST, this one runs before the import chain reaches the
// files it is checking.
//
// It catches two different failures with one scan:
//   ODD number of backticks   — the file does not parse, and this says why in a
//                               sentence instead of pointing at GLSL
//   EVEN number               — the file DOES parse, two backticks in one
//                               comment having closed and reopened the literal,
//                               and the shader silently lost everything between
//                               them. This is the one that hides.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

/* EVERY FILE THAT DECLARES A SHADER, not just materials.js.
   This scanned one file by name, which was right while every shader in the game
   lived in it. The far band brought its own pass and its own shader, and a
   guard that has to be TOLD where to look is one the next file outruns —
   silently, because the failure mode that hides is a shader which still parses
   and has quietly lost everything between two backticks. So it walks js/ and
   checks anything that assigns a shader body, wherever that ends up living. */
const ROOT = fileURLToPath(new URL('../js', import.meta.url));

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith('.js')) out.push(p);
  }
  return out;
}

// Matches `S.svThingVertexShader =` and `ShadersStore.svThingFragmentShader =`,
// which are the two ways a shader gets registered in this project.
const DECLARES = /\w+Shader\s*=\s*(?:COMMON \+ )?`/;

export const sources = walk(ROOT)
  .map((path) => ({ path, text: readFileSync(path, 'utf8') }))
  .filter((f) => DECLARES.test(f.text));

/** Every shader body in one file, as { name, firstLine, text }. */
export function shaderBodies(text) {
  const out = [];
  const re = /(\w+Shader) = (?:COMMON \+ )?`([\s\S]*?)\n  `;/g;
  let m;
  while ((m = re.exec(text))) {
    out.push({
      name: m[1],
      firstLine: text.slice(0, m.index).split('\n').length,
      text: m[2],
    });
  }
  return out;
}

/** Lines inside a shader body that quote with a backtick. Empty is the pass. */
export function strayBackticks(text) {
  const bad = [];
  for (const b of shaderBodies(text)) {
    b.text.split('\n').forEach((line, i) => {
      if (line.includes('`')) {
        bad.push(`${b.name} line ${b.firstLine + i + 1}: ${line.trim()}`);
      }
    });
  }
  return bad;
}

const base = (p) => p.split(/[\\/]/).pop();

/* Scanned per file rather than over a concatenation, so a reported line number
   is a line number in a file somebody can open. */
export const bodies = sources.flatMap((f) =>
  shaderBodies(f.text).map((b) => Object.assign(b, { file: base(f.path) })));

export const stray = sources.flatMap((f) =>
  strayBackticks(f.text).map((line) => `${base(f.path)} ${line}`));

if (stray.length) {
  console.error('\nA SHADER BODY CONTAINS A BACKTICK. It closes the template literal');
  console.error('the shader is written in. Use plain words, not code quotes:\n');
  for (const line of stray) console.error('  ' + line);
  console.error('');
  process.exit(1);
}
