/* The Dex Board Notes tab: the real notes app, mounted on one page.
 *
 * The tab loads /notes/notes.css, builds the owner backend through
 * board/notes-backend.js (the unlock exchange with the signed in user's ID
 * token, saves to /api/notes/save), and mounts the notes app from
 * /notes/app.js inside the tab container with the board view option on
 * (view: 'board'). In board view the app renders every session's categories
 * in document order on one page, with document wide category lookup and no
 * session list, no session switcher and no session chrome. The stored
 * document keeps its session nesting exactly; see notes/app.js.
 *
 * Shell interface: board/board.js dynamically imports this module and
 * calls mount(container, ctx), awaiting the promise it returns, and calls
 * unmount() on sign out. ctx provides { user, uid, store, dnd, boardApi }.
 * This tab uses only ctx.user (the Firebase user, for the unlock exchange).
 *
 * Failure handling: if the unlock exchange fails (not the owner, or the
 * store could not be reached), nothing is mounted and no editor is shown.
 * The tab shows one plain line instead, and never falls back to another
 * store, because for Dex the Firestore dexnote document is an empty
 * notebook and opening it would look like his notes and not be them.
 */

import { mount as mountNotesApp } from '/notes/app.js';
import { createNotesBackend } from './notes-backend.js';

let app = null;
let backend = null;
let host = null;

function ensureNotesCss() {
  if (document.querySelector('link[data-notes-css], link[data-board-notes-css]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/notes/notes.css';
  link.dataset.boardNotesCss = '1';
  document.head.append(link);
}

function showMessage(container, text) {
  const p = document.createElement('p');
  p.className = 'board-loading-card';
  p.textContent = text;
  container.replaceChildren(p);
}

export async function mount(container, ctx) {
  host = container;
  ensureNotesCss();
  const user = ctx && ctx.user;
  if (!user) {
    showMessage(container, 'Notes are not available.');
    return;
  }
  try {
    backend = await createNotesBackend(user);
  } catch (err) {
    console.warn('board notes: the notes store could not be opened', err);
    backend = null;
    showMessage(container, 'Your notes could not be opened.');
    return;
  }
  /* No close button in the tab: the app is a page here, not an overlay, so
     the header tail is an empty span where the overlay's X would sit. */
  const tail = document.createElement('span');
  try {
    app = await mountNotesApp(container, {
      payload: backend.payload,
      backend,
      headerTail: tail,
      view: 'board',
    });
  } catch (err) {
    console.warn('board notes: the notes app could not be mounted', err);
    app = null;
    showMessage(container, 'Your notes could not be opened.');
  }
}

export function unmount() {
  if (app) {
    try { app.unmount(); } catch (err) { console.warn('board notes: unmount threw', err); }
    app = null;
  }
  backend = null;
  if (host) host.replaceChildren();
  host = null;
}

/* The backend this tab is running on, for callers that need the current
   document through getDocument(). The Diet lane builds its own through
   board/notes-backend.js; this is here so the shell can reach the live one
   without a second unlock exchange. Null when the tab is not mounted. */
export function notesBackend() {
  return backend;
}
