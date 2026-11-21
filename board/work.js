/* Dex Board Work tab ("Mission Control" Work).

   Round 3 layout: a short, priority-ordered board in the shape of the
   Clayweld dev board's blocks. Eleven blocks in one .board-grid, in this
   order: Dex Actions, Today, This Week, Clients, Cash Log, Quick Cash,
   Pipeline, Funding, Outreach Lanes, Research and Long Shots, Reference.

   The face of every block is one short line per row (about 60 characters,
   two lines at most), a status pill where it helps and the checkbox the row
   always had. Everything else (the full text, contact details, notes,
   rulings, the agent-facing "why" prose, and whole lane tools such as the
   searchable pipeline or the backer filters) sits one click deeper: a row
   is a button that opens its detail in place, built on first open. A lane
   row is the same thing with a whole tool behind it.

   State: ticks, week edits, the one liner, client status and notes, backer
   flags and the cash log live in the board's own board-work doc through
   ctx.store, seeded from the file defaults in board/data/*.js. The shape
   of that doc is unchanged from earlier rounds. The old Mission Control
   app's live Redis record is not readable from here (DexAuth bearer only,
   no CORS), so it is not wired; migrating it into board-work is the
   listed follow up.

   No element scrolls inside itself: long lists show their first rows and a
   "Show all (N)" more-btn; lists over LAZY_OVER rows only build their
   hidden rows once opened. Styles live in board/work.css. */

import FRONT from "./data/front.js";
import PIPELINE from "./data/pipeline.js";
import QUICKCASH from "./data/quickcash.js";
import BASH from "./data/bash-lane.js";
import GPT from "./data/gpt-lane.js";
import GPT_LEADS from "./data/gpt-leads.js";
import GPT_AUDIT from "./data/gpt-audit.js";
import GPT_OPPS from "./data/gpt-opps.js";
import BACKERS from "./data/backers.js";
import WEBDESIGN from "./data/webdesign.js";
import CLIENTS from "./data/clients.js";
import GUIDES from "./data/guides.js";
import INCOME from "./data/income.js";
import MOON from "./data/moon-cheats.js";
import ARCHIVE from "./data/archive.js";

let state = null;
let storeRef = null;
let rootEl = null;
/* Lane rows by key, so the Bash lane index can open another lane. */
let drawers = new Map();

/* Rows a list shows before its "Show all" button, on a block face and
   inside an opened lane. */
const FACE = 5;
const CLAMP = 4;
/* Above this many rows the hidden rows are not built until opened. */
const LAZY_OVER = 120;
/* Face text length. */
const FACE_MAX = 60;

function blankState() {
  return {
    checks: {},
    weekAdded: [],
    weekRemoved: [],
    oneLiner: "",
    clientStatus: {},
    clientNotes: {},
    backerDone: {},
    cashLog: [],
  };
}

function saveState() {
  if (storeRef && state) storeRef.save("board-work", state);
}

function defaultDone(item) {
  if (!item) return false;
  if (item.d === 1 || item.d === true || item.done === true) return true;
  const hist = GPT.history && item.id ? GPT.history[item.id] : null;
  if (hist && (hist.d === 1 || hist.d === true)) return true;
  return false;
}

function isDone(item) {
  if (state && item && item.id && Object.prototype.hasOwnProperty.call(state.checks, item.id)) {
    return !!state.checks[item.id];
  }
  return defaultDone(item);
}

function setDone(item, done) {
  if (!item || !item.id) return;
  state.checks[item.id] = !!done;
  saveState();
}

/* ---------- small DOM helpers ---------- */

function h(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

/* Status tag. kind: "" | "hot" | "good" | "warn" | "bad". */
function pill(text, kind) {
  return h("span", "pill" + (kind ? " " + kind : ""), text);
}

function str(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.map(str).join("\n");
  return JSON.stringify(v, null, 1);
}

/* The source data writes a dash as " ,  "; show it as a dash. Display only,
   the data is never changed. */
function clean(text) {
  return str(text).replace(/ ,  /g, " — ");
}

/* One short face line: the text as is when it fits, else cut at a natural
   break (a dash, a middle dot, a colon or a full stop) when that leaves a
   real phrase, else at a word. The full text sits in the row's detail. */
function shortText(text, max) {
  const lim = max || FACE_MAX;
  const s = clean(text).replace(/\s+/g, " ").trim();
  if (s.length <= lim) return s;
  for (const sep of [" — ", " · ", ": ", ". "]) {
    const i = s.indexOf(sep);
    if (i >= 22 && i <= lim) return s.slice(0, i);
  }
  const cut = s.lastIndexOf(" ", lim - 1);
  return s.slice(0, cut > lim * 0.6 ? cut : lim - 1).replace(/[\s,.;:·—-]+$/, "") + "…";
}

function note(text) {
  return h("p", "wk-note", clean(text));
}

function longText(text) {
  return h("div", "wk-long", clean(text));
}

function sectionHead(text, extra) {
  const head = h("div", "wk-sec");
  head.appendChild(h("span", "wk-sec-title", text));
  if (extra) head.appendChild(extra);
  return head;
}

function link(url, label) {
  const a = h("a", "wk-link", label || url);
  a.href = url;
  a.target = "_blank";
  a.rel = "noopener";
  return a;
}

function copyButton(text, label) {
  const b = h("button", "board-btn is-small", label || "Copy");
  b.type = "button";
  b.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(typeof text === "function" ? text() : (text || ""));
      b.textContent = "Copied";
    } catch (err) {
      b.textContent = "Copy failed";
    }
    setTimeout(() => { b.textContent = label || "Copy"; }, 1200);
  });
  return b;
}

/* A folded long text, for the few places a second level is clearer than
   one long body (pass logs, audit JSON, a guide's full text). */
function textDetails(summary, text, mono) {
  const det = document.createElement("details");
  det.className = "wk-det";
  det.appendChild(h("summary", null, summary));
  det.appendChild(h(mono ? "pre" : "div", mono ? "wk-pre" : "wk-long", mono ? str(text) : clean(text)));
  return det;
}

function kvStrip(cells) {
  const kv = h("div", "kv");
  for (const [value, label] of cells) {
    const cell = h("div", "cell");
    cell.appendChild(h("b", null, value));
    cell.appendChild(h("span", null, label));
    kv.appendChild(cell);
  }
  return kv;
}

const SKIP_DETAIL = new Set(["id", "t", "title", "name", "co", "d", "g", "items", "moves", "url"]);

function detailValue(parent, key, val) {
  if (val === null || val === undefined || val === "") return;
  const row = h("div", "wk-kvrow");
  const label = key.startsWith("detail") && key.length > 6 ? key.slice(6).toLowerCase() : key;
  row.appendChild(h("span", "wk-key", label));
  if (Array.isArray(val)) {
    const list = h("ul", "wk-ul");
    for (const entry of val) list.appendChild(h("li", null, typeof entry === "object" ? JSON.stringify(entry) : clean(entry)));
    row.appendChild(list);
  } else if (typeof val === "object") {
    row.appendChild(h("pre", "wk-pre", JSON.stringify(val, null, 1)));
  } else {
    row.appendChild(h("span", "wk-val", clean(val)));
  }
  parent.appendChild(row);
}

/* Every field of a record as label and value, plus its link. Detail fields
   (contact data, long notes) only ever render here, inside an opened row. */
function fieldsFor(obj, skipExtra, first) {
  const body = h("div", "wk-fields");
  const skip = new Set(SKIP_DETAIL);
  if (skipExtra) for (const k of skipExtra) skip.add(k);
  const keys = Object.keys(obj || {});
  const order = first ? [...first.filter((k) => keys.includes(k)), ...keys.filter((k) => !first.includes(k))] : keys;
  let any = false;
  for (const key of order) {
    if (skip.has(key)) continue;
    const val = obj[key];
    if (val === null || val === undefined || val === "") continue;
    if (typeof val === "boolean" && key.startsWith("no")) continue;
    detailValue(body, key, val);
    any = true;
  }
  if (obj && obj.url) {
    body.appendChild(link(obj.url, "Open link"));
    any = true;
  }
  return any ? body : null;
}

/* ---------- the row: one line on the face, detail one click deeper ---------- */

/* o: text (face, trimmed), full (detail text when longer than the face;
   defaults to text), check (an item read and written through isDone and
   setDone) or checked + onCheck (custom store), pill + pillKind, meta (short
   mono text at the right), detail() (nodes built on first open), extra
   (nodes appended to the line, e.g. a remove button), onToggle, strong. */
function row(o) {
  const li = h("li", "board-list-item wk-item");
  const line = h("div", "board-row wk-line");
  if (o.check || o.onCheck) {
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = o.check ? isDone(o.check) : !!o.checked;
    if (o.checkTitle) box.title = o.checkTitle;
    box.setAttribute("aria-label", "Done: " + shortText(o.text, 40));
    li.classList.toggle("is-done", box.checked);
    box.addEventListener("change", () => {
      if (o.check) setDone(o.check, box.checked);
      if (o.onCheck) o.onCheck(box.checked);
      li.classList.toggle("is-done", box.checked);
      if (typeof o.onToggle === "function") o.onToggle();
    });
    line.appendChild(box);
  }
  const full = clean(o.full !== undefined ? o.full : o.text);
  const face = shortText(o.text);
  const trimmed = face !== clean(o.text).replace(/\s+/g, " ").trim() || (o.full !== undefined && clean(o.full) !== clean(o.text));
  const opens = !!o.detail || trimmed;
  const btn = h(opens ? "button" : "div", "wk-rowbtn" + (opens ? "" : " is-static") + (o.strong ? " wk-strong" : ""));
  if (opens) {
    btn.type = "button";
    btn.setAttribute("aria-expanded", "false");
  }
  btn.appendChild(h("span", "row-text", face));
  line.appendChild(btn);
  if (o.meta) line.appendChild(h("span", "row-meta", o.meta));
  let tag = null;
  if (o.pill) {
    tag = pill(o.pill, o.pillKind);
    line.appendChild(tag);
  }
  for (const node of o.extra || []) line.appendChild(node);
  li.appendChild(line);
  let more = null;
  const setOpen = (open) => {
    if (!opens) return;
    if (open && !more) {
      more = h("div", "wk-more");
      more.hidden = true;
      if (trimmed && full) more.appendChild(longText(full));
      const built = o.detail ? o.detail(more) : null;
      for (const n of [].concat(built || [])) if (n) more.appendChild(n);
      li.appendChild(more);
    }
    if (!more) return;
    more.hidden = !open;
    li.classList.toggle("is-open", open);
    btn.setAttribute("aria-expanded", open ? "true" : "false");
  };
  if (opens) btn.addEventListener("click", () => setOpen(!(more && !more.hidden)));
  li.open = () => setOpen(true);
  li.setPill = (text, kind) => {
    if (!text) { if (tag) tag.hidden = true; return; }
    if (!tag) {
      tag = pill("", "");
      line.insertBefore(tag, (o.extra && o.extra[0]) || null);
    }
    tag.hidden = false;
    tag.textContent = text;
    tag.className = "pill" + (kind ? " " + kind : "");
  };
  return li;
}

/* A lane row: a one line name with a count pill whose whole tool is built
   behind the click. build(host, setPill) fills the opened area and may keep
   the pill current. key registers it for the Bash lane index. */
function laneRow(list, o) {
  let li = null;
  const setPill = (text, kind) => { if (li) li.setPill(text, kind || o.pillKind); };
  li = row({
    text: o.text,
    pill: o.pill,
    pillKind: o.pillKind,
    meta: o.meta,
    strong: true,
    detail: (host) => {
      host.classList.add("wk-lane");
      o.build(host, setPill);
      return null;
    },
  });
  li.classList.add("wk-lane-row");
  if (o.key) drawers.set(o.key, li);
  list.appendChild(li);
  return li;
}

/* ---------- blocks ---------- */

/* prio 1 (act now) .. 4 (reference) colours the block's edge. */
function block(grid, id, title, prio, opts) {
  const options = opts || {};
  const card = h("section", "board-card wk-card");
  card.id = id;
  card.dataset.prio = String(prio || 3);
  if (options.span) card.dataset.span = options.span;
  const head = h("div", "board-card-head");
  head.appendChild(h("h3", "board-card-title", title));
  const right = h("div", "wk-head-right");
  if (options.flag) right.appendChild(pill(options.flag, options.flagKind || "warn"));
  const count = pill("", options.pillKind || "");
  count.hidden = true;
  right.appendChild(count);
  head.appendChild(right);
  card.appendChild(head);
  const body = h("div", "board-card-body");
  card.appendChild(body);
  grid.appendChild(card);
  const setCount = (txt, kind) => {
    count.textContent = txt || "";
    count.hidden = !txt;
    if (kind !== undefined) count.className = "pill" + (kind ? " " + kind : "");
  };
  if (options.pill) setCount(options.pill);
  return { card, body, setCount };
}

function plainList(parent) {
  const ul = h("ul", "board-list");
  parent.appendChild(ul);
  return ul;
}

/* ---------- clamped lists ---------- */

/* A list that shows its first n rows and a more-btn for the rest. set(rows,
   make) redraws it (a search or filter calls it again); the open or shut
   state survives a redraw. Rows past n carry is-clamped-out; above
   LAZY_OVER rows the hidden ones are only built once opened. */
function clampedList(parent, n, emptyText, tag) {
  const list = h(tag || "ul", "board-list");
  const btn = h("button", "more-btn");
  btn.type = "button";
  let open = false;
  let rows = [];
  let make = null;
  const draw = () => {
    list.replaceChildren();
    const lazy = rows.length > LAZY_OVER && !open;
    const slice = lazy ? rows.slice(0, n) : rows;
    slice.forEach((r, i) => {
      const li = make(r, i);
      if (!open && i >= n) li.classList.add("is-clamped-out");
      list.appendChild(li);
    });
    if (!rows.length && emptyText) list.appendChild(h("li", "board-empty", emptyText));
    btn.hidden = rows.length <= n;
    btn.textContent = open ? "Show fewer" : "Show all (" + rows.length + ")";
    btn.setAttribute("aria-expanded", open ? "true" : "false");
  };
  btn.addEventListener("click", () => {
    open = !open;
    draw();
  });
  parent.appendChild(list);
  parent.appendChild(btn);
  return {
    list,
    btn,
    set(newRows, maker) {
      rows = newRows || [];
      if (maker) make = maker;
      draw();
    },
    /* Open it, so a row just added at the end is on screen. */
    expand() {
      if (!open && rows.length > n) { open = true; draw(); }
    },
  };
}

/* Same clamp for children already built (tag clouds). */
function clampChildren(container, n, label) {
  const kids = [...container.children];
  if (kids.length <= n) return null;
  const btn = h("button", "more-btn");
  btn.type = "button";
  let open = false;
  const apply = () => {
    kids.forEach((k, i) => k.classList.toggle("is-clamped-out", !open && i >= n));
    btn.textContent = open ? "Show fewer" : "Show all (" + kids.length + (label ? " " + label : "") + ")";
    btn.setAttribute("aria-expanded", open ? "true" : "false");
  };
  btn.addEventListener("click", () => { open = !open; apply(); });
  apply();
  container.after(btn);
  return btn;
}

function tagCloud(parent, names, n) {
  const wrap = h("div", "wk-tags");
  for (const name of names) wrap.appendChild(h("span", "wk-tag", name));
  parent.appendChild(wrap);
  clampChildren(wrap, n || 18);
  return wrap;
}

/* ---------- checklist rendering ---------- */

const ITEM_SKIP = ["body", "status", "owner", "priority", "checked", "leadId", "hot", "done"];

function checklistItem(item, opts) {
  const options = opts || {};
  const text = item.t || item.title || item.name || item.id || "";
  const meta = [item.owner, item.status].filter(Boolean).join(", ");
  return row({
    text,
    check: item,
    pill: options.pill,
    pillKind: options.pillKind,
    extra: options.extra,
    onToggle: options.onToggle,
    detail: () => {
      const out = [];
      if (meta) out.push(h("span", "wk-meta", meta));
      if (item.body) out.push(longText(item.body));
      const f = fieldsFor(item, ITEM_SKIP);
      if (f) out.push(f);
      return out.length ? out : null;
    },
  });
}

function flatChecklist(parent, items, opts) {
  const options = opts || {};
  const cl = clampedList(parent, options.n || CLAMP);
  cl.set(items, (item) => checklistItem(item, { onToggle: options.onToggle }));
  return cl;
}

function doneOf(items) {
  return items.filter((it) => isDone(it)).length + "/" + items.length;
}

/* Groups render as one lane row each (name, owner, done count); opening one
   shows its items, clamped. */
function checklistGroups(parent, groups, opts) {
  const options = opts || {};
  const allItems = [];
  const list = plainList(parent);
  list.classList.add("wk-groups");
  for (const group of groups) {
    const items = group.items || [];
    for (const it of items) allItems.push(it);
    const name = (group.ownerLabel ? group.ownerLabel + ": " : "") + (group.g || "Items");
    laneRow(list, {
      text: name,
      pill: doneOf(items),
      build: (host, setPill) => {
        flatChecklist(host, items, { onToggle: () => { setPill(doneOf(items)); if (options.onToggle) options.onToggle(); } });
      },
    });
  }
  if (list.children.length > 6) {
    const kids = [...list.children];
    const btn = h("button", "more-btn");
    btn.type = "button";
    let open = false;
    const apply = () => {
      kids.forEach((k, i) => k.classList.toggle("is-clamped-out", !open && i >= 6));
      btn.textContent = open ? "Show fewer" : "Show all (" + kids.length + " groups)";
    };
    btn.addEventListener("click", () => { open = !open; apply(); });
    apply();
    list.after(btn);
  }
  return allItems;
}

function searchInput(placeholder, onInput) {
  const input = h("input", "board-input");
  input.type = "search";
  input.placeholder = placeholder;
  input.setAttribute("aria-label", placeholder);
  input.addEventListener("input", () => onInput(input.value.trim().toLowerCase()));
  return input;
}

function chipRow(labels, active, onPick) {
  const r = h("div", "chip-row");
  for (const label of labels) {
    const b = h("button", "chip", label);
    b.type = "button";
    b.setAttribute("aria-pressed", label === active ? "true" : "false");
    b.addEventListener("click", () => onPick(label));
    r.appendChild(b);
  }
  return r;
}

function shortPay(pay) {
  const p = clean(pay).trim();
  return p && p.length <= 16 ? p : "";
}

/* A lead, company or channel: its name on the face, the reason first in the
   detail and every other field under it. */
function leadRow(lead) {
  return row({
    text: lead.co || lead.name || lead.id || "",
    strong: true,
    meta: shortPay(lead.pay),
    detail: () => {
      const out = [];
      const meta = [lead.role, lead.pay, lead.status, lead.lane, lead.checked].filter(Boolean).map(clean).join(", ");
      if (meta) out.push(h("span", "wk-meta", meta));
      if (lead.why) out.push(longText(lead.why));
      const f = fieldsFor(lead, ["role", "pay", "why", "status", "lane", "checked"]);
      if (f) out.push(f);
      return out;
    },
  });
}

function listOfStrings(parent, lines, n) {
  const cl = clampedList(parent, n || CLAMP);
  cl.set(lines, (line) => row({ text: typeof line === "string" ? line : JSON.stringify(line) }));
  return cl;
}

/* ---------- 1. Dex Actions ---------- */

function buildDexActions(grid) {
  const seen = new Set();
  const items = [];
  for (const item of [...(BASH.dex || []), ...(GPT.dex || [])]) {
    if (item.id && seen.has(item.id)) continue;
    if (item.id) seen.add(item.id);
    items.push(item);
  }
  /* Open first, done after; order is fixed at mount so a tick never jumps. */
  const ordered = [...items.filter((it) => !isDone(it)), ...items.filter((it) => isDone(it))];
  const shell = block(grid, "work-dex-actions", "Dex Actions", 1, { pillKind: "hot" });
  const formGroup = (GPT.focused || []).find((g) => String(g.g || "").startsWith("Form packets"));
  const subItems = formGroup ? formGroup.items || [] : [];
  const update = () => {
    const open = [...items, ...subItems].filter((it) => !isDone(it)).length;
    shell.setCount(open + " open", open ? "hot" : "good");
  };
  const cl = clampedList(shell.body, FACE);
  cl.set(ordered, (item) => checklistItem(item, { onToggle: update }));
  if (formGroup) {
    laneRow(plainList(shell.body), {
      text: "Form packets: Bash fills, Dex clicks",
      pill: doneOf(subItems),
      build: (host, setPill) => {
        flatChecklist(host, subItems, { onToggle: () => { setPill(doneOf(subItems)); update(); } });
      },
    });
  }
  update();
}

/* ---------- 2. Today ---------- */

function buildToday(grid) {
  const shell = block(grid, "work-today", "Today", 1, {});
  const daily = FRONT.daily || [];
  const start = FRONT.start || [];
  const update = () => shell.setCount(doneOf(daily) + " done", daily.every((it) => isDone(it)) ? "good" : "");
  const list = plainList(shell.body);
  for (const item of daily) list.appendChild(checklistItem(item, { onToggle: update }));
  update();
  laneRow(plainList(shell.body), {
    text: "Set up once",
    pill: doneOf(start),
    build: (host, setPill) => {
      flatChecklist(host, start, { n: start.length, onToggle: () => setPill(doneOf(start)) });
    },
  });
}

/* ---------- 3. This Week ---------- */

function buildWeek(grid) {
  const shell = block(grid, "work-week", "This Week", 1, {});
  const week = clampedList(shell.body, FACE, "No week items. Add one below.");
  const renderWeek = () => {
    const seed = (FRONT.week || []).filter((w) => !state.weekRemoved.includes(w.id));
    const all = [...seed, ...state.weekAdded];
    const ordered = [...all.filter((it) => !isDone(it)), ...all.filter((it) => isDone(it))];
    week.set(ordered, (item) => {
      const remove = h("button", "row-x", "×");
      remove.type = "button";
      remove.title = "Remove";
      remove.setAttribute("aria-label", "Remove " + shortText(item.t || "item", 40));
      remove.addEventListener("click", () => {
        if (String(item.id).startsWith("w") && !String(item.id).startsWith("wk")) state.weekRemoved.push(item.id);
        state.weekAdded = state.weekAdded.filter((x) => x.id !== item.id);
        saveState();
        renderWeek();
      });
      return checklistItem(item, {
        pill: item.hot && !isDone(item) ? "Urgent" : "",
        pillKind: "bad",
        extra: [remove],
        onToggle: () => countWeek(),
      });
    });
    countWeek();
  };
  const countWeek = () => {
    const seed = (FRONT.week || []).filter((w) => !state.weekRemoved.includes(w.id));
    const all = [...seed, ...state.weekAdded];
    const open = all.filter((it) => !isDone(it)).length;
    shell.setCount(open + " open", open ? "hot" : "good");
  };
  renderWeek();
  const addRow = h("div", "add-row");
  const addInput = h("input", "board-input");
  addInput.placeholder = "Add a week item";
  addInput.setAttribute("aria-label", "Add a week item");
  const addBtn = h("button", "board-btn", "Add");
  addBtn.type = "button";
  const add = () => {
    const text = addInput.value.trim();
    if (!text) return;
    state.weekAdded.push({ id: "wk" + Date.now(), t: text });
    addInput.value = "";
    saveState();
    renderWeek();
    week.expand();
  };
  addBtn.addEventListener("click", add);
  addInput.addEventListener("keydown", (e) => { if (e.key === "Enter") add(); });
  addRow.appendChild(addInput);
  addRow.appendChild(addBtn);
  shell.body.appendChild(addRow);
}

/* ---------- 4. Clients ---------- */

function buildClients(grid) {
  const shell = block(grid, "work-clients", "Clients", 2, {});
  const clients = CLIENTS.clients || [];
  const statusKind = { "In Progress": "hot", Completed: "good", Cancelled: "bad" };
  const updateCount = () => {
    const live = clients.filter((c) => (state.clientStatus[c.id] || "In Progress") === "In Progress").length;
    shell.setCount(live + " active", live ? "hot" : "");
  };
  const list = plainList(shell.body);
  for (const client of clients) {
    const status = state.clientStatus[client.id] || "In Progress";
    let li = null;
    li = row({
      text: client.co || client.id || "Client",
      strong: true,
      pill: status,
      pillKind: statusKind[status],
      detail: () => {
        const out = [];
        const select = h("select", "board-select wk-select");
        select.setAttribute("aria-label", "Client status");
        for (const s of ["In Progress", "Completed", "Cancelled"]) {
          const opt = h("option", null, s);
          opt.value = s;
          select.appendChild(opt);
        }
        select.value = state.clientStatus[client.id] || "In Progress";
        select.addEventListener("change", () => {
          state.clientStatus[client.id] = select.value;
          li.setPill(select.value, statusKind[select.value]);
          saveState();
          updateCount();
        });
        out.push(select);
        const notes = h("textarea", "board-textarea");
        notes.rows = 2;
        notes.placeholder = "Client notes";
        notes.setAttribute("aria-label", "Client notes");
        notes.value = state.clientNotes[client.id] || "";
        notes.addEventListener("input", () => {
          state.clientNotes[client.id] = notes.value;
          saveState();
        });
        out.push(notes);
        const f = fieldsFor(client, ["co"]);
        if (f) out.push(textDetailsNode("Contact and history", f));
        return out;
      },
    });
    list.appendChild(li);
  }
  if (!clients.length) list.appendChild(h("li", "board-empty", "No clients."));
  updateCount();
}

function textDetailsNode(summary, node) {
  const det = document.createElement("details");
  det.className = "wk-det";
  det.appendChild(h("summary", null, summary));
  det.appendChild(node);
  return det;
}

/* ---------- 5. Cash Log ---------- */

function buildCash(grid) {
  const cash = block(grid, "work-cash", "Cash Log", 2, {});
  const cashList = clampedList(cash.body, FACE, "No entries yet.");
  const renderCash = () => {
    const newest = [...state.cashLog].reverse();
    cashList.set(newest, (entry) => row({ text: entry.text || "", meta: entry.date || "" }));
    cash.setCount(state.cashLog.length + " entries");
  };
  renderCash();
  const cashRow = h("div", "add-row");
  const cashInput = h("input", "board-input");
  cashInput.placeholder = "Log entry text";
  cashInput.setAttribute("aria-label", "Log entry text");
  const cashBtn = h("button", "board-btn", "Add");
  cashBtn.type = "button";
  const addCash = () => {
    const text = cashInput.value.trim();
    if (!text) return;
    state.cashLog.push({ date: new Date().toISOString().slice(0, 10), text });
    cashInput.value = "";
    saveState();
    renderCash();
  };
  cashBtn.addEventListener("click", addCash);
  cashInput.addEventListener("keydown", (e) => { if (e.key === "Enter") addCash(); });
  cashRow.appendChild(cashInput);
  cashRow.appendChild(cashBtn);
  cash.body.appendChild(cashRow);
  laneRow(plainList(cash.body), {
    text: "About the old figures",
    build: (host) => {
      host.appendChild(note("The old app cash board lives only in its live Redis state record, which the board cannot read, so no figures were imported. This log is the board's own, stored in the board work doc."));
    },
  });
}

/* ---------- 6. Quick Cash ---------- */

function buildQuickCash(grid) {
  const levels = QUICKCASH.ladder || [];
  const allMoves = levels.flatMap((l) => l.moves || []);
  const shell = block(grid, "work-quickcash", "Quick Cash", 2, {});
  const update = () => shell.setCount(allMoves.filter((m) => isDone(m)).length + "/" + allMoves.length + " moves");
  const list = plainList(shell.body);
  for (const level of levels) {
    const moves = level.moves || [];
    laneRow(list, {
      text: level.title || "Level",
      pill: doneOf(moves),
      build: (host, setPill) => {
        if (level.aim) host.appendChild(note("Aim: " + level.aim));
        const cl = clampedList(host, CLAMP);
        cl.set(moves, (m) => row({
          text: m.t || "",
          check: m,
          meta: shortPay(m.pay),
          onToggle: () => { setPill(doneOf(moves)); update(); },
          detail: () => {
            const out = [];
            const meta = [m.pay, m.speed].filter(Boolean).map(clean).join(", ");
            if (meta) out.push(h("span", "wk-meta", meta));
            const f = fieldsFor(m, ["pay", "speed"], ["how", "where"]);
            if (f) out.push(f);
            return out;
          },
        }));
      },
    });
  }
  const channels = QUICKCASH.quick || [];
  laneRow(list, {
    text: "Quick cash channels",
    pill: String(channels.length),
    build: (host) => {
      clampedList(host, CLAMP).set(channels, leadRow);
    },
  });
  const asap = INCOME.asap || {};
  laneRow(list, {
    text: "Income ASAP plan",
    pill: (asap.leads || []).length + " leads",
    key: "income",
    build: (host) => fillIncome(host),
  });
  update();
}

function fillIncome(host) {
  const asap = INCOME.asap || {};
  host.appendChild(note("Checked " + (asap.checked || "2026-10-10") + ", the oldest dated research in the app. Urgent small money plan, remote first."));
  if (asap.summary) host.appendChild(textDetails("Summary", asap.summary));
  host.appendChild(sectionHead("Account set up, in sequence"));
  const setup = (asap.accountSetup || []).map((s) => ({ id: s.id, t: s.title, body: s.body || "" }));
  flatChecklist(host, setup, {});
  host.appendChild(sectionHead("Profile copy"));
  const profileText = typeof asap.profileCopy === "string" ? asap.profileCopy : JSON.stringify(asap.profileCopy || "");
  const profileRow = h("div", "board-row board-row-wrap");
  if (asap.profileTitle) profileRow.appendChild(h("span", "row-text", clean(asap.profileTitle)));
  profileRow.appendChild(copyButton(profileText, "Copy profile copy"));
  host.appendChild(profileRow);
  host.appendChild(textDetails("Read the profile copy", profileText));
  host.appendChild(sectionHead("Leads"));
  clampedList(host, CLAMP).set(asap.leads || [], leadRow);
  for (const section of ["review", "sprint"]) {
    if (asap[section]) {
      host.appendChild(textDetails(section === "review" ? "Portfolio review" : "Sprint",
        typeof asap[section] === "string" ? asap[section] : JSON.stringify(asap[section], null, 1), true));
    }
  }
  host.appendChild(note("Exclusion note from the app README: old contests, funding, loans and known stale marketplace examples stay on the original board and are excluded from this urgent list."));
}

/* ---------- 7. Pipeline ---------- */

function buildPipeline(grid) {
  const companies = PIPELINE.companies || [];
  const shell = block(grid, "work-pipeline", "Pipeline", 2, {});
  const openCount = () => companies.filter((c) => !isDone(c)).length;
  const update = () => shell.setCount(openCount() + " open");
  const list = plainList(shell.body);
  laneRow(list, {
    text: "Applications",
    pill: openCount() + " open",
    build: (host, setPill) => fillApplications(host, setPill, update),
  });
  const names = PIPELINE.watchlist || [];
  laneRow(list, {
    text: "Watchlist",
    pill: names.length + " names",
    build: (host) => {
      host.appendChild(note("Company names only. No per company detail exists in the source."));
      tagCloud(host, names, 18);
    },
  });
  const ob = GPT_AUDIT.outbound || {};
  const records = (ob.emailRecords || []).length + (ob.formRecords || []).length;
  laneRow(list, {
    text: "Send totals and register",
    pill: records + " sent",
    build: (host, setPill) => fillTotals(host, setPill),
  });
  update();
}

function fillApplications(host, setPill, onTick) {
  const companies = PIPELINE.companies || [];
  host.appendChild(note("Public and private pipeline merged and deduped by id. Checked dates are October snapshots."));
  host.appendChild(kvStrip([
    [companies.length, "Records"],
    [PIPELINE.publicCount, "Public"],
    [PIPELINE.privateCount, "Private"],
  ]));
  let query = "";
  let pillar = "All";
  /* Open applications first; All and Done are one chip away. */
  let view = "Active";
  const pillars = ["All", ...new Set(companies.map((c) => c.pillar).filter(Boolean))];
  const filterRow = h("div", "wk-filters");
  filterRow.appendChild(searchInput("Search company, role or reason", (q) => { query = q; render(); }));
  const pillarSelect = h("select", "board-select");
  pillarSelect.setAttribute("aria-label", "Pillar");
  for (const p of pillars) {
    const opt = h("option", null, p);
    opt.value = p;
    pillarSelect.appendChild(opt);
  }
  pillarSelect.addEventListener("change", () => { pillar = pillarSelect.value; render(); });
  filterRow.appendChild(pillarSelect);
  host.appendChild(filterRow);
  const chipHost = h("div");
  const renderChips = () => {
    chipHost.replaceChildren(chipRow(["All", "Active", "Done"], view, (picked) => {
      view = picked;
      renderChips();
      render();
    }));
  };
  renderChips();
  host.appendChild(chipHost);
  const list = clampedList(host, CLAMP, "No records match.");
  const countPill = () => setPill(companies.filter((c) => !isDone(c)).length + " open");
  function render() {
    const filtered = companies.filter((c) => {
      if (pillar !== "All" && c.pillar !== pillar) return false;
      if (view === "Done" && !isDone(c)) return false;
      if (view === "Active" && isDone(c)) return false;
      if (query && !(String(c.co || "") + " " + String(c.role || "") + " " + String(c.why || "")).toLowerCase().includes(query)) return false;
      return true;
    });
    list.set(filtered, (c) => row({
      text: c.co || "",
      strong: true,
      check: c,
      meta: shortPay(c.pay),
      onToggle: () => { countPill(); if (onTick) onTick(); },
      detail: () => {
        const out = [];
        const meta = [c.role, c.pay, c.pillar, c.kind, c.listing].filter(Boolean).map(clean).join(", ");
        if (meta) out.push(h("span", "wk-meta", meta));
        if (c.why) out.push(longText(c.why));
        const f = fieldsFor(c, ["role", "pay", "pillar", "kind", "listing", "why"]);
        if (f) out.push(f);
        else if (c.url) out.push(link(c.url, "Listing"));
        return out;
      },
    }));
  }
  render();
}

function fillTotals(host, setPill) {
  const ob = GPT_AUDIT.outbound || {};
  const g = ob.gpt || {};
  host.appendChild(note("Totals log last row is 2026-11-06, so these counts are not a current ledger."));
  host.appendChild(kvStrip([
    [(ob.emailRecords || []).length, "Email recs"],
    [(ob.formRecords || []).length, "Form recs"],
    [g.cold || 0, "Cold sends"],
    [g.focused || 0, "Focused"],
    [g.applicationEmails || 0, "Email apps"],
    [g.bounced || 0, "Bounced"],
  ]));
  if (ob.notes) host.appendChild(textDetails("Audit notes", ob.notes));
  host.appendChild(sectionHead("Day by day log", h("span", "wk-sec-count", (FRONT.totalsLog || []).length + " days")));
  clampedList(host, 3).set(FRONT.totalsLog || [], (r) => row({
    text: r.d,
    meta: "sent " + (r.sent || 0) + ", apps " + (r.apps || 0),
    detail: () => fieldsFor(r, ["d", "sent", "apps"]),
  }));
  host.appendChild(sectionHead("Send and submission register"));
  const records = [...(ob.emailRecords || []), ...(ob.formRecords || [])];
  let query = "";
  host.appendChild(searchInput("Search the register", (q) => { query = q; renderRegister(); }));
  const reg = clampedList(host, CLAMP, "No records match.");
  function renderRegister() {
    const filtered = records.filter((r) => !query || JSON.stringify(r).toLowerCase().includes(query));
    reg.set(filtered, (r) => row({
      text: r.company || "",
      strong: true,
      meta: r.date || "",
      detail: () => {
        const out = [];
        if (r.status) out.push(h("span", "wk-meta", clean(r.status)));
        const f = fieldsFor(r, ["company", "status", "date"]);
        if (f) out.push(f);
        return out;
      },
    }));
    setPill(filtered.length + (query ? " match" : " sent"));
  }
  renderRegister();
}

/* ---------- 8. Funding ---------- */

function backerCategory(b) {
  const type = String(b.type || "").toLowerCase();
  const name = String(b.name || "").toLowerCase();
  if (type.includes("do not pay") || type.includes("flagged")) return "Do not pay";
  if (type.includes("contested")) return "Contested";
  if (b.ruling && b.ruling.startsWith("Submitted")) return "Submitted";
  if (b.ruling && (b.ruling.startsWith("Closed") || b.ruling.startsWith("Dropped"))) return "Closed";
  if (type.includes("credits, not cash")) return "Credits not cash";
  if (type.includes("loan") || type.includes("cdfi") || type.includes("debt")) return "Loans and debt";
  if (type.includes("publisher")) return "Publishers";
  if (type.includes("accelerator")) return "Accelerators";
  if (type.includes("angel") || name.includes("angel")) return "Angels";
  if (type.includes("grant")) return "Grants";
  if (type.includes("fund")) return "Funds";
  return "Other";
}

function rulingKind(text) {
  const t = String(text || "");
  if (t.startsWith("Submitted")) return "good";
  if (t.startsWith("Closed") || t.startsWith("Dropped")) return "bad";
  return "hot";
}

/* "Submitted Nov 16, 2026" -> "Submitted"; the date is in the detail. */
function rulingWord(text) {
  const t = clean(text).trim();
  const m = t.match(/^(Submitted|Closed|Dropped|Pending|Applied|Open|Watch\w*)/i);
  return m ? m[1] : shortText(t, 16);
}

function buildFunding(grid) {
  const backers = BACKERS.backers || [];
  const rulings = BACKERS.rulings || [];
  const shell = block(grid, "work-funding", "Funding", 2, {});
  const submitted = backers.filter((b) => backerCategory(b) === "Submitted").length;
  shell.setCount(submitted + " submitted", submitted ? "good" : "");
  const list = plainList(shell.body);
  for (const ruling of rulings) {
    list.appendChild(row({
      text: ruling.name,
      strong: true,
      pill: rulingWord(ruling.status),
      pillKind: rulingKind(ruling.status),
      detail: () => {
        const out = [h("span", "wk-meta", clean(ruling.status))];
        if (ruling.note) out.push(longText(ruling.note));
        return out;
      },
    }));
  }
  const lanes = plainList(shell.body);
  laneRow(lanes, {
    text: "All backers",
    pill: String(backers.length),
    build: (host, setPill) => fillBackers(host, setPill),
  });
  const fw = GPT_OPPS.fundedWaveOct23 || {};
  laneRow(lanes, {
    text: "Funded wave Oct 23",
    pill: "Unverified",
    pillKind: "warn",
    build: (host) => {
      host.appendChild(note("Recorded " + (fw.recordedAt || "") + " by " + (fw.recordedBy || "") + ". " + (fw.companies || []).length + " companies."));
      if (fw.summary) host.appendChild(textDetails("Summary", fw.summary));
      if (fw.sendRule) host.appendChild(note("Send rule: " + fw.sendRule));
      clampedList(host, CLAMP).set(fw.companies || [], leadRow);
      const rest = fieldsFor(fw, ["recordedAt", "recordedBy", "summary", "sendRule", "companies"]);
      if (rest) host.appendChild(textDetailsNode("Claims, new targets and standing search", rest));
    },
  });
  if (BACKERS.stalenessNote) {
    laneRow(lanes, {
      text: "Where the rulings stand",
      build: (host) => { host.appendChild(longText(BACKERS.stalenessNote)); },
    });
  }
}

function fillBackers(host, setPill) {
  const backers = BACKERS.backers || [];
  const filters = ["All", "Grants", "Funds", "Accelerators", "Publishers", "Loans and debt", "Credits not cash", "Angels", "Submitted", "Closed", "Do not pay", "Contested"];
  let active = "All";
  let query = "";
  host.appendChild(searchInput("Search backers", (q) => { query = q; render(); }));
  const chipHost = h("div");
  const renderChips = () => {
    chipHost.replaceChildren(chipRow(filters, active, (picked) => { active = picked; renderChips(); render(); }));
  };
  renderChips();
  host.appendChild(chipHost);
  const list = clampedList(host, CLAMP, "No backers match this filter.");
  function render() {
    const filtered = backers.filter((b) => {
      if (active !== "All" && backerCategory(b) !== active) return false;
      if (query && !(String(b.name || "") + " " + String(b.type || "")).toLowerCase().includes(query)) return false;
      return true;
    });
    list.set(filtered, (b) => {
      const cat = backerCategory(b);
      let tag = "";
      let kind = "";
      if (b.ruling) { tag = rulingWord(b.ruling); kind = rulingKind(b.ruling); }
      else if (cat === "Do not pay") { tag = "Do not pay"; kind = "bad"; }
      else if (cat === "Contested") { tag = "Contested"; kind = "warn"; }
      return row({
        text: b.name || "",
        strong: true,
        onCheck: (on) => { state.backerDone[b.id] = on; saveState(); },
        checked: !!state.backerDone[b.id],
        checkTitle: "Pursued or done",
        pill: tag,
        pillKind: kind,
        detail: () => {
          const out = [];
          const meta = [b.type, b.amount].filter(Boolean).map(clean).join(", ");
          if (meta) out.push(h("span", "wk-meta", meta));
          if (b.ruling) out.push(h("span", "wk-meta", "Ruling: " + clean(b.ruling)));
          if (cat === "Do not pay") out.push(pill("Do not pay", "bad"));
          if (cat === "Contested") out.push(pill("Contested, recheck before use", "warn"));
          const f = fieldsFor(b, ["type", "amount", "ruling"]);
          if (f) out.push(f);
          return out;
        },
      });
    });
    setPill(filtered.length + (filtered.length === backers.length ? "" : " of " + backers.length));
  }
  render();
}

/* ---------- 9. Outreach Lanes ---------- */

function isBuildGroup(group) {
  return String(group.g || "").startsWith("BUILD");
}

function buildOutreach(grid) {
  const shell = block(grid, "work-outreach", "Outreach Lanes", 3, {});
  const list = plainList(shell.body);
  let openTotal = 0;

  const focusedGroups = [];
  for (const g of GPT.focused || []) {
    if (String(g.g || "").startsWith("Form packets")) continue;
    focusedGroups.push({ g: g.g, items: g.items || [], ownerLabel: "GPT" });
  }
  for (const g of BASH.focused || []) {
    if (isBuildGroup(g)) continue;
    focusedGroups.push({ g: g.g, items: g.items || [], ownerLabel: "Bash" });
  }
  const focusedItems = focusedGroups.flatMap((g) => g.items);
  openTotal += focusedItems.filter((it) => !isDone(it)).length;
  laneRow(list, {
    text: "Focused outreach",
    pill: doneOf(focusedItems),
    key: "focused",
    build: (host, setPill) => {
      host.appendChild(note("GPT and Bash focused groups, owner labelled. Form packets live in Dex Actions and the BUILD group has its own lane, so nothing is editable in two places."));
      checklistGroups(host, focusedGroups, { onToggle: () => setPill(doneOf(focusedItems)) });
    },
  });

  const buildGroup = (BASH.focused || []).find(isBuildGroup);
  if (buildGroup) {
    const items = buildGroup.items || [];
    openTotal += items.filter((it) => !isDone(it)).length;
    laneRow(list, {
      text: "BUILD: fast cash build stack",
      pill: doneOf(items),
      key: "build",
      build: (host, setPill) => {
        host.appendChild(note(buildGroup.g));
        flatChecklist(host, items, { onToggle: () => setPill(doneOf(items)) });
      },
    });
  }

  const pause = GPT.executionPause || {};
  const coldGroups = (BASH.cold || []).map((g) => ({ g: g.g, items: g.items || [], ownerLabel: "Bash" }));
  const coldItems = coldGroups.flatMap((g) => g.items);
  laneRow(list, {
    text: "Cold outreach",
    pill: "Paused",
    pillKind: "bad",
    meta: doneOf(coldItems),
    key: "cold",
    build: (host) => {
      host.appendChild(note("Cold outreach is paused: " + (pause.scope || "recorded as paused in the source data.")));
      const rest = fieldsFor(pause, ["scope"]);
      if (rest) host.appendChild(textDetailsNode("Pause record", rest));
      checklistGroups(host, coldGroups, {});
    },
  });

  const wd = WEBDESIGN.webdesign || [];
  const wdLive = wd.filter((e) => !String(e.type || "").includes("KILLED")).length;
  laneRow(list, {
    text: "Web design lane",
    pill: wdLive + " live",
    build: (host, setPill) => fillWebDesign(host, setPill),
  });

  const s = GPT_OPPS.startups || {};
  laneRow(list, {
    text: "Startups cohort",
    pill: s.active === false ? "Not active" : (s.contactReady || []).length + " ready",
    pillKind: s.active === false ? "bad" : "",
    build: (host, setPill) => fillStartups(host, setPill),
  });

  const fc = GPT_OPPS.fastCoin || {};
  laneRow(list, {
    text: "Fast Coin",
    pill: fc.status === "paused" ? "Paused" : (fc.leads || []).length + " leads",
    pillKind: fc.status === "paused" ? "warn" : "",
    build: (host) => fillFastCoin(host),
  });

  laneRow(list, {
    text: "GPT lane: leads, gate and audits",
    pill: (GPT_LEADS.migrated || []).length + " leads",
    key: "gpt",
    build: (host, setPill) => fillGpt(host, setPill),
  });

  laneRow(list, {
    text: "Bash lane index",
    build: (host) => fillBashIndex(host),
  });

  const lanes = FRONT.laneStatus || [];
  laneRow(list, {
    text: "Lanes running",
    pill: lanes.filter((l) => l.cadence !== "paused").length + " active",
    pillKind: "good",
    build: (host) => {
      const ul = plainList(host);
      for (const lane of lanes) {
        ul.appendChild(row({
          text: lane.name,
          pill: shortText(lane.cadence, 16),
          pillKind: lane.cadence === "paused" ? "bad" : "good",
          detail: lane.note ? () => longText(lane.note) : null,
        }));
      }
      host.appendChild(note("Ticks and edits on this tab save to the board work doc. The old app's live Redis state record cannot be read from the board, so ticks made in the old app after October are not shown here."));
    },
  });

  shell.setCount(openTotal + " open", openTotal ? "hot" : "");
}

function fillBashIndex(host) {
  host.appendChild(note("Email outreach, marketplaces, agencies, inventory and recruiting. The Bash groups render once, in Dex Actions and the Focused, Cold and BUILD lanes, so ticks never fork. This is the lane index."));
  const totals = BASH.totals || {};
  const rows = [
    ["Dex moves", (BASH.dex || []).length, "dex"],
    ["Cold groups", (BASH.cold || []).reduce((n, g) => n + (g.items || []).length, 0), "cold"],
    ["Focused groups", (BASH.focused || []).filter((g) => !isBuildGroup(g)).reduce((n, g) => n + (g.items || []).length, 0), "focused"],
    ["BUILD group", (BASH.focused || []).filter(isBuildGroup).reduce((n, g) => n + (g.items || []).length, 0), "build"],
  ];
  if (totals.coldSent !== undefined) {
    host.appendChild(kvStrip([[totals.coldSent, "Cold sent"], [rows.reduce((n, r) => n + r[1], 0), "Items"]]));
  }
  for (const [label, count, target] of rows) {
    const r = h("div", "stat-row");
    r.appendChild(h("span", "stat-label", label));
    const right = h("span", "wk-stat-right");
    right.appendChild(h("span", "stat-value", count + " items"));
    const jump = h("button", "board-btn is-small", "Open");
    jump.type = "button";
    jump.title = "Open that lane";
    jump.addEventListener("click", () => {
      const el = target === "dex" ? document.getElementById("work-dex-actions") : drawers.get(target);
      if (!el) return;
      if (el.open) el.open();
      el.scrollIntoView({ behavior: "smooth", block: "nearest" });
      el.classList.add("is-flash");
      setTimeout(() => el.classList.remove("is-flash"), 1200);
    });
    right.appendChild(jump);
    r.appendChild(right);
    host.appendChild(r);
  }
}

function fillWebDesign(host, setPill) {
  const entries = WEBDESIGN.webdesign || [];
  host.appendChild(note("Grouped by wave. Killed rows are hidden until the toggle is on."));
  let showKilled = false;
  const toggleRow = h("label", "board-row wk-toggle");
  const toggle = document.createElement("input");
  toggle.type = "checkbox";
  toggle.addEventListener("change", () => { showKilled = toggle.checked; render(); });
  toggleRow.appendChild(toggle);
  toggleRow.appendChild(h("span", null, "Show killed"));
  host.appendChild(toggleRow);
  const waveHost = h("div", "wk-waves");
  host.appendChild(waveHost);
  const render = () => {
    waveHost.replaceChildren();
    const waves = { W1: [], W2: [], W3: [], Other: [] };
    for (const entry of entries) {
      const killed = String(entry.type || "").includes("KILLED");
      if (killed && !showKilled) continue;
      const match = String(entry.type || "").match(/^W(\d)/);
      waves[match ? "W" + match[1] : "Other"].push(entry);
    }
    let total = 0;
    for (const wave of Object.keys(waves)) {
      if (!waves[wave].length) continue;
      total += waves[wave].length;
      const sec = h("div", "wk-wave");
      sec.appendChild(sectionHead(wave + " wave", h("span", "wk-sec-count", String(waves[wave].length))));
      clampedList(sec, 3).set(waves[wave], (entry) => {
        const status = clean(entry.type || "").split(" — ").pop() || "";
        return row({
          text: entry.name || "",
          strong: true,
          pill: shortText(status, 14),
          pillKind: /KILLED/.test(status) ? "bad" : "",
          detail: () => {
            const out = [h("span", "wk-meta", clean(entry.type || ""))];
            if (entry.amount) out.push(h("span", "wk-meta", clean(entry.amount)));
            const f = fieldsFor(entry, ["type", "amount"]);
            if (f) out.push(f);
            return out;
          },
        });
      });
      waveHost.appendChild(sec);
    }
    setPill(total + " shown");
  };
  render();
}

function fillStartups(host, setPill) {
  const s = GPT_OPPS.startups || {};
  host.appendChild(note("GPT startup outreach cohort, started " + (s.started || "2026-10-13") + ". Contact addresses render only inside opened rows."));
  const flags = h("div", "chip-row");
  if (s.active === false) flags.appendChild(pill("Not active", "bad"));
  if (s.noSending) flags.appendChild(pill("No sending", "bad"));
  if (s.noDrafts) flags.appendChild(pill("No drafts", "bad"));
  if (s.requiresExactTextApproval) flags.appendChild(pill("Exact text approval", "warn"));
  if (s.status) flags.appendChild(pill("Status: " + s.status));
  if (flags.children.length) host.appendChild(flags);
  if (s.outreachNotice) host.appendChild(textDetails("Outreach notice", s.outreachNotice));
  const buckets = [
    ["Contact ready", s.contactReady || []],
    ["Backlog", s.backlog || []],
    ["Rejected", s.rejected || []],
    ["Pass log", s.passLog || []],
    ["Dead", s.dead || []],
  ];
  host.appendChild(kvStrip(buckets.map(([label, rows]) => [rows.length, label])));
  let active = "Contact ready";
  const chipHost = h("div");
  host.appendChild(chipHost);
  const list = clampedList(host, CLAMP, "Nothing in this bucket.");
  const renderBucket = () => {
    const bucket = buckets.find(([label]) => label === active);
    const rows = bucket ? bucket[1] : [];
    list.set(rows, (r) => row({
      text: r.name || r.id || "",
      strong: true,
      meta: r.tier ? shortText(r.tier, 12) : "",
      detail: () => {
        const out = [];
        const meta = [r.tier, r.status, r.stage, r.location].filter(Boolean).map(clean).join(", ");
        if (meta) out.push(h("span", "wk-meta", meta));
        const f = fieldsFor(r, ["tier", "status", "stage", "location"]);
        if (f) out.push(f);
        return out;
      },
    }));
    setPill(rows.length + " " + active.toLowerCase());
  };
  const renderChips = () => {
    chipHost.replaceChildren(chipRow(buckets.map(([label]) => label), active, (picked) => {
      active = picked;
      renderChips();
      renderBucket();
    }));
  };
  renderChips();
  renderBucket();
  const rest = fieldsFor(s, ["active", "status", "outreachNotice", "contactReady", "backlog", "rejected", "passLog", "dead", "started", "applicationOnly", "partial"]);
  if (rest) host.appendChild(textDetailsNode("Cohort record", rest));
  for (const key of ["applicationOnly", "partial"]) {
    if (Array.isArray(s[key]) && s[key].length) {
      host.appendChild(sectionHead(key === "applicationOnly" ? "Application only" : "Partial", h("span", "wk-sec-count", String(s[key].length))));
      clampedList(host, 3).set(s[key], leadRow);
    }
  }
}

function fillFastCoin(host) {
  const fc = GPT_OPPS.fastCoin || {};
  host.appendChild(note("Started " + (fc.started || "") + ". Checkpoint " + (fc.checkpoint || "") + " has passed. Status: " + (fc.status || "") + ". Target: " + (fc.target || "") + "."));
  host.appendChild(kvStrip([
    [(fc.leads || []).length, "Leads"],
    [(fc.doFirst || []).length, "Do first"],
    [(fc.dead || []).length, "Dead"],
    [(fc.passes || []).length, "Passes"],
  ]));
  if (fc.pauseNote) host.appendChild(textDetails("Pause note", fc.pauseNote));
  host.appendChild(sectionHead("Do first"));
  const doFirst = (fc.doFirst || []).map((d) => ({ id: d.id || d.name, t: d.name || d.t, body: d.nextAction || "" }));
  flatChecklist(host, doFirst, {});
  host.appendChild(sectionHead("Leads"));
  clampedList(host, CLAMP).set(fc.leads || [], leadRow);
  const deadDet = document.createElement("details");
  deadDet.className = "wk-det";
  deadDet.appendChild(h("summary", null, "Dead, " + (fc.dead || []).length));
  clampedList(deadDet, CLAMP).set(fc.dead || [], leadRow);
  host.appendChild(deadDet);
  host.appendChild(textDetails("Pass log, " + (fc.passes || []).length, JSON.stringify(fc.passes || [], null, 1), true));
  if (fc.terms) host.appendChild(textDetails("Terms", typeof fc.terms === "string" ? fc.terms : JSON.stringify(fc.terms, null, 1), typeof fc.terms !== "string"));
  if (fc.wrapUpNote) host.appendChild(textDetails("Wrap up note", fc.wrapUpNote));
}

function fillGpt(host, setPill) {
  host.appendChild(note("Checked " + (GPT.checked || "2026-10-12") + ". Nothing in this lane postdates October 23, 2026. Dex moves live in Dex Actions and focused groups in Focused outreach; this carries the leads, the gate and rules, the history and the audits."));
  host.appendChild(kvStrip([
    [(GPT_LEADS.migrated || []).length, "Leads"],
    [Object.keys(GPT.history || {}).length, "History"],
    [Object.keys(GPT.review || {}).length, "Reviews"],
    [(GPT.blocked || []).length, "Blocked"],
  ]));
  const tabs = ["Migrated leads", "Gate and rules", "History and review", "Audits", "Blocked and owned"];
  const pane = h("div", "wk-pane");
  let active = tabs[0];
  const renderPane = () => {
    pane.replaceChildren();
    if (active === "Migrated leads") {
      const leads = GPT_LEADS.migrated || [];
      let query = "";
      pane.appendChild(searchInput("Search migrated leads", (q) => { query = q; renderLeads(); }));
      const list = clampedList(pane, CLAMP, "No leads match.");
      function renderLeads() {
        const filtered = leads.filter((l) => !query || JSON.stringify(l).toLowerCase().includes(query));
        list.set(filtered, leadRow);
        setPill(filtered.length + " of " + leads.length + " leads");
      }
      renderLeads();
    } else if (active === "Gate and rules") {
      pane.appendChild(sectionHead("Pay and quality gate"));
      listOfStrings(pane, GPT.gate || []);
      pane.appendChild(sectionHead("Drafting rules"));
      listOfStrings(pane, GPT.rules || []);
      if (GPT.text) pane.appendChild(textDetailsNode("Legacy lane text", fieldsFor(GPT.text, []) || h("div")));
    } else if (active === "History and review") {
      const hist = GPT.history || {};
      const rev = GPT.review || {};
      pane.appendChild(note("History is the per lead default state store, " + Object.keys(hist).length + " records. Review overrides, " + Object.keys(rev).length + " records. Search by lead id."));
      let query = "";
      pane.appendChild(searchInput("Search history by lead id", (q) => { query = q; renderHist(); }));
      const list = clampedList(pane, CLAMP, "No records match.");
      function renderHist() {
        const entries = Object.entries(hist).filter(([id]) => !query || id.includes(query));
        list.set(entries, ([id, val]) => row({
          text: id,
          meta: (val.status ? shortText(val.status, 14) : "") + (val.d ? (val.status ? ", done" : "done") : ""),
          detail: () => {
            const out = [fieldsFor(val, []) || h("span", "wk-meta", "No fields.")];
            if (rev[id]) {
              out.push(sectionHead("Review override"));
              out.push(fieldsFor(rev[id], []));
            }
            return out;
          },
        }));
      }
      renderHist();
    } else if (active === "Audits") {
      pane.appendChild(note("Dated reconciliation audits, carried as summaries. The long disposition lists stay in the source repo. The full send register is under Pipeline, Send totals and register."));
      const audits = Object.entries(GPT_AUDIT.audits || {});
      const host2 = h("div", "wk-detlist");
      for (const [key, val] of audits) host2.appendChild(textDetails(key, JSON.stringify(val, null, 1), true));
      pane.appendChild(host2);
      clampChildren(host2, CLAMP);
    } else {
      pane.appendChild(sectionHead("Blocked leads"));
      clampedList(pane, CLAMP).set(GPT.blocked || [], (b) => (typeof b === "string" ? row({ text: b }) : leadRow(b)));
      pane.appendChild(sectionHead("Archives"));
      clampedList(pane, CLAMP).set(GPT.archives || [], leadRow);
      pane.appendChild(sectionHead("Owned by Bash, GPT must not touch", h("span", "wk-sec-count", (GPT.ownedByBash || []).length + " companies")));
      tagCloud(pane, GPT.ownedByBash || [], 14);
    }
  };
  const tabHost = h("div");
  const renderTabs = () => {
    tabHost.replaceChildren(chipRow(tabs, active, (picked) => { active = picked; renderTabs(); renderPane(); }));
  };
  renderTabs();
  host.appendChild(tabHost);
  host.appendChild(pane);
  renderPane();
}

/* ---------- 10. Research and Long Shots ---------- */

function fillPlatform(host, coll, setPill, extra) {
  host.appendChild(note((coll.label || coll.title || "") + (coll.date ? ", " + coll.date : "") + ". Research collection, not a queue."));
  const companies = coll.companies || coll.records || [];
  if (Array.isArray(coll.topTen) && coll.topTen.length) {
    host.appendChild(sectionHead("Top ten first"));
    const top = clampedList(host, 5, null, "ol");
    top.list.classList.add("wk-ol");
    top.set(coll.topTen, (entry) => row({
      text: typeof entry === "string" ? entry : (entry.name || entry.title || JSON.stringify(entry)),
      detail: typeof entry === "object" ? () => fieldsFor(entry, []) : null,
    }));
  }
  host.appendChild(sectionHead("Companies", h("span", "wk-sec-count", String(companies.length))));
  clampedList(host, CLAMP).set(companies, leadRow);
  const rest = fieldsFor(coll, ["label", "title", "date", "companies", "records", "topTen", "protected", "neverContact"]);
  if (rest) host.appendChild(textDetailsNode("Method, counts and appendix", rest));
  if (extra) extra(host, coll);
}

function buildResearch(grid) {
  const shell = block(grid, "work-research", "Research and Long Shots", 3, {});
  const list = plainList(shell.body);
  const colls = [
    ["Platform opportunities", GPT_OPPS.platformOpportunities || {}, null],
    ["Platform ecosystems", GPT_OPPS.platformEcosystems || {}, null],
    ["Platform volume hunt", GPT_OPPS.platformVolumeHunt || {}, (body, coll) => {
      for (const key of ["protected", "neverContact"]) {
        if (Array.isArray(coll[key]) && coll[key].length) {
          const det = document.createElement("details");
          det.className = "wk-det wk-danger";
          det.appendChild(h("summary", null, (key === "protected" ? "Protected list" : "Never contact list") + ", " + coll[key].length));
          const ul = h("ul", "wk-ul");
          for (const entry of coll[key]) ul.appendChild(h("li", null, typeof entry === "string" ? entry : JSON.stringify(entry)));
          det.appendChild(ul);
          body.appendChild(det);
        }
      }
      const wave2 = GPT_OPPS.platformVolumeHuntWave2 || {};
      if (wave2.title) {
        body.appendChild(sectionHead(wave2.title));
        const records = Array.isArray(wave2.records) ? wave2.records.flatMap((r) => Array.isArray(r.items) ? r.items : [r]) : [];
        clampedList(body, CLAMP).set(records, leadRow);
        const rest = fieldsFor(wave2, ["title", "records"]);
        if (rest) body.appendChild(textDetailsNode("Wave 2 notes, dead and top lists", rest));
      }
    }],
  ];
  let total = 0;
  for (const [title, coll, extra] of colls) {
    const n = (coll.companies || coll.records || []).length;
    total += n;
    laneRow(list, {
      text: title,
      pill: n + " cos",
      build: (host, setPill) => fillPlatform(host, coll, setPill, extra),
    });
  }
  const moonItems = (MOON.moon || []).flatMap((g) => g.items || []);
  laneRow(list, {
    text: "Moonshots",
    pill: doneOf(moonItems),
    build: (host, setPill) => {
      host.appendChild(note("Deliberately large asks and giant listings."));
      checklistGroups(host, MOON.moon || [], { onToggle: () => setPill(doneOf(moonItems)) });
    },
  });
  const cheatItems = (MOON.cheats || []).flatMap((g) => g.items || []);
  laneRow(list, {
    text: "Cheat codes",
    pill: doneOf(cheatItems),
    build: (host, setPill) => {
      host.appendChild(note("Systems, not jobs, grouped by tier."));
      checklistGroups(host, MOON.cheats || [], { onToggle: () => setPill(doneOf(cheatItems)) });
    },
  });
  shell.setCount(total + " companies");
}

/* ---------- 11. Reference ---------- */

function buildReference(grid) {
  const shell = block(grid, "work-reference", "Reference", 4, {});
  const list = plainList(shell.body);
  let faceLine = null;
  faceLine = laneRow(list, {
    text: "One liner",
    build: (host) => {
      const area = h("textarea", "board-textarea");
      area.rows = 3;
      area.setAttribute("aria-label", "One liner");
      area.value = state.oneLiner || FRONT.oneLiner || "";
      area.addEventListener("input", () => {
        state.oneLiner = area.value;
        saveState();
      });
      host.appendChild(area);
      const r = h("div", "board-row board-row-wrap");
      r.appendChild(copyButton(() => area.value || "", "Copy one liner"));
      host.appendChild(r);
      host.appendChild(textDetails("Creative native framing", FRONT.creativeNativeFraming || ""));
    },
  });
  faceLine.querySelector(".wk-line").appendChild(copyButton(() => state.oneLiner || FRONT.oneLiner || "", "Copy"));
  const scripts = FRONT.scripts || [];
  laneRow(list, {
    text: "Outreach scripts",
    pill: String(scripts.length),
    build: (host) => {
      const ul = plainList(host);
      for (const script of scripts) {
        ul.appendChild(row({
          text: script.t || "Script",
          extra: [copyButton(script.body || "", "Copy")],
          detail: () => h("pre", "wk-pre", script.body || ""),
        }));
      }
    },
  });
  const guides = GUIDES.guides || [];
  laneRow(list, {
    text: "Guides",
    pill: String(guides.length),
    build: (host) => {
      host.appendChild(note("Short version first, full text behind its own expander. The resume surfaces registry lives in the work repo root as RESUME-SURFACES.md and is linked from the Resume Sync guide; it is not copied here."));
      const cl = clampedList(host, 8);
      cl.set(guides, (guide) => row({
        text: guide.t || "Guide",
        detail: () => {
          const out = [longText(typeof guide.dex === "string" ? guide.dex : str(guide.dex || ""))];
          if (guide.ai) out.push(textDetails("Full text", typeof guide.ai === "string" ? guide.ai : str(guide.ai || "")));
          return out;
        },
      }));
    },
  });
  laneRow(list, {
    text: "Strategy and application rules",
    pill: "3",
    build: (host) => {
      const blocks = [
        ["Honesty rules", FRONT.rules],
        ["High volume sending", FRONT.volume],
        ["Long term strategy", FRONT.longterm],
      ];
      for (const [label, obj] of blocks) {
        if (!obj) continue;
        if (typeof obj === "object" && obj.dex) {
          host.appendChild(sectionHead(label));
          if (obj.why) host.appendChild(note(str(obj.why)));
          host.appendChild(longText(str(obj.dex)));
          if (obj.ai) host.appendChild(textDetails("Full text", str(obj.ai)));
        } else {
          host.appendChild(textDetails(label, typeof obj === "string" ? obj : JSON.stringify(obj, null, 1), true));
        }
      }
    },
  });
  const files = ARCHIVE.files || [];
  laneRow(list, {
    text: "Archive: local draft corpora",
    pill: files.length + " files",
    build: (host) => {
      if (ARCHIVE.note) host.appendChild(note(ARCHIVE.note));
      const kb = Math.round(files.reduce((n, f) => n + (f.bytes || 0), 0) / 1024);
      host.appendChild(kvStrip([[files.length, "Files"], [kb.toLocaleString(), "KB total"]]));
      clampedList(host, CLAMP).set(files, (file) => row({
        text: file.name,
        meta: Math.round((file.bytes || 0) / 1024) + " KB",
        detail: () => h("span", "wk-meta", file.path),
      }));
    },
  });
  shell.setCount(guides.length + " guides");
}

/* ---------- mount and unmount ---------- */

export async function mount(container, ctx) {
  rootEl = container;
  storeRef = ctx && ctx.store ? ctx.store : null;
  drawers = new Map();
  state = blankState();
  if (storeRef) {
    try {
      const saved = await storeRef.load("board-work");
      if (saved && typeof saved === "object") {
        state = Object.assign(blankState(), saved);
        state.checks = state.checks || {};
        state.weekAdded = Array.isArray(state.weekAdded) ? state.weekAdded : [];
        state.weekRemoved = Array.isArray(state.weekRemoved) ? state.weekRemoved : [];
        state.clientStatus = state.clientStatus || {};
        state.clientNotes = state.clientNotes || {};
        state.backerDone = state.backerDone || {};
        state.cashLog = Array.isArray(state.cashLog) ? state.cashLog : [];
      }
    } catch (err) {
      console.warn("board work: state load failed, using defaults", err);
    }
  }
  container.replaceChildren();
  const grid = h("div", "board-grid wk-grid");
  container.appendChild(grid);
  buildDexActions(grid);
  buildToday(grid);
  buildWeek(grid);
  buildClients(grid);
  buildCash(grid);
  buildQuickCash(grid);
  buildPipeline(grid);
  buildFunding(grid);
  buildOutreach(grid);
  buildResearch(grid);
  buildReference(grid);
}

export function unmount() {
  if (rootEl) rootEl.replaceChildren();
  rootEl = null;
  storeRef = null;
  state = null;
  drawers = new Map();
}
