/* The board's theme on first paint. A plain blocking script (the CSP is
   script-src 'self', so it cannot be inline). The board keeps its own choice
   under board-theme: one of the site's seven accent NAMES (data-accent) or
   one of the mockup's eight schemes (data-board-theme). It never reads the
   portfolio's dex-accent-name, so the two never change each other. A NAME
   only; the colours live in board.css. */
(function () {
  var root = document.documentElement;
  try {
    var t = localStorage.getItem('board-theme') || '';
    if (/^m-(red|orange|amber|green|teal|blue|violet|pink)$/.test(t)) root.setAttribute('data-board-theme', t);
    else if (/^(red|yellow|lime|cyan|blue|purple|white)$/.test(t)) root.setAttribute('data-accent', t);
  } catch (e) { /* private mode: lime, from the markup */ }
})();
