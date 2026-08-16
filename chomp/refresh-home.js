// Refreshing the game page (Ctrl+R / Ctrl+Shift+R / F5) leaves the game: a
// reload navigation bounces to the portfolio home instead of restarting the
// world. First-time navigations (links from the site) are unaffected.
// External file on purpose — the site's CSP is script-src 'self' with no
// inline allowance, and it stays that way.
(function () {
  try {
    var nav = performance.getEntriesByType('navigation')[0];
    if (nav && nav.type === 'reload') location.replace('/');
  } catch (e) {}
})();
