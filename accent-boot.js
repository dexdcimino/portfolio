/* The saved accent on FIRST paint. Loaded twice from index.html, both times as
   a plain blocking <script src> (the site's CSP is script-src 'self', so an
   inline script would simply never run):

   1. In <head>, before the stylesheet has drawn anything: names the visitor's
      accent on <html>. --accent comes from [data-accent] in styles.css, so the
      page is never lime first and never transitions to their colour on a
      refresh.
   2. Straight after the hero <picture>, before the browser has picked one of
      its sources: points it at the saved accent's mascot, so the art does not
      show lime and then swap. Same stem rewrite as retint() in script.js (the
      ?v= stamp rides along); lime's file is named limegreen.

   A NAME only, never a hex: the palette lives in script.js and the copies
   tools/check_accents.py guards. script.js's applyAccent() still runs later
   for what CSS cannot do (cursor, label ink, favicon) and finds all of this
   already in place. Second load is a memory-cache hit. */
(function () {
  var root = document.documentElement;
  var hero = document.getElementById('heroMascot');
  if (!hero) {
    try {
      var a = localStorage.getItem('dex-accent-name');
      if (/^(red|yellow|lime|cyan|blue|purple|white)$/.test(a)) root.setAttribute('data-accent', a);
    } catch (e) { /* private mode: stays on the markup's default */ }
    return;
  }
  var name = root.getAttribute('data-accent');
  if (!name || name === 'lime') return;
  var els = hero.parentNode.querySelectorAll('source, img');
  for (var i = 0; i < els.length; i++) {
    var attr = els[i].tagName === 'IMG' ? 'src' : 'srcset';
    var v = els[i].getAttribute(attr);
    if (v) els[i].setAttribute(attr, v.replace(/mascot_[a-z]+/g, 'mascot_' + name));
  }
})();
