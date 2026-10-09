// TEMPORARY (2026-10-09): six border looks for the Featured Work thumbnails, so
// Dex can pick one. Remove this file, border-picker.css and their two tags in
// index.html once he has. The looks themselves are in border-picker.css.
(function () {
  var NAMES = ['As now (grey)', 'No border', 'No border, medium glow', 'No border, strong glow', 'Soft accent tint', 'Edge-lit corner'];
  var root = document.documentElement;
  var bar = document.createElement('div');
  bar.className = 'border-picker';
  function apply(i) {
    root.setAttribute('data-fwb', String(i + 1));
    btns.forEach(function (b, j) { b.setAttribute('aria-pressed', j === i ? 'true' : 'false'); });
    try { localStorage.setItem('dex-fwb-pick', String(i)); } catch (e) {}
  }
  var btns = NAMES.map(function (name, i) {
    var b = document.createElement('button');
    b.type = 'button'; b.textContent = String(i + 1); b.title = name;
    b.setAttribute('aria-label', name);
    b.addEventListener('click', function () { apply(i); });
    bar.appendChild(b);
    return b;
  });
  document.body.appendChild(bar);
  var start = 0;
  try { start = Math.min(NAMES.length - 1, Math.max(0, +localStorage.getItem('dex-fwb-pick') || 0)); } catch (e) {}
  apply(start);
})();
