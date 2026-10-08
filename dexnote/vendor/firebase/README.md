Firebase JS SDK 12.11.0 (Apache-2.0), the browser builds from the npm package
`firebase` (`firebase-app.js`, `firebase-auth.js`, `firebase-firestore.js`,
`firebase-storage.js`). Self-hosted so the page's CSP can stay `script-src 'self'`.

Two edits, both mechanical: the absolute `https://www.gstatic.com/firebasejs/12.11.0/firebase-app.js`
import in each file is rewritten to `./firebase-app.js`, and the
`//# sourceMappingURL` lines are removed. To update, repeat both on the new version.
