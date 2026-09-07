/* The relay: extension world -> page world.
 *
 * A content script shares the DOM with the page but not its JavaScript, so it
 * cannot call MediaBus directly. A DOM event on `document` crosses that line,
 * because the DOM is the one thing the two worlds do share.
 *
 * THREE EVENT NAMES AND NO `detail`, deliberately. A CustomEvent's detail is
 * structure-cloned on its way across worlds, which is one more thing that can
 * fail quietly for no benefit here -- the name carries everything this needs to
 * say.
 *
 * The page listens in initRemoteEvents() in script.js. Nothing cross-origin can
 * dispatch these: an iframe fires events on its own document, not on this one.
 */
const EVENTS = {
  next: 'music:remote-next',
  prev: 'music:remote-prev',
  toggle: 'music:remote-toggle',
};

chrome.runtime.onMessage.addListener((message) => {
  const name = message && EVENTS[message.command];
  if (!name) return;
  document.dispatchEvent(new CustomEvent(name));
});
