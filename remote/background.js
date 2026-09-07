/* The key catcher.
 *
 * WHY THIS EXISTS AT ALL, because a browser extension is not the obvious answer
 * and two simpler ones were tried first and MEASURED:
 *
 *   1. navigator.mediaSession in the page. The site registers next/previous
 *      handlers, and on the real machine the play/pause key worked from the
 *      desktop while next and previous did nothing anywhere. The OS media
 *      controls attach to whoever is really making the sound, which for the
 *      music overlay is YouTube's cross-origin <iframe>: their player answers
 *      play/pause, and a single video has no next or previous, so those keys
 *      landed on a session that had nothing to do with us.
 *   2. Holding the session with a near-silent track of our own in the top
 *      document, so Chrome would build the session around an element that IS
 *      ours. It did not take the keys off the embed either.
 *
 * An extension does not compete for the media session at all. `global: true`
 * commands are registered with the OS by Chrome itself, ahead of any page, and
 * fire while Chrome is in the background or not the focused app. That is the
 * whole reason this folder exists rather than more code in script.js.
 *
 * NOTE, and it is the price: while this is enabled the media keys belong to
 * this extension, so they stop reaching Spotify and anything else.
 *
 * Ctrl+Alt+Right and Ctrl+Alt+Left are NOT bound here. Chrome refuses
 * Ctrl+Alt+<key> on Windows -- that combination is AltGr -- so those stay a
 * PowerToys remap onto the media keys, which is where they were already
 * pointed. See README.md.
 */

/* The same list as manifest.json's matches. Edit BOTH when the site moves. */
const SITE = [
  'https://dexcimino.com/*',
  'https://www.dexcimino.com/*',
  'https://*.vercel.app/*',
  'http://localhost/*',
  'http://127.0.0.1/*',
];

/* SAY WHAT HAPPENED, in the service worker's own console (the "service worker"
   link on the extension's card). Three things can go wrong and they look
   identical from the outside -- the key never reached the extension, no tab
   matched, or the tab had no content script -- and each line below tells the
   three apart in one press. This is a locally loaded extension for one machine;
   the log is the whole diagnostic surface it has. */
chrome.commands.onCommand.addListener(async (command) => {
  let tabs = [];
  try { tabs = await chrome.tabs.query({ url: SITE }); } catch (e) {
    console.log('remote:', command, '- tabs.query failed', e);
    return;
  }
  console.log('remote:', command, '-', tabs.length, 'matching tab(s)');
  if (!tabs.length) {
    console.log('remote: no tab matches', SITE.join(' '), '- is the site open?');
    return;
  }

  /* THE TAB MAKING SOUND, not the first one found. Two copies of the site open
     is ordinary -- one being read, one playing in another window -- and a
     remote that skipped the track in the silent one would look broken while
     quietly moving something nobody could hear. `audible` is Chrome's own
     answer to "is this tab producing audio", so it is true for the YouTube
     embed as well as for the songs bar. Falling back to the most recently used
     tab, because a paused player is still the thing the play key means. */
  const tab = tabs.find(t => t.audible)
    || tabs.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0];
  if (!tab) return;

  /* A tab whose content script has not loaded yet (or that was navigated away)
     is not an error, it is just not the one -- but it IS the third failure, so
     it says so rather than being swallowed in silence. */
  chrome.tabs.sendMessage(tab.id, { command })
    .then(() => console.log('remote: delivered to', tab.url))
    .catch((e) => console.log('remote: tab', tab.id, 'did not take it -', e.message,
                              '- reload the site tab'));
});
