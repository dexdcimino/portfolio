/* The board's own theme on first paint. A plain blocking script (the CSP is
   script-src 'self', so it cannot be inline), loaded right after
   /accent-boot.js. accent-boot names the site accent; this names one of the
   mockup's eight schemes when Dex picked one on the board, and that wins in
   board.css. A NAME only; the colours live in board.css. */
(function () {
  try {
    var t = localStorage.getItem('board-theme');
    if (/^m-(red|orange|amber|green|teal|blue|violet|pink)$/.test(t || '')) {
      document.documentElement.setAttribute('data-board-theme', t);
    }
  } catch (e) { /* private mode: the site accent stands */ }
})();
