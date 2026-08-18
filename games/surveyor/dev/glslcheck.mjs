// The one check that has to run BEFORE anything imports materials.js.
//
// Every shader in that file is a JS template literal, so a backtick anywhere
// inside one closes it. What comes back is a SyntaxError naming a GLSL
// identifier — "Unexpected identifier 'thick'" — pointing at a line of English
// prose in the middle of a fragment shader, with nothing in it about quoting.
// That has now cost six debugging cycles across five passes: z, slope, spec,
// angle, then view, uOpaque, thick and pdepth.
//
// WHY THIS IS ITS OWN MODULE, and this is the whole point of the file. The
// assertion in run.mjs reads the source as TEXT and would have caught every one
// of them — but ESM hoists imports, so run.mjs pulls in chunks.js, chunks.js
// pulls in materials.js, and the SyntaxError is thrown before a single line of
// run.mjs executes. A guard that only runs once the file already parses is half
// a guard. Imported FIRST, this one runs before the import chain reaches the
// file it is checking.
//
// It catches two different failures with one scan:
//   ODD number of backticks   — the file does not parse, and this says why in a
//                               sentence instead of pointing at GLSL
//   EVEN number               — the file DOES parse, two backticks in one
//                               comment having closed and reopened the literal,
//                               and the shader silently lost everything between
//                               them. This is the one that hides.

import { readFileSync } from 'node:fs';

const SRC = new URL('../js/world/materials.js', import.meta.url);
const src = readFileSync(SRC, 'utf8');

/** Every shader body in the file, as { name, firstLine, text }. */
export function shaderBodies(text = src) {
  const out = [];
  const re = /S\.(\w+Shader) = (?:COMMON \+ )?`([\s\S]*?)\n  `;/g;
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
export function strayBackticks(text = src) {
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

export const bodies = shaderBodies();
export const stray = strayBackticks();

if (stray.length) {
  console.error('\nA SHADER BODY CONTAINS A BACKTICK. It closes the template literal');
  console.error('the shader is written in. Use plain words, not code quotes:\n');
  for (const line of stray) console.error('  ' + line);
  console.error('');
  process.exit(1);
}
