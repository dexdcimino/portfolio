/* ThemeDock — interactive preview.

   A working copy of the extension's sidebar panel, running against a mock
   editor instead of against VS Code. The panel markup here produces the same
   class names panel.css styles, and panel.css is the extension's own
   stylesheet vendored in, so what you click is what ships.

   What is real: the twelve-swatch palette, the three target switches, the five
   custom slots with the HSB sliders and the hex field, the ten-theme picker,
   and the colours themselves — every value in themes.js was read out of the
   theme sources rather than eyeballed.

   What is not: there is no window to open, no folder to store a colour in, and
   no settings.json. The three window actions say so rather than doing nothing.

   No inline styles anywhere, and no inline <script>: the site is served under
   `style-src 'self'; script-src 'self'` and this page has to live inside that.
   Runtime colour goes through el.style.setProperty, which is CSSOM and not
   covered by the policy. */

(function () {
  'use strict';

  var THEMES = window.TD_THEMES || [];
  var vsc = document.getElementById('vsc');
  var root = document.getElementById('root');
  var codeEl = document.getElementById('vscCode');
  var toastEl = document.getElementById('vscToast');
  var deadEl = document.getElementById('vscDead');
  var hatchSw = document.getElementById('vscHatchSw');
  var sideEl = document.getElementById('vscSide');
  var edEl = document.getElementById('vscEditor');
  if (!vsc || !root) return;

  /* Peacock's nine defaults plus the three ThemeDock adds — the lime, the
     indigo and the graphite. Same order as the extension. */
  var PALETTE = [
    '#dd0531', '#eb5424', '#f9e64f',
    '#8bbf1f', '#42b883', '#215732',
    '#5dc9e2', '#007fff', '#3b47b0',
    '#663399', '#832561', '#5a6570'
  ];

  var TARGETS = [
    { key: 'title', label: 'Window' },
    { key: 'activity', label: 'Activity' },
    { key: 'status', label: 'Status' }
  ];

  /* REMEMBERED FOR THE SESSION, AND NOT ONE SECOND LONGER.

     Reopening the overlay reloads this page — the site blanks the iframe to
     about:blank on close — so anything kept in this document is gone by the
     time you come back to it, and the panel reset itself every time. What
     should survive is the trip out and back; what should NOT survive is a
     reload of the site, because this is a preview and a preview that remembers
     across visits is a preview that never shows anyone the default.

     So the slot is a property on the PARENT window, which outlives this
     document and dies with the page around it. sessionStorage is the reflex
     here and it is wrong: it survives a refresh, which is the one thing that
     has to clear. localStorage is wronger still. Standalone, `window.parent`
     is `window` and the same reasoning holds, one level down. Cross-origin can
     never happen (same site, same host) but the guard is a try/catch anyway,
     because the failure would be a thrown SecurityError on load rather than a
     forgotten colour. */
  var MEM = '__themedockSession';

  function memHost() {
    try {
      var w = window.parent || window;
      void w.document;            // throws if it is ever cross-origin
      return w;
    } catch (e) { return window; }
  }

  function remember() {
    try {
      memHost()[MEM] = {
        color: state.color, theme: state.theme,
        targets: { title: !!state.targets.title, activity: !!state.targets.activity,
          status: !!state.targets.status },
        custom: custom.slice(), hatch: hatchOn
      };
    } catch (e) { /* nothing to remember with */ }
  }

  function recall() {
    var m = null;
    try { m = memHost()[MEM]; } catch (e) { return; }
    if (!m || typeof m !== 'object') return;
    if (m.theme && THEMES.some(function (t) { return t.key === m.theme; })) state.theme = m.theme;
    if (clean(m.color)) state.color = clean(m.color);
    if (m.targets) {
      state.targets = { title: !!m.targets.title, activity: !!m.targets.activity,
        status: !!m.targets.status };
    }
    if (Array.isArray(m.custom) && m.custom.length >= MIN_SLOTS && m.custom.length <= MAX_SLOTS) {
      custom = m.custom.map(function (c) { return clean(c) || null; });
    }
    if (typeof m.hatch === 'boolean') hatchOn = m.hatch;
  }

  var MIN_SLOTS = 5;
  var MAX_SLOTS = 20;

  /* THE DEFAULT IS THE ONE THE EXTENSION'S OWN SCREENSHOTS OPEN ON (Dex,
     2026-08-22): Solarized Dark wearing #074b73. The colour is not in the
     twelve-swatch palette on purpose — it is a CUSTOM slot, which is the half
     of the panel nobody discovers by looking, so the preview opens with one
     already filled and worn rather than with five empty outlines. */
  var DEFAULT_COLOR = '#074b73';
  var state = {
    color: DEFAULT_COLOR,
    targets: { title: true, activity: false, status: false },
    theme: 'solarized'
  };
  var custom = [DEFAULT_COLOR, null, null, null, null];
  var hatchOn = true;
  var parkedTargets = null;
  var parked = null;
  var editing = null;
  var slidersOpen = false;
  var draft = { h: 210, s: 100, v: 100 };
  var refs = { slots: [], hexInput: null, switches: {} };

  /* ---------- colour maths ------------------------------------------------ */

  function clean(hex) {
    if (!hex) return null;
    var h = String(hex).trim().replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    // #rrggbbaa is kept, not truncated: several themes mute their comments
    // with alpha, and dropping it loses the distinction from the string colour.
    return /^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(h) ? '#' + h.toLowerCase() : null;
  }

  function rgb(hex) {
    var h = clean(hex) || '#000000';     // alpha ignored: contrast is measured on the colour
    return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  }

  function relLum(hex) {
    var c = rgb(hex).map(function (v) {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }

  function ratio(a, b) {
    var x = relLum(a), y = relLum(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  }

  /* Toward white or toward black by t, which is all the window chrome needs:
     several themes leave titleBar/statusBar unset and VS Code derives them. */
  function shade(hex, t) {
    var c = rgb(hex);
    var to = t > 0 ? 255 : 0;
    var a = Math.abs(t);
    return '#' + c.map(function (v) {
      return Math.round(v + (to - v) * a).toString(16).padStart(2, '0');
    }).join('');
  }

  function mix(a, b, t) {
    var x = rgb(a), y = rgb(b);
    return '#' + x.map(function (v, i) {
      return Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0');
    }).join('');
  }

  function hsbToHex(h, s, v) {
    var S = s / 100, V = v / 100;
    var C = V * S, X = C * (1 - Math.abs(((h / 60) % 2) - 1)), m = V - C;
    var p = h < 60 ? [C, X, 0] : h < 120 ? [X, C, 0] : h < 180 ? [0, C, X]
      : h < 240 ? [0, X, C] : h < 300 ? [X, 0, C] : [C, 0, X];
    return '#' + p.map(function (n) {
      return Math.round((n + m) * 255).toString(16).padStart(2, '0');
    }).join('');
  }

  function hexToHsb(hex) {
    var c = rgb(hex).map(function (v) { return v / 255; });
    var max = Math.max.apply(null, c), min = Math.min.apply(null, c), d = max - min;
    var h = 0;
    if (d) {
      if (max === c[0]) h = 60 * (((c[1] - c[2]) / d) % 6);
      else if (max === c[1]) h = 60 * ((c[2] - c[0]) / d + 2);
      else h = 60 * ((c[0] - c[1]) / d + 4);
    }
    if (h < 0) h += 360;
    return { h: Math.round(h), s: Math.round(max ? (d / max) * 100 : 0), v: Math.round(max * 100) };
  }

  /* ---------- theme ------------------------------------------------------- */

  function theme() {
    for (var i = 0; i < THEMES.length; i++) if (THEMES[i].key === state.theme) return THEMES[i];
    return THEMES[0];
  }

  function set(name, value) { if (value) vsc.style.setProperty(name, value); }

  /* Push one theme's colours onto .vsc as --vscode-* properties. The panel
     reads them through panel.css exactly as it reads VS Code's own. */
  function applyTheme() {
    var t = theme();
    if (!t) return;
    var ui = t.ui || {};
    var light = t.type === 'light';
    var g = function (key, fallback) { return clean(ui[key]) || fallback; };

    var editorBg = g('editor.background', light ? '#ffffff' : '#1f1f1f');
    var fg = g('foreground', light ? '#3b3b3b' : '#cccccc');
    var sideBg = g('sideBar.background', shade(editorBg, light ? -0.03 : 0.02));
    var titleBg = g('titleBar.activeBackground', sideBg);
    var actBg = g('activityBar.background', sideBg);
    var statBg = g('statusBar.background', titleBg);
    var inputBg = g('input.background', light ? shade(sideBg, -0.05) : shade(sideBg, 0.06));
    var border = g('widget.border', light ? 'rgba(0,0,0,.16)' : 'rgba(128,128,128,.28)');

    set('--vscode-foreground', fg);
    set('--vscode-descriptionForeground', g('descriptionForeground', mix(fg, editorBg, 0.4)));
    set('--vscode-errorForeground', g('errorForeground', '#f14c4c'));
    set('--vscode-focusBorder', g('focusBorder', light ? '#0969da' : '#007fd4'));
    set('--vscode-widget-border', border);
    set('--vscode-editor-background', editorBg);
    set('--vscode-input-background', inputBg);
    set('--vscode-input-foreground', g('input.foreground', fg));
    set('--vscode-input-border', g('input.border', border));
    set('--vscode-inputValidation-errorBorder', g('inputValidation.errorBorder', '#be1100'));
    set('--vscode-button-background', g('button.background', light ? '#1f883d' : '#0078d4'));
    set('--vscode-button-foreground', g('button.foreground', '#ffffff'));
    set('--vscode-testing-iconPassed', g('testing.iconPassed', g('charts.green', '#3fb950')));
    set('--vscode-charts-green', g('charts.green', '#3fb950'));

    set('--td-side-bg', sideBg);
    set('--td-base-title-bg', titleBg);
    set('--td-base-activity-bg', actBg);
    set('--td-base-status-bg', statBg);
    set('--td-base-title-fg', g('titleBar.activeForeground', fg));
    set('--td-base-activity-fg', g('activityBar.foreground', fg));
    set('--td-base-status-fg', g('statusBar.foreground', light ? '#ffffff' : fg));
    set('--td-border', border);
    set('--td-tab-active-bg', g('tab.activeBackground', editorBg));
    set('--td-tab-inactive-bg', g('tab.inactiveBackground', sideBg));
    set('--td-line-fg', g('editorLineNumber.foreground', mix(fg, editorBg, 0.55)));
    set('--td-scroll', g('scrollbarSlider.background', 'rgba(128,128,128,.35)'));

    /* The code area's wash, and it is the one dead-zone value that has to know
       whether the theme is light.

       IT WASHES AWAY FROM THE EDITOR, not toward it, and the first cut had it
       the other way round. "Dim" reads as "darken", so a dark wash went over a
       near-black editor and did almost nothing — black on black moves no
       pixels, and the hatch on top of it was dark ink on the same near-black
       and could not be seen either. Both halves of the treatment failed in the
       same place for the same reason. What dimming actually means here is
       LESS CONTRAST, and the direction that costs contrast is the one away
       from whatever the background already is: a pale veil over dark code, a
       dark one over light code. It also lifts the code far enough off its own
       floor for the hatch to land on something.

       The three chrome regions never get this. They are the extension's paint
       targets, recolouring them is the whole demo, and anything that mutes the
       fill is muting the thing being demonstrated. */
    set('--td-dead-wash', light ? 'rgba(18, 20, 25, .13)' : 'rgba(233, 237, 244, .10)');

    var syn = t.syn || {};
    var edFg = g('editor.foreground', fg);
    set('--td-syn-text', edFg);
    ['comment', 'string', 'keyword', 'func', 'number', 'type', 'var', 'prop', 'op']
      .forEach(function (k) { set('--td-syn-' + k, clean(syn[k]) || edFg); });

    tuneAccent();
    var name = document.getElementById('vscStTheme');
    if (name) name.textContent = t.label;
    var title = document.getElementById('vscTitleText');
    if (title) title.textContent = 'surveyor — Visual Studio Code';
  }

  /* The panel's own accent pass: the switch fill and the selection ring have to
     contrast with whatever the theme painted behind them, and several themes'
     focusBorder does not. Same 2.2 floor the extension uses. */
  function tuneAccent() {
    var t = theme();
    var ui = t.ui || {};
    var panel = clean(ui['sideBar.background']) || clean(ui['editor.background']) || '#1e1e1e';
    var fill = clean(ui['button.background']) || clean(ui.focusBorder) || '#0078d4';
    vsc.style.setProperty('--wc-fill', fill);
    vsc.style.setProperty('--wc-on-ink', relLum(fill) > 0.35 ? '#101318' : '#ffffff');

    var candidates = [ui.focusBorder, ui['button.background'], ui.foreground];
    var edge = null;
    for (var i = 0; i < candidates.length; i++) {
      var c = clean(candidates[i]);
      if (c && ratio(c, panel) >= 2.2) { edge = c; break; }
    }
    vsc.style.setProperty('--wc-edge', edge || (relLum(panel) > 0.4 ? '#4a5160' : '#8b93a1'));
  }

  /* ---------- the colour landing ------------------------------------------ */

  /* What the extension actually does to a window: paint the title bar, the
     activity bar and the status bar, or whichever of them are switched on. */
  function paint() {
    var on = state.color && anyOn();
    var ink = state.color ? (relLum(state.color) > 0.42 ? '#15181d' : '#ffffff') : null;
    var read = function (n) { return getComputedStyle(vsc).getPropertyValue(n).trim(); };

    /* THE HATCH INK IS THE SAME DECISION AS THE CHROME'S TEXT, not a parallel
       one — the same 0.42 split on the same relative luminance. A fixed
       neutral dies on a mid-tone: the lime swatch sits at 0.4296, a hair over
       the line, and the green at 0.367, a hair under, so the two of them want
       opposite inks and a single grey would vanish on one or the other. Being
       the same computation is also what keeps it in step when the colour
       changes, which a second copy would not.

       WHAT IT IS MEASURED AGAINST depends on what is actually painted there.
       With a swatch worn, the chrome IS `state.color`. With every target
       switched off it is the theme's own title bar, so the same expression
       runs against that instead. The alpha is carried here rather than in the
       stylesheet because there is no colour function in CSS old enough to be
       safe on every browser this page has to survive. */
    var hatchOver = on ? state.color : (read('--td-base-title-bg') || '#181818');
    var darkInk = relLum(hatchOver) > 0.42;
    vsc.style.setProperty('--td-hatch-ink',
      darkInk ? 'rgba(21, 24, 29, .25)' : 'rgba(255, 255, 255, .25)');
    /* The switch's outline is the same ink drawn as a line rather than as a
       field, so it needs the alpha a line reads at. Same decision, one value
       apart — not a second colour.

       AND ITS FILL IS THE INK'S OPPOSITE, which is what makes that outline
       mean anything. The first cut filled the pill with the editor background
       and it worked until the two poles met: GitHub Light wearing a dark
       swatch gives a WHITE ink on a near-white editor, so the pill came out
       with no edge at all — the one control in the dead half, invisible.
       Filling with the other pole guarantees the edge contrasts by
       construction rather than by luck, and it is the same pair of values the
       chrome's own text is picked from, so the pill never introduces a third
       colour. */
    vsc.style.setProperty('--td-hatch-edge',
      darkInk ? 'rgba(21, 24, 29, .55)' : 'rgba(255, 255, 255, .55)');
    vsc.style.setProperty('--td-sw-bg', darkInk ? '#ffffff' : '#15181d');
    vsc.style.setProperty('--td-sw-fg', darkInk ? '#15181d' : '#ffffff');

    var map = [
      ['title', '--td-title-bg', '--td-title-fg', '--td-base-title-bg', '--td-base-title-fg'],
      ['activity', '--td-activity-bg', '--td-activity-fg', '--td-base-activity-bg', '--td-base-activity-fg'],
      ['status', '--td-status-bg', '--td-status-fg', '--td-base-status-bg', '--td-base-status-fg']
    ];
    map.forEach(function (m) {
      var wear = on && state.targets[m[0]];
      vsc.style.setProperty(m[1], wear ? state.color : (read(m[3]) || 'transparent'));
      vsc.style.setProperty(m[2], wear ? ink : (read(m[4]) || 'inherit'));
    });
    vsc.style.setProperty('--td-accent', on ? state.color : 'transparent');
    /* Every path that changes a colour, a target or a theme ends here, so this
       is the one place the session slot has to be written from. */
    remember();
  }

  function anyOn() {
    return TARGETS.some(function (t) { return state.targets[t.key]; });
  }

  /* WHERE THE LIVE PANEL IS, in the hatch's own coordinates.

     The hatch is one element over the whole window and the panel is punched
     out of it, so the punch has to land exactly on the panel's boundary: a few
     pixels wide and there is hatch sitting on live UI, a few narrow and there
     is a bare stripe down the seam. So it is measured off the panel's own box
     rather than restated from the grid — `.vsc-mid` is
     `48px minmax(232px, 300px) 1fr` and a second copy of that in a clip-path
     would be a second thing to keep in step, which is how seams drift.

     `evenodd` is what makes the second rectangle a hole rather than a second
     shape. The alternative is winding back along a zero-width seam, which can
     leave a hairline on fractional device pixels.

     The same pass gives the wash its box, because the wash covers the editor
     and the editor is the other thing whose size the grid decides. */
  function measureDead() {
    if (!deadEl || !sideEl || !edEl) return;
    var host = vsc.getBoundingClientRect();
    var side = sideEl.getBoundingClientRect();
    var ed = edEl.getBoundingClientRect();
    var px = function (n) { return n.toFixed(2) + 'px'; };
    var l = side.left - host.left, t = side.top - host.top;
    var r = side.right - host.left, b = side.bottom - host.top;
    vsc.style.setProperty('--td-hatch-clip',
      'polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, ' +
      px(l) + ' ' + px(t) + ', ' + px(r) + ' ' + px(t) + ', ' +
      px(r) + ' ' + px(b) + ', ' + px(l) + ' ' + px(b) + ')');
    vsc.style.setProperty('--td-ed-x', px(ed.left - host.left));
    vsc.style.setProperty('--td-ed-y', px(ed.top - host.top));
    vsc.style.setProperty('--td-ed-w', px(ed.width));
    vsc.style.setProperty('--td-ed-h', px(ed.height));

    /* AND WHERE THE SWITCH SITS: centred in the empty space under the last line
       of code, which is the part of the frame that is showing nothing at all.

       Measured off the last line's own box rather than `scrollHeight`, which
       cannot answer this — it is defined as at least clientHeight, so it
       reports the container's height exactly when the content does not fill it,
       which is every case that matters here. Below about 70px of clearance
       there is no empty space to be centred in and it parks above the note
       instead; it has a solid fill, so overlapping a line of code costs
       legibility nothing. */
    var last = codeEl && codeEl.lastElementChild;
    var band = last ? ed.bottom - last.getBoundingClientRect().bottom : 0;
    vsc.style.setProperty('--td-sw-bottom', px(band > 70 ? band / 2 - 15 : 44));
  }

  function stashTargets() {
    if (anyOn()) parkedTargets = Object.assign({}, state.targets);
  }

  function restoreTargets() {
    if (anyOn()) return;
    var had = parkedTargets && TARGETS.some(function (t) { return parkedTargets[t.key]; });
    if (had) state.targets = Object.assign({}, parkedTargets);
    else state.targets.title = true;
  }

  /* ---------- panel ------------------------------------------------------- */

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  /* SVG built through the HTML parser rather than createElementNS + innerHTML:
     innerHTML on an SVG element is not universally reliable, and a <template>
     parses the same string correctly everywhere.

     width/height are NOT decoration. An <svg> with a viewBox and no intrinsic
     size falls back to the replaced-element default of 300x150, and panel.css
     sizes neither .ficon nor .bico because in the extension main.js emits them
     already sized. Without these the folder icon drew at 271px and squeezed
     the folder NAME to zero width, and the four action icons drew at 258px
     inside 33px buttons. */
  function icon(cls, inner, filled) {
    var t = document.createElement('template');
    t.innerHTML = '<svg viewBox="0 0 16 16" width="16" height="16" class="' + cls + '" aria-hidden="true" '
      + (filled ? 'fill="currentColor"' : 'fill="none" stroke="currentColor" stroke-width="1.3"')
      + '>' + inner + '</svg>';
    return t.content.firstChild;
  }

  function paintSwitches() {
    TARGETS.forEach(function (t) {
      var b = refs.switches[t.key];
      if (!b) return;
      var on = !!state.targets[t.key];
      b.className = 'sw' + (on ? ' on' : '');
      b.setAttribute('aria-pressed', String(on));
    });
  }

  function toggle(key) {
    state.targets[key] = !state.targets[key];
    if (!anyOn()) { stashTargets(); parked = state.color; }
    paintSwitches();
    paint();
  }

  function choose(color) {
    /* Clicking the colour you already have takes it off, the way the extension
       does — the swatch is a toggle, not a radio. */
    if (state.color === color && anyOn()) {
      parked = state.color;
      stashTargets();
      state.color = null;
      TARGETS.forEach(function (t) { state.targets[t.key] = false; });
    } else {
      state.color = color;
      restoreTargets();
    }
    render();
    paint();
  }

  function swatch(color) {
    var b = el('button', 'swatch' + (state.color === color && anyOn() ? ' sel' : ''));
    b.type = 'button';
    b.style.setProperty('background', color);
    b.setAttribute('aria-label', 'Use ' + color);
    b.setAttribute('aria-pressed', String(state.color === color && anyOn()));
    b.addEventListener('click', function () { choose(color); });
    return b;
  }

  function slot(i) {
    var color = custom[i];
    var b = el('button', 'slot' + (color ? '' : ' blank') + (editing === i ? ' open' : ''));
    b.type = 'button';
    if (color) b.style.setProperty('background', color);
    b.setAttribute('aria-label', color ? 'Custom colour ' + color : 'Empty custom slot');
    b.addEventListener('click', function () {
      if (editing === i) { slidersOpen = !slidersOpen; }
      else {
        editing = i;
        slidersOpen = true;
        draft = hexToHsb(color || state.color || '#007fff');
      }
      if (color) { state.color = color; restoreTargets(); }
      render();
      paint();
    });
    refs.slots[i] = b;
    return b;
  }

  function chead() {
    var head = el('div', 'chead');
    head.appendChild(el('div', 'label flat', 'Custom'));

    var minus = el('button', 'count', '\u2212');
    minus.type = 'button';
    minus.title = 'Remove a slot';
    minus.disabled = custom.length <= MIN_SLOTS && !custom.some(Boolean);
    minus.addEventListener('click', function () {
      if (custom.length > MIN_SLOTS) custom.pop();
      else custom[custom.length - 1] = null;      // never fewer than five
      if (editing !== null && editing >= custom.length) { editing = null; slidersOpen = false; }
      render();
    });

    var plus = el('button', 'count', '+');
    plus.type = 'button';
    plus.title = 'Add a slot';
    plus.disabled = custom.length >= MAX_SLOTS;
    plus.addEventListener('click', function () {
      if (custom.length < MAX_SLOTS) custom.push(null);
      render();
    });

    head.appendChild(minus);
    head.appendChild(plus);

    var value = (editing !== null && custom[editing]) || state.color || '#007fff';
    var box = el('div', 'hexbox');
    box.appendChild(el('span', 'hash', '#'));

    var input = el('input', 'hexin');
    input.type = 'text';
    input.value = clean(value).slice(1);
    input.spellcheck = false;
    input.maxLength = 6;
    input.setAttribute('aria-label', 'Hex colour');
    input.addEventListener('input', function () {
      var hex = clean('#' + input.value);
      box.classList.toggle('bad', !hex && input.value.length >= 3);
      if (!hex) return;
      state.color = hex;
      restoreTargets();
      if (editing !== null) { custom[editing] = hex; if (refs.slots[editing]) refs.slots[editing].style.setProperty('background', hex); }
      draft = hexToHsb(hex);
      paintSwitches();
      paint();
    });
    refs.hexInput = input;
    box.appendChild(input);

    var copy = el('button', 'copy');
    copy.type = 'button';
    copy.title = 'Copy hex';
    copy.setAttribute('aria-label', 'Copy the hex value');
    copy.innerHTML = '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true">'
      + '<rect x="5.6" y="5.6" width="8" height="8" rx="1.4"/>'
      + '<path d="M10.4 3.2V3a1.4 1.4 0 0 0-1.4-1.4H3.6A1.4 1.4 0 0 0 2.2 3v5.4A1.4 1.4 0 0 0 3.6 9.8h.2"/></svg>';
    copy.addEventListener('click', function () {
      var text = '#' + input.value;
      var done = function () {
        copy.classList.add('done');
        setTimeout(function () { copy.classList.remove('done'); }, 1400);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, function () {});
      } else {
        input.select();
        try { document.execCommand('copy'); done(); } catch (e) { /* no clipboard */ }
      }
    });
    box.appendChild(copy);
    head.appendChild(box);
    return head;
  }

  function sliders() {
    var wrap = el('div', 'editor');
    var rows = [
      { key: 'H', cls: 'hue', prop: 'h', max: 360 },
      { key: 'S', cls: 'sat', prop: 's', max: 100 },
      { key: 'B', cls: 'val', prop: 'v', max: 100 }
    ];
    rows.forEach(function (r) {
      var row = el('div', 'srow');
      row.appendChild(el('span', 'skey', r.key));
      var input = el('input', 'range ' + r.cls);
      input.type = 'range';
      input.min = '0';
      input.max = String(r.max);
      input.value = String(draft[r.prop]);
      input.setAttribute('aria-label', { H: 'Hue', S: 'Saturation', B: 'Brightness' }[r.key]);
      input.addEventListener('input', function () {
        draft[r.prop] = Number(input.value);
        var hex = hsbToHex(draft.h, draft.s, draft.v);
        /* Never re-render mid-drag: rebuilding the input drops pointer capture
           and the slider stops following the mouse. Write to the live nodes. */
        wrap.style.setProperty('--hue', hsbToHex(draft.h, 100, 100));
        if (editing !== null) {
          custom[editing] = hex;
          if (refs.slots[editing]) {
            refs.slots[editing].style.setProperty('background', hex);
            refs.slots[editing].classList.remove('blank');
          }
        }
        state.color = hex;
        restoreTargets();
        if (refs.hexInput) refs.hexInput.value = hex.slice(1);
        paintSwitches();
        paint();
      });
      row.appendChild(input);
      wrap.appendChild(row);
    });
    wrap.style.setProperty('--hue', hsbToHex(draft.h, 100, 100));
    return wrap;
  }

  function themeCell(t) {
    var b = el('button', 'theme' + (state.theme === t.key ? ' sel' : ''));
    b.type = 'button';
    b.title = t.name;
    b.setAttribute('aria-pressed', String(state.theme === t.key));
    var chip = el('span', 'chip');
    chip.style.setProperty('background', t.swatch);
    b.appendChild(chip);
    b.appendChild(el('span', 'tname', t.label));
    b.addEventListener('click', function () {
      state.theme = t.key;
      applyTheme();
      paintCode();
      render();
      paint();
    });
    return b;
  }

  function actions() {
    var wrap = el('div', 'actions');
    var add = function (label, path, note, cls) {
      var b = el('button', 'act-btn' + (cls ? ' ' + cls : ''));
      b.type = 'button';
      b.title = note;
      b.appendChild(icon('bico', path));
      b.appendChild(el('span', 'blabel', label));
      b.addEventListener('click', function () { toast(note); });
      wrap.appendChild(b);
    };
    add('New Window', '<rect x="2" y="3" width="12" height="10" rx="1.4"/><path d="M2 6h12"/>',
      'Opens an empty VS Code window — nothing to open from a web page.');
    add('Duplicate Window', '<rect x="2" y="4.5" width="9" height="8" rx="1.2"/><path d="M5 4.5V3.4A1.4 1.4 0 0 1 6.4 2H13a1 1 0 0 1 1 1v6.6a1.4 1.4 0 0 1-1.4 1.4h-1.1"/>',
      'Opens this same folder in a second window — only inside VS Code.');
    add('Open Folder', '<path d="M2 12.5v-9h4l1.4 1.6H14v7.4z"/>',
      'Picks a folder to open in this window — only inside VS Code.');

    var row = el('div', 'act-row');
    var reload = el('button', 'act-btn warn');
    reload.type = 'button';
    reload.title = 'Reload this window';
    reload.appendChild(icon('bico', '<path d="M13.5 8a5.5 5.5 0 1 1-1.7-4"/><path d="M13.6 2.4v3.4h-3.4"/>'));
    reload.appendChild(el('span', 'blabel', 'Reload Window'));
    reload.addEventListener('click', function () {
      /* The one action with a truthful demo: reset the preview to how it opens.
         In the extension this reloads the editor, which is the same idea. */
      state = { color: '#007fff', targets: { title: true, activity: false, status: false }, theme: state.theme };
      custom = [null, null, null, null, null];
      editing = null;
      slidersOpen = false;
      render();
      paint();
      toast('Reset the preview. In VS Code this reloads the window.');
    });
    row.appendChild(reload);
    wrap.appendChild(row);
    return wrap;
  }

  function render() {
    root.innerHTML = '';
    refs.slots = [];
    refs.hexInput = null;
    refs.switches = {};

    var folder = el('div', 'folder');
    folder.appendChild(icon('ficon', '<path d="M2 12.8V3.6h3.9l1.3 1.5H14v7.7z"/>', true));
    folder.appendChild(el('span', 'fname', 'surveyor'));
    folder.title = 'surveyor';
    root.appendChild(folder);

    root.appendChild(el('div', 'label', 'Apply to'));

    var row = el('div', 'switches last');
    TARGETS.forEach(function (t) {
      var b = el('button', 'sw' + (state.targets[t.key] ? ' on' : ''));
      b.type = 'button';
      b.setAttribute('aria-pressed', String(!!state.targets[t.key]));
      b.appendChild(el('span', 'knob'));
      b.appendChild(el('span', 'lbl', t.label));
      b.addEventListener('click', function () { toggle(t.key); });
      refs.switches[t.key] = b;
      row.appendChild(b);
    });
    root.appendChild(row);

    var grid = el('div', 'grid');
    PALETTE.forEach(function (c) { grid.appendChild(swatch(c)); });
    root.appendChild(grid);

    root.appendChild(chead());

    var slots = el('div', 'slots');
    for (var i = 0; i < custom.length; i++) slots.appendChild(slot(i));
    root.appendChild(slots);

    if (editing !== null && slidersOpen) root.appendChild(sliders());

    root.appendChild(el('div', 'label spaced', 'Theme'));
    var themes = el('div', 'themes');
    THEMES.forEach(function (t) { themes.appendChild(themeCell(t)); });
    root.appendChild(themes);

    root.appendChild(actions());
  }

  /* ---------- toast ------------------------------------------------------- */

  var toastTimer = null;
  function toast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('is-on'); }, 3200);
  }

  /* ---------- the editor's sample file ------------------------------------ */

  var SAMPLE = [
    '// Which window am I in? The colour answers before the title bar does.',
    "import { workspace, window } from 'vscode';",
    '',
    'const TARGETS = [\'titleBar\', \'activityBar\', \'statusBar\'];',
    '',
    '/** Paint one window and remember it with the folder. */',
    'export async function dock(color, targets = TARGETS) {',
    '  const config = workspace.getConfiguration();',
    '  const ink = luminance(color) > 0.42 ? \'#15181d\' : \'#ffffff\';',
    '',
    '  const custom = {};',
    '  for (const target of targets) {',
    '    custom[`${target}.activeBackground`] = color;',
    '    custom[`${target}.activeForeground`] = ink;',
    '  }',
    '',
    '  await config.update(\'workbench.colorCustomizations\', custom, false);',
    '  window.setStatusBarMessage(`ThemeDock: ${color}`, 2000);',
    '}',
    '',
    'function luminance(hex) {',
    '  const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)',
    '    .map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));',
    '  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];',
    '}'
  ];

  var KEYWORDS = /^(import|from|export|async|function|const|let|var|return|for|of|in|await|if|else|new|class|extends|typeof|null|undefined|true|false)$/;

  /* A tokeniser, not a parser: enough to make the theme's colours legible on a
     page of real-looking code, and nothing more. */
  function paintCode() {
    if (!codeEl) return;
    codeEl.innerHTML = '';
    SAMPLE.forEach(function (line, i) {
      var ln = el('div', 'vsc-ln');
      var no = el('span', 'vsc-ln-no', String(i + 1));
      var src = el('span', 'vsc-ln-src');
      tokens(line).forEach(function (t) {
        src.appendChild(el('span', 'tk tk-' + t.k, t.t));
      });
      ln.appendChild(no);
      ln.appendChild(src);
      codeEl.appendChild(ln);
    });
  }

  function tokens(line) {
    var out = [];
    var re = /(\/\/.*$|\/\*\*?|\*\/|\*\s)|('[^']*'|`[^`]*`|"[^"]*")|(\b\d[\d.]*\b)|([A-Za-z_$][\w$]*)|(\s+)|([^\sA-Za-z_$\d])/g;
    var m;
    var inBlock = /^\s*(\/\*|\*)/.test(line);
    if (inBlock) return [{ k: 'comment', t: line }];
    while ((m = re.exec(line))) {
      if (m[1]) out.push({ k: 'comment', t: m[0] });
      else if (m[2]) out.push({ k: 'string', t: m[0] });
      else if (m[3]) out.push({ k: 'number', t: m[0] });
      else if (m[4]) {
        var word = m[0];
        var after = line.slice(re.lastIndex);
        if (KEYWORDS.test(word)) out.push({ k: 'keyword', t: word });
        else if (/^\s*\(/.test(after)) out.push({ k: 'func', t: word });
        else if (/^[A-Z][A-Z0-9_]*$/.test(word) || /^[A-Z]/.test(word)) out.push({ k: 'type', t: word });
        else if (out.length && out[out.length - 1].t === '.') out.push({ k: 'prop', t: word });
        else out.push({ k: 'var', t: word });
      } else if (m[5]) out.push({ k: 'text', t: m[0] });
      else out.push({ k: 'op', t: m[0] });
    }
    return out;
  }

  /* ---------- the hatching switch ----------------------------------------- */

  function paintHatch() {
    if (deadEl) deadEl.classList.toggle('no-hatch', !hatchOn);
    if (hatchSw) hatchSw.setAttribute('aria-checked', String(hatchOn));
  }

  if (hatchSw) {
    hatchSw.addEventListener('click', function () {
      hatchOn = !hatchOn;
      paintHatch();
      remember();
    });
  }

  /* ---------- escape ------------------------------------------------------ */

  /* INNERMOST FIRST, and the second half of that is not in this file.

     Inside the site's overlay this page is an iframe, so once anything here has
     been clicked the parent <dialog> never sees Escape — the key belongs to the
     document that has focus. The parent listens on this document too (see
     `initAppModal` in the site's script.js) and closes the window only when the
     event was NOT default-prevented. So claiming Escape here is how the slider
     popover gets to close first, and letting it through is how the window
     closes on the next press.

     `slidersOpen` and `editing` are cleared together on purpose. They are one
     thing to a person — the slot you have open, with its sliders under it — and
     making that two presses before the window will close is one more than
     anybody counts. */
  window.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' && e.key !== 'Esc') return;
    if (!slidersOpen && editing === null) return;   // nothing of ours; let it close the window
    e.preventDefault();
    slidersOpen = false;
    editing = null;
    render();
    paint();
  });

  /* ---------- start ------------------------------------------------------- */

  /* embed=1 is set by the site's overlay, which has already drawn the frame.
     Free-standing, the page draws its own. Same flag MindSplit uses. */
  if (/(^|[?&])embed=1(&|$)/.test(location.search)) document.body.classList.add('is-embed');

  recall();
  applyTheme();
  paintCode();
  render();
  paint();
  paintHatch();
  measureDead();

  /* The panel column is `minmax(232px, 300px)`, so its box moves whenever the
     window does — and the window is an iframe the site resizes. Observing the
     window rather than listening for `resize` also catches the overlay opening
     at a size the page never had a resize event for. */
  if (window.ResizeObserver) new ResizeObserver(measureDead).observe(vsc);
  else window.addEventListener('resize', measureDead);
})();
