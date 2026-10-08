/* The live part of a shared canvas (inko/room.js), on Firestore.

   WHY FIRESTORE. Vercel functions cannot hold a socket open between phones,
   and the site's Blob store is billed per write, so a stroke-by-stroke feed
   through it would be slow and costly. The site already has a Firebase
   project (dexnote-d7047, the one DexNote and the site account use), and
   Firestore pushes every change to every listener over plain HTTPS. So a
   room is one document, its strokes and chat two collections under it:

     inkoRooms/<room id>              { title, host, bg, gen, members: { handle: ms } }
     inkoRooms/<room id>/strokes/*    { sid, cid, by, uid, tool, color, size, gen, pts: [x, y, ...] 0..1, at }
     inkoRooms/<room id>/chat/*       { by, uid, t, at }

   Phones sign in to Firebase ANONYMOUSLY, which the project already allows
   (its rules know the anonymous provider); the Inko account is still who you
   are in the room (`by`). The room id -- 24 random letters, ~143 bits -- is
   the key: the rules (docs/inko-rooms.rules) let a signed-in phone read or
   write a room only by its exact id, never list them, and delete only its
   own strokes. A clear bumps `gen` instead of deleting everyone's strokes.

   The SDK is the vendored one DexNote loads (dexnote/vendor/firebase), so
   the page's CSP stays script-src 'self'. */
import { initializeApp, getApps } from '/dexnote/vendor/firebase/firebase-app.js';
import { initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, signInAnonymously } from '/dexnote/vendor/firebase/firebase-auth.js';
import { getFirestore, doc, setDoc, updateDoc, collection, addDoc, writeBatch, onSnapshot, query, orderBy, serverTimestamp }
  from '/dexnote/vendor/firebase/firebase-firestore.js';

// Public identifiers, as in dexnote/cloud.js: the rules protect the data.
const CONFIG = {
  apiKey: 'AIzaSyCU7xuhuILTkbdcP-E2qBH3EnNKT_eWTjA',
  authDomain: 'dexnote-d7047.firebaseapp.com',
  projectId: 'dexnote-d7047',
  storageBucket: 'dexnote-d7047.firebasestorage.app',
  messagingSenderId: '981706581411',
  appId: '1:981706581411:web:afcdd27d285ba5ba9d2616',
};
let app, auth, db;
async function ready(){
  if (!app){
    app = getApps().find(a => a.name === 'inko') || initializeApp(CONFIG, 'inko');
    // No popup/redirect resolver: anonymous sign-in needs none, and without
    // it the SDK never opens the authDomain iframe the CSP would refuse.
    auth = initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence] });
    db = getFirestore(app);
  }
  await auth.authStateReady();
  if (!auth.currentUser) await signInAnonymously(auth);
  return auth.currentUser.uid;
}
const ms = v => (v && typeof v.toMillis === 'function' ? v.toMillis() : typeof v === 'number' ? v : Date.now());

export async function create(id, fields){
  await ready();
  await setDoc(doc(db, 'inkoRooms', id), { ...fields, created: serverTimestamp() });
}

export async function connect(id, on){
  const uid = await ready();
  const ref = doc(db, 'inkoRooms', id);
  const subs = [
    onSnapshot(ref, s => on.room(s.exists() ? s.data() : null), e => console.warn('inko room', e)),
    onSnapshot(query(collection(ref, 'strokes'), orderBy('at')), snap => {
      const added = [], removed = [];
      for (const ch of snap.docChanges()){
        if (ch.type === 'added') added.push({ id: ch.doc.id, ...ch.doc.data({ serverTimestamps: 'estimate' }) });
        else if (ch.type === 'removed') removed.push(ch.doc.id);
      }
      if (added.length || removed.length) on.strokes(added, removed);
    }, e => console.warn('inko strokes', e)),
    onSnapshot(query(collection(ref, 'chat'), orderBy('at')), snap => {
      const added = snap.docChanges().filter(ch => ch.type === 'added').map(ch => { const d = ch.doc.data({ serverTimestamps: 'estimate' }); return { id: ch.doc.id, ...d, at: ms(d.at) }; });
      if (added.length) on.chat(added);
    }, e => console.warn('inko chat', e)),
  ];
  return {
    uid,
    add: c => addDoc(collection(ref, 'strokes'), { ...c, uid, at: serverTimestamp() }).then(r => r.id),
    remove: ids => { const b = writeBatch(db); for (const i of ids) b.delete(doc(ref, 'strokes', i)); return b.commit(); },
    chat: m => addDoc(collection(ref, 'chat'), { ...m, uid, at: serverTimestamp() }),
    update: fields => updateDoc(ref, fields),
    close: () => subs.forEach(u => u()),
  };
}
