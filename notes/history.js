/* Undo and redo, for everything.
 *
 * WHAT WAS WRONG BEFORE. The old app kept eighty JSON copies of the entire
 * state and re-rendered every box on Ctrl+Z, so the caret landed nowhere and
 * a typo three words back cost a re-render of the whole page. The overlay it
 * replaced leaned on the browser's own undo stack instead, which only knows
 * about what execCommand did and reverts hand-made DOM edits to a state that
 * never existed. Neither could undo a deleted category.
 *
 * WHAT THIS IS. One stack of transactions. Each one records, for the thing it
 * changed, what it was before and after, plus where the caret was on each
 * side. Two kinds:
 *
 *   text        one category body: { before: html, after: html } and the
 *               serialized selection either side. Applied by setting the
 *               body's innerHTML and putting the caret back.
 *   structure   the session as data (titles, colours, order, archive, and
 *               the bodies of anything removed) before and after. Applied by
 *               swapping the session and re-rendering.
 *
 * TYPING IS COALESCED the way a word processor does it: consecutive
 * insertions into the same body merge into one entry until a space, a pause,
 * or a different kind of edit seals it. So Ctrl+Z steps back a word, not a
 * character, and not a paragraph.
 *
 * THE BROWSER'S OWN STACK IS SWITCHED OFF. Every Ctrl+Z, Ctrl+Y and
 * Ctrl+Shift+Z is taken here, and the historyUndo/historyRedo input types the
 * context menu produces are cancelled in beforeinput. Two stacks that both
 * think they own the document is the failure mode this replaces.
 */

const MAX = 200;
const COALESCE_MS = 900;

export class History {
  constructor({ applyText, applyStructure, onChange }) {
    this.undoStack = [];
    this.redoStack = [];
    this.open = null;            // the entry still accepting coalesced input
    this.applyText = applyText;
    this.applyStructure = applyStructure;
    this.onChange = onChange || (() => {});
    this.applying = false;
  }

  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }

  clear() {
    this.undoStack = [];
    this.redoStack = [];
    this.open = null;
    this.onChange();
  }

  /* Close the coalescing group. Called on blur, on any structural change, and
   * before an explicit transaction. */
  seal() { this.open = null; }

  push(entry) {
    this.open = null;
    this.undoStack.push(entry);
    if (this.undoStack.length > MAX) this.undoStack.shift();
    this.redoStack = [];
    this.onChange();
  }

  /* A native edit reported by beforeinput/input. `key` names what kind it was
   * so a run of the same kind can merge. `seal` says the edit ends its group
   * (a space, a newline). */
  native({ catId, key, before, after, seal }) {
    const now = Date.now();
    const o = this.open;
    if (o && o.kind === 'text' && o.catId === catId && o.key === key && now - o.at < COALESCE_MS && !o.sealed) {
      o.after = after;
      o.at = now;
      // A space or a full stop after letters closes the word; a space that
      // opens a group stays open so " fox" undoes as one.
      if (seal && o.letters) o.sealed = true;
      if (!seal) o.letters = true;
      this.onChange();
      return;
    }
    const entry = { kind: 'text', catId, key, before, after, at: now, sealed: false, letters: !seal };
    this.push(entry);
    this.open = entry;
  }

  /* A change this code made to a body, wrapped so before and after are
   * captured around it. `capture()` returns { html, sel } for the body. */
  text(catId, capture, mutate) {
    this.seal();
    const before = capture();
    const result = mutate();
    const after = capture();
    if (before.html !== after.html) this.push({ kind: 'text', catId, key: 'op', before, after, at: Date.now(), sealed: true });
    return result;
  }

  /* A change to the session's structure. `capture()` returns the session as
   * JSON text (cheap to compare, cheap to keep). */
  structure(label, capture, mutate) {
    this.seal();
    const before = capture();
    const result = mutate();
    const after = capture();
    if (before !== after) this.push({ kind: 'structure', label, before, after, at: Date.now() });
    return result;
  }

  undo() {
    const entry = this.undoStack.pop();
    if (!entry) return false;
    this.open = null;
    this.applying = true;
    try {
      if (entry.kind === 'text') this.applyText(entry.catId, entry.before);
      else this.applyStructure(entry.before);
    } finally {
      this.applying = false;
    }
    this.redoStack.push(entry);
    this.onChange();
    return true;
  }

  redo() {
    const entry = this.redoStack.pop();
    if (!entry) return false;
    this.open = null;
    this.applying = true;
    try {
      if (entry.kind === 'text') this.applyText(entry.catId, entry.after);
      else this.applyStructure(entry.after);
    } finally {
      this.applying = false;
    }
    this.undoStack.push(entry);
    this.onChange();
    return true;
  }
}
