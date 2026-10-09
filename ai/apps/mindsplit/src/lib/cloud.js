/* The app's handle on /mindsplit/cloud.js (public/cloud.js), loaded at run
   time so the Firebase SDK stays the site's vendored copy and a harness can
   answer the URL with a fake. Resolves to null when it cannot load — the app
   then runs on this phone alone, which is what it did before accounts. */
let p = null;
export function cloud() {
  p ||= import(/* @vite-ignore */ `${import.meta.env.BASE_URL}cloud.js`).catch((err) => {
    console.warn("mindsplit: no cloud", err);
    return null;
  });
  return p;
}
