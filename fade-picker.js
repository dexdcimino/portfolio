// TEMPORARY (2026-10-09): four fades for the hero's front band, so Dex can pick one.
// Remove this file, fade-picker.css and their two tags in index.html once he has.
(function () {
  var grad = document.getElementById('bgFrontFade');
  if (!grad) return;
  var EASE = [[0, 0], [.25, .12], [.5, .4], [.75, .75], [1, 1]];
  // Ticks 2-4 run ALONG the band, top right to bottom left: each is a point on the
  // band's left edge where it is fully gone (y0) and one where it is solid (y1).
  function along(y0, y1) {
    var ex = function (y) { return 2244 - 1.8815 * y; };   // the band's left edge
    return { x1: ex(y0), y1: y0, x2: ex(y1), y2: y1, stops: EASE };
  }
  var FADES = [
    { x1: 1361.7, y1: 1355.8, x2: 1752.8, y2: -29.3, stops: [[.0942, 0], [.1736, .05], [.2365, .15], [.2937, .3], [.3476, .5], [.3992, .7], [.449, .85], [.55, 1]] },
    along(1080, 560),   // 2: covers the most of him
    along(820, 420),    // 3: about half way
    along(600, 300)     // 4: just a little
  ];
  var NS = 'http://www.w3.org/2000/svg';
  function apply(i) {
    var f = FADES[i];
    ['x1', 'y1', 'x2', 'y2'].forEach(function (k) { grad.setAttribute(k, f[k]); });
    while (grad.firstChild) grad.removeChild(grad.firstChild);
    f.stops.forEach(function (s) {
      var st = document.createElementNS(NS, 'stop');
      st.setAttribute('offset', s[0]); st.setAttribute('stop-color', '#fff'); st.setAttribute('stop-opacity', s[1]);
      grad.appendChild(st);
    });
    btns.forEach(function (b, j) { b.setAttribute('aria-pressed', j === i ? 'true' : 'false'); });
    try { localStorage.setItem('dex-fade-pick', String(i)); } catch (e) {}
  }
  var bar = document.createElement('div');
  bar.className = 'fade-picker';
  var btns = FADES.map(function (_, i) {
    var b = document.createElement('button');
    b.type = 'button'; b.textContent = String(i + 1);
    b.addEventListener('click', function () { apply(i); });
    bar.appendChild(b);
    return b;
  });
  document.body.appendChild(bar);
  var start = 0;
  try { start = Math.min(3, Math.max(0, +localStorage.getItem('dex-fade-pick') || 0)); } catch (e) {}
  apply(start);
})();
