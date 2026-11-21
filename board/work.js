/* Dex Board Work tab. Lane 6.
   All of Mission Control restructured as cards, from the generated data
   modules under board/data/ (see the header in each module for its
   source in the Mission Control repo and the regeneration command).

   State decision (full evidence in the Lane 6 build summary): the old
   app keeps its live progress in a Redis record behind its api/state.js
   endpoint, keyed work-dashboard-state-v1, and that endpoint only
   answers a DexAuth JWT bearer token (tier admin, owner true). No token
   or credential exists in the repo files, the board shell does not pass
   a DexAuth token to tab modules through the frozen ctx interface, and
   the endpoint sends no CORS headers for a cross origin read from
   dexcimino.com. A live read is therefore not wired. Interactive state
   on this tab (ticks, week edits, client status, backer flags, the one
   liner, the board cash log) lives in the board own board-work
   Firestore doc through ctx.store, seeded from the file defaults in the
   data modules. Migrating the Redis record into that doc is the listed
   follow up.

   Layout: every section is one block in a single .board-grid, packed by
   the shell's masonry (board/pack.js). No block scrolls inside itself:
   long lists show their first rows and a "Show all (N)" more-btn that
   opens the rest in place. Lists over LAZY_OVER rows only build their
   hidden rows when opened, so the 749 row send register costs eight
   rows until asked for. Styles live in board/work.css. */

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

/* Rows a list shows before its "Show all" button. */
const CLAMP = 3;
/* Above this many rows the hidden rows are not built until opened. */
const LAZY_OVER = 120;

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
  if (item.d === 1 || item.d === true) return true;
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

function muted(text) {
  return h("p", "wk-note", text);
}

function sectionHead(text, extra) {
  const head = h("div", "wk-sec");
  head.appendChild(h("span", "wk-sec-title", text));
  if (extra) head.appendChild(extra);
  return head;
}

/* A sub-list that sits folded as one row until opened. */
function foldedSection(parent, title, countText, open) {
  const det = document.createElement("details");
  det.className = "wk-group wk-fold";
  if (open) det.open = true;
  const sum = h("summary", "wk-group-sum");
  sum.appendChild(h("span", "wk-group-name", title));
  const count = h("span", "wk-group-count", countText || "");
  sum.appendChild(count);
  det.appendChild(sum);
  const inner = h("div", "wk-group-body");
  det.appendChild(inner);
  parent.appendChild(det);
  return { det, body: inner, count };
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
      await navigator.clipboard.writeText(text || "");
      b.textContent = "Copied";
      setTimeout(() => { b.textContent = label || "Copy"; }, 1200);
    } catch (err) {
      b.textContent = "Copy failed";
      setTimeout(() => { b.textContent = label || "Copy"; }, 1200);
    }
  });
  return b;
}

function textDetails(summary, text, mono) {
  const det = document.createElement("details");
  det.className = "wk-det";
  det.appendChild(h("summary", null, summary));
  det.appendChild(h(mono ? "pre" : "div", mono ? "wk-pre" : "wk-long", text));
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

const SKIP_DETAIL = new Set(["id", "t", "title", "name", "co", "role", "pay", "why", "url", "d", "g", "items", "moves"]);

function detailValue(parent, key, val) {
  if (val === null || val === undefined || val === "") return;
  const row = h("div", "wk-kvrow");
  const label = key.startsWith("detail") ? key.slice(6).toLowerCase() : key;
  row.appendChild(h("span", "wk-key", label));
  if (Array.isArray(val)) {
    const list = h("ul", "wk-ul");
    for (const entry of val) {
      list.appendChild(h("li", null, typeof entry === "object" ? JSON.stringify(entry) : String(entry)));
    }
    row.appendChild(list);
  } else if (typeof val === "object") {
    row.appendChild(h("pre", "wk-pre", JSON.stringify(val, null, 1)));
  } else {
    row.appendChild(h("span", "wk-val", String(val)));
  }
  parent.appendChild(row);
}

/* Expandable detail block. Detail fields (contact data and long text)
   only ever render inside one of these, never in a header or summary. */
function detailsFor(obj, skipExtra) {
  const det = document.createElement("details");
  det.className = "wk-det";
  det.appendChild(h("summary", null, "Details"));
  const body = h("div", "wk-det-body");
  const skip = new Set(SKIP_DETAIL);
  if (skipExtra) for (const k of skipExtra) skip.add(k);
  let any = false;
  for (const key of Object.keys(obj || {})) {
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
  if (!any) return null;
  det.appendChild(body);
  return det;
}

/* A long card note keeps its first sentence as the sub line and folds the
   rest into an expander, so a block opens on its content, not a paragraph. */
function splitSub(sub) {
  const text = String(sub || "").trim();
  if (text.length <= 120) return [text, ""];
  const cut = text.indexOf(". ");
  if (cut < 0 || cut > 160) return [text, ""];
  return [text.slice(0, cut + 1), text.slice(cut + 2)];
}

/* opts: span ("2"), pill (initial count text), flag + flagKind (a status
   tag beside the count), collapsible, collapsed. */
function cardShell(grid, id, title, sub, opts) {
  const options = opts || {};
  const card = h("section", "board-card wk-card");
  if (id) card.id = id;
  if (options.span) card.dataset.span = options.span;
  const head = h("div", "board-card-head");
  head.appendChild(h("h3", "board-card-title", title));
  const right = h("div", "wk-head-right");
  if (options.flag) right.appendChild(pill(options.flag, options.flagKind || "warn"));
  const count = pill("", options.pillKind || "");
  count.hidden = true;
  right.appendChild(count);
  let body = null;
  if (options.collapsible) {
    const toggle = h("button", "board-btn is-small", options.collapsed ? "Show" : "Hide");
    toggle.type = "button";
    toggle.setAttribute("aria-expanded", options.collapsed ? "false" : "true");
    toggle.addEventListener("click", () => {
      const hidden = card.classList.toggle("wk-collapsed");
      toggle.textContent = hidden ? "Show" : "Hide";
      toggle.setAttribute("aria-expanded", hidden ? "false" : "true");
    });
    right.appendChild(toggle);
  }
  head.appendChild(right);
  card.appendChild(head);
  const [first, rest] = splitSub(sub);
  if (first) card.appendChild(h("p", "board-card-sub", first));
  if (rest) {
    const about = textDetails("More about this block", rest);
    about.classList.add("wk-about");
    card.appendChild(about);
  }
  body = h("div", "board-card-body");
  if (options.collapsed) card.classList.add("wk-collapsed");
  card.appendChild(body);
  grid.appendChild(card);
  const setCount = (txt) => {
    count.textContent = txt || "";
    count.hidden = !txt;
  };
  if (options.pill) setCount(options.pill);
  return { card, body, setCount };
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

/* Same clamp for children already built (groups, tag clouds). */
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

function checklistItem(item, opts) {
  const options = opts || {};
  const li = h("li", "board-list-item");
  const row = h("div", "board-row wk-top");
  const box = document.createElement("input");
  box.type = "checkbox";
  box.checked = isDone(item);
  li.classList.toggle("is-done", box.checked);
  box.addEventListener("change", () => {
    setDone(item, box.checked);
    li.classList.toggle("is-done", box.checked);
    if (typeof options.onToggle === "function") options.onToggle();
  });
  row.appendChild(box);
  const textWrap = h("div", "wk-main");
  textWrap.appendChild(h("span", "row-text", item.t || item.title || item.name || item.id || ""));
  if (item.status || item.owner) {
    textWrap.appendChild(h("span", "wk-meta", [item.owner, item.status].filter(Boolean).join(", ")));
  }
  if (item.body && !options.hideBody) {
    textWrap.appendChild(textDetails("Notes", item.body));
  } else {
    const det = detailsFor(item, ["body", "status", "owner", "priority", "checked", "leadId"]);
    if (det) textWrap.appendChild(det);
    else if (item.url) textWrap.appendChild(link(item.url, "Open link"));
  }
  row.appendChild(textWrap);
  li.appendChild(row);
  return li;
}

function flatChecklist(parent, items, opts) {
  const options = opts || {};
  const cl = clampedList(parent, options.n || CLAMP);
  cl.set(items, (item) => checklistItem(item, { onToggle: options.onToggle }));
  return items;
}

/* Groups render as one folded row each (name, owner, done count); opening
   one shows its items, clamped. More than eight groups clamp too. */
function checklistGroups(parent, groups, opts) {
  const options = opts || {};
  const allItems = [];
  const host = h("div", "wk-groups");
  parent.appendChild(host);
  for (const group of groups) {
    const items = group.items || [];
    for (const it of items) allItems.push(it);
    if (!group.g) {
      flatChecklist(host, items, { onToggle: options.onToggle });
      continue;
    }
    const det = document.createElement("details");
    det.className = "wk-group";
    if (options.openAll) det.open = true;
    const sum = h("summary", "wk-group-sum");
    sum.appendChild(h("span", "wk-group-name", group.g));
    if (group.ownerLabel) sum.appendChild(pill(group.ownerLabel));
    const gc = h("span", "wk-group-count", "");
    sum.appendChild(gc);
    det.appendChild(sum);
    const updateGroup = () => {
      const done = items.filter((it) => isDone(it)).length;
      gc.textContent = done + "/" + items.length;
    };
    const inner = h("div", "wk-group-body");
    det.appendChild(inner);
    const cl = clampedList(inner, CLAMP);
    cl.set(items, (item) => checklistItem(item, { onToggle: () => { updateGroup(); if (options.onToggle) options.onToggle(); } }));
    updateGroup();
    host.appendChild(det);
  }
  clampChildren(host, 3, "groups");
  return allItems;
}

function doneCount(items) {
  return items.filter((it) => isDone(it)).length + " of " + items.length + " done";
}

function searchInput(placeholder, onInput) {
  const input = h("input", "board-input");
  input.type = "search";
  input.placeholder = placeholder;
  input.addEventListener("input", () => onInput(input.value.trim().toLowerCase()));
  return input;
}

function chipRow(labels, active, onPick) {
  const row = h("div", "chip-row");
  for (const label of labels) {
    const b = h("button", "chip", label);
    b.type = "button";
    b.setAttribute("aria-pressed", label === active ? "true" : "false");
    b.addEventListener("click", () => onPick(label));
    row.appendChild(b);
  }
  return row;
}

/* ---------- top strip cards ---------- */

function buildDexActions(grid) {
  const seen = new Set();
  const items = [];
  for (const item of [...(BASH.dex || []), ...(GPT.dex || [])]) {
    if (item.id && seen.has(item.id)) continue;
    if (item.id) seen.add(item.id);
    items.push(item);
  }
  const shell = cardShell(grid, "work-dex-actions", "Dex Actions",
    "The only card that asks Dex to do anything. Bash lane and GPT lane moves, deduped by id.", { pillKind: "hot" });
  const formGroup = (GPT.focused || []).find((g) => String(g.g || "").startsWith("Form packets"));
  const subItems = formGroup ? formGroup.items || [] : [];
  let update = () => shell.setCount(doneCount([...items, ...subItems]));
  flatChecklist(shell.body, items, { onToggle: () => update() });
  let fold = null;
  if (formGroup) {
    fold = foldedSection(shell.body, "Form packets, Bash fills and Dex clicks");
    flatChecklist(fold.body, subItems, { onToggle: () => update() });
  }
  const baseUpdate = update;
  update = () => {
    baseUpdate();
    if (fold) fold.count.textContent = subItems.filter((it) => isDone(it)).length + "/" + subItems.length;
  };
  update();
}

function buildTodayWeek(grid) {
  const shell = cardShell(grid, "work-today", "Today and This Week",
    "Daily loop, this week, and the set up once list. Week items can be added and removed here.", {});
  const daily = FRONT.daily || [];
  const dayCount = h("span", "wk-sec-count", "");
  const updateDay = () => { dayCount.textContent = daily.filter((it) => isDone(it)).length + "/" + daily.length; };
  shell.body.appendChild(sectionHead("Today", dayCount));
  flatChecklist(shell.body, daily, { onToggle: updateDay });
  updateDay();
  shell.body.appendChild(sectionHead("This Week"));
  const week = clampedList(shell.body, CLAMP, "No week items. Add one below.");
  const renderWeek = () => {
    const seed = (FRONT.week || []).filter((w) => !state.weekRemoved.includes(w.id));
    const all = [...seed, ...state.weekAdded];
    week.set(all, (item) => {
      const li = checklistItem(item, {});
      const row = li.firstChild;
      if (item.hot) row.querySelector(".wk-main").appendChild(pill("Time sensitive", "bad"));
      const remove = h("button", "row-x", "×");
      remove.type = "button";
      remove.title = "Remove";
      remove.setAttribute("aria-label", "Remove " + (item.t || "item"));
      remove.addEventListener("click", () => {
        if (String(item.id).startsWith("w")) state.weekRemoved.push(item.id);
        state.weekAdded = state.weekAdded.filter((x) => x.id !== item.id);
        saveState();
        renderWeek();
      });
      row.appendChild(remove);
      return li;
    });
    shell.setCount(all.length + " this week");
  };
  renderWeek();
  const addRow = h("div", "add-row");
  const addInput = h("input", "board-input");
  addInput.placeholder = "Add a week item";
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
  const start = FRONT.start || [];
  const startFold = foldedSection(shell.body, "Set up once");
  const updateStart = () => { startFold.count.textContent = start.filter((it) => isDone(it)).length + "/" + start.length; };
  flatChecklist(startFold.body, start, { onToggle: updateStart });
  updateStart();
}

function buildOneLiner(grid) {
  const shell = cardShell(grid, "work-oneliner", "One Liner and Framing",
    "Editable. Saved to the board work doc.", {});
  const area = h("textarea", "board-textarea");
  area.rows = 3;
  area.value = state.oneLiner || FRONT.oneLiner || "";
  area.addEventListener("input", () => {
    state.oneLiner = area.value;
    saveState();
  });
  shell.body.appendChild(area);
  const row = h("div", "board-row board-row-wrap");
  const copy = h("button", "board-btn is-small", "Copy one liner");
  copy.type = "button";
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(area.value || "");
      copy.textContent = "Copied";
    } catch (err) {
      copy.textContent = "Copy failed";
    }
    setTimeout(() => { copy.textContent = "Copy one liner"; }, 1200);
  });
  row.appendChild(copy);
  shell.body.appendChild(row);
  shell.body.appendChild(textDetails("Creative native framing", FRONT.creativeNativeFraming || ""));
}

function buildStateAndLanes(grid) {
  const shell = cardShell(grid, "work-state", "State and Lanes",
    "Ticks and edits on this tab save to the board work Firestore doc. The old app live Redis state record could not be read from the board, see the Lane 6 summary, so ticks made in the old app after October are not shown here.", {});
  const lanes = FRONT.laneStatus || [];
  const list = h("ul", "board-list");
  for (const lane of lanes) {
    const li = h("li", "board-list-item");
    const row = h("div", "board-row board-row-wrap");
    row.appendChild(h("span", "row-text", lane.name));
    row.appendChild(pill(lane.cadence, lane.cadence === "paused" ? "bad" : "good"));
    li.appendChild(row);
    if (lane.note) li.appendChild(muted(lane.note));
    list.appendChild(li);
  }
  shell.body.appendChild(list);
  shell.setCount(lanes.filter((l) => l.cadence !== "paused").length + " active");
}

/* ---------- money cards: counts and tables only, no amounts in headers ---------- */

function buildTotals(grid) {
  const ob = GPT_AUDIT.outbound || {};
  const g = ob.gpt || {};
  const shell = cardShell(grid, "work-totals", "Totals and Send Audit",
    "Counts only in the header. The register and the day by day log sit inside, collapsed. Totals log last row is 2026-11-06, so these counts are not a current ledger.", { collapsible: true });
  shell.body.appendChild(kvStrip([
    [(ob.emailRecords || []).length, "Email recs"],
    [(ob.formRecords || []).length, "Form recs"],
    [g.cold || 0, "Cold sends"],
    [g.focused || 0, "Focused"],
    [g.applicationEmails || 0, "Email apps"],
    [g.bounced || 0, "Bounced"],
  ]));
  if (ob.notes) shell.body.appendChild(textDetails("Audit notes", ob.notes));
  const logDet = document.createElement("details");
  logDet.className = "wk-det";
  logDet.appendChild(h("summary", null, "Day by day log, " + (FRONT.totalsLog || []).length + " days"));
  const logList = clampedList(logDet, CLAMP);
  logList.set(FRONT.totalsLog || [], (row) => {
    const li = h("li", "board-list-item");
    const line = h("div", "board-row");
    line.appendChild(h("span", "row-text", row.d));
    line.appendChild(h("span", "row-meta", "sent " + (row.sent || 0) + ", apps " + (row.apps || 0)));
    li.appendChild(line);
    const det = detailsFor(row, ["d", "sent", "apps"]);
    if (det) li.appendChild(det);
    return li;
  });
  shell.body.appendChild(logDet);
  shell.body.appendChild(sectionHead("Send and submission register"));
  const records = [...(ob.emailRecords || []), ...(ob.formRecords || [])];
  let query = "";
  shell.body.appendChild(searchInput("Search the register", (q) => { query = q; renderRegister(); }));
  const reg = clampedList(shell.body, CLAMP, "No records match.");
  function renderRegister() {
    const filtered = records.filter((r) => !query || JSON.stringify(r).toLowerCase().includes(query));
    reg.set(filtered, (r) => {
      const li = h("li", "board-list-item");
      const main = h("div", "wk-main");
      main.appendChild(h("span", "row-text wk-strong", r.company || ""));
      const meta = [r.status, r.date].filter(Boolean).join(", ");
      if (meta) main.appendChild(h("span", "wk-meta", meta));
      const det = detailsFor(r, ["company", "status", "date"]);
      if (det) main.appendChild(det);
      li.appendChild(main);
      return li;
    });
    shell.setCount(filtered.length + " records");
  }
  renderRegister();

  const cash = cardShell(grid, "work-cash", "Cash Board and Log",
    "The old app cash board lives only in its live Redis state record, which the board cannot read, so no figures were imported. This log is the board own, stored in the board work doc.", {});
  const cashList = clampedList(cash.body, CLAMP, "No entries yet.");
  const renderCash = () => {
    cashList.set(state.cashLog, (entry) => {
      const li = h("li", "board-list-item");
      const line = h("div", "board-row");
      line.appendChild(h("span", "row-text", entry.text || ""));
      line.appendChild(h("span", "row-meta", entry.date || ""));
      li.appendChild(line);
      return li;
    });
    cash.setCount(state.cashLog.length + " entries");
  };
  renderCash();
  const cashRow = h("div", "add-row");
  const cashInput = h("input", "board-input");
  cashInput.placeholder = "Log entry text";
  const cashBtn = h("button", "board-btn", "Add entry");
  cashBtn.type = "button";
  const addCash = () => {
    const text = cashInput.value.trim();
    if (!text) return;
    state.cashLog.push({ date: new Date().toISOString().slice(0, 10), text });
    cashInput.value = "";
    saveState();
    renderCash();
    cashList.expand();
  };
  cashBtn.addEventListener("click", addCash);
  cashInput.addEventListener("keydown", (e) => { if (e.key === "Enter") addCash(); });
  cashRow.appendChild(cashInput);
  cashRow.appendChild(cashBtn);
  cash.body.appendChild(cashRow);
}

function buildLadder(grid) {
  const shell = cardShell(grid, "work-ladder", "Quick Cash Ladder",
    "Moves grouped by level. Pay, speed and where sit on each row, the how sits in the details.", { collapsible: true });
  const levels = QUICKCASH.ladder || [];
  let total = 0;
  const host = h("div", "wk-groups");
  shell.body.appendChild(host);
  levels.forEach((level, idx) => {
    const moves = level.moves || [];
    total += moves.length;
    const det = document.createElement("details");
    det.className = "wk-group";
    if (idx === 0) det.open = true;
    const sum = h("summary", "wk-group-sum");
    sum.appendChild(h("span", "wk-group-name", level.title || ""));
    if (level.aim) sum.appendChild(pill("aim " + level.aim));
    det.appendChild(sum);
    const inner = h("div", "wk-group-body");
    det.appendChild(inner);
    const cl = clampedList(inner, CLAMP);
    cl.set(moves, (m) => {
      const item = { id: m.id, t: [m.t, m.pay, m.speed].filter(Boolean).join(", "), how: m.how, where: m.where };
      const li = checklistItem({ id: item.id, t: item.t }, {});
      const det2 = detailsFor(item, ["t"]);
      if (det2) li.querySelector(".wk-main").appendChild(det2);
      return li;
    });
    host.appendChild(det);
  });
  shell.setCount(total + " moves");
}

/* ---------- pipeline ---------- */

function buildPipeline(grid) {
  const companies = PIPELINE.companies || [];
  const shell = cardShell(grid, "work-pipeline", "Applications Pipeline",
    "Public and private pipeline merged and deduped by id. One searchable table card, not one card per company. Checked dates are October snapshots.",
    {});
  shell.body.appendChild(kvStrip([
    [companies.length, "Records"],
    [PIPELINE.publicCount, "Public"],
    [PIPELINE.privateCount, "Private"],
  ]));
  let query = "";
  let pillar = "All";
  let view = "All";
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
  shell.body.appendChild(filterRow);
  const chipHost = h("div");
  const renderChips = () => {
    chipHost.replaceChildren(chipRow(["All", "Active", "Done"], view, (picked) => {
      view = picked;
      renderChips();
      render();
    }));
  };
  renderChips();
  shell.body.appendChild(chipHost);
  const list = clampedList(shell.body, CLAMP, "No records match.");
  function render() {
    const filtered = companies.filter((c) => {
      if (pillar !== "All" && c.pillar !== pillar) return false;
      if (view === "Done" && !isDone(c)) return false;
      if (view === "Active" && isDone(c)) return false;
      if (query && !(String(c.co || "") + " " + String(c.role || "") + " " + String(c.why || "")).toLowerCase().includes(query)) return false;
      return true;
    });
    list.set(filtered, (c) => {
      const li = h("li", "board-list-item");
      const row = h("div", "board-row wk-top");
      const box = document.createElement("input");
      box.type = "checkbox";
      box.checked = isDone(c);
      li.classList.toggle("is-done", box.checked);
      box.addEventListener("change", () => {
        setDone(c, box.checked);
        li.classList.toggle("is-done", box.checked);
      });
      row.appendChild(box);
      const wrap = h("div", "wk-main");
      wrap.appendChild(h("span", "row-text wk-strong", c.co || ""));
      const meta = [c.role, c.pay, c.pillar, c.kind, c.listing].filter(Boolean).join(", ");
      if (meta) wrap.appendChild(h("span", "wk-meta", meta));
      if (c.why) wrap.appendChild(textDetails("Why", c.why));
      if (c.url) wrap.appendChild(link(c.url, "Listing"));
      row.appendChild(wrap);
      li.appendChild(row);
      return li;
    });
    shell.setCount(filtered.length + " of " + companies.length);
  }
  render();
}

function buildWatchlist(grid) {
  const names = PIPELINE.watchlist || [];
  const shell = cardShell(grid, "work-watchlist", "Watchlist",
    "Company names only. No per company detail exists in the source.", { collapsible: true, pill: names.length + " names" });
  tagCloud(shell.body, names, 18);
}

function leadRow(lead) {
  const li = h("li", "board-list-item");
  const main = h("div", "wk-main");
  main.appendChild(h("span", "row-text wk-strong", lead.co || lead.name || ""));
  const meta = [lead.role, lead.pay, lead.status, lead.lane, lead.checked].filter(Boolean).join(", ");
  if (meta) main.appendChild(h("span", "wk-meta", meta));
  const det = detailsFor(lead, []);
  if (det) {
    /* The reason leads the detail block, so a row stays one line tall. */
    if (lead.why) {
      det.querySelector("summary").textContent = "Why and details";
      det.querySelector(".wk-det-body").prepend(h("div", "wk-long", lead.why));
    }
    main.appendChild(det);
  } else if (lead.why) {
    main.appendChild(textDetails("Why", lead.why));
  }
  li.appendChild(main);
  return li;
}

function buildQuickChannels(grid) {
  const channels = QUICKCASH.quick || [];
  const shell = cardShell(grid, "work-quick-channels", "Quick Cash Channels",
    "Channels with timing, reason and link.", { collapsible: true, pill: channels.length + " channels" });
  const list = clampedList(shell.body, CLAMP);
  list.set(channels, (c) => {
    const li = h("li", "board-list-item");
    const main = h("div", "wk-main");
    main.appendChild(h("span", "row-text wk-strong", c.co || ""));
    const meta = [c.role, c.pay].filter(Boolean).join(", ");
    if (meta) main.appendChild(h("span", "wk-meta", meta));
    if (c.why) main.appendChild(textDetails("Why", c.why));
    if (c.url) main.appendChild(link(c.url, "Channel"));
    li.appendChild(main);
    return li;
  });
}

/* ---------- board lane cards ---------- */

function isBuildGroup(group) {
  return String(group.g || "").startsWith("BUILD");
}

function buildFocused(grid) {
  const shell = cardShell(grid, "work-focused", "Focused Outreach",
    "GPT focused groups and Bash focused groups in one checklist, owner labelled. The form packets group lives in Dex Actions, and the BUILD group has its own card, so no group is editable in two places.", { collapsible: true });
  const groups = [];
  for (const g of GPT.focused || []) {
    if (String(g.g || "").startsWith("Form packets")) continue;
    groups.push({ g: g.g, items: g.items || [], ownerLabel: "GPT" });
  }
  for (const g of BASH.focused || []) {
    if (isBuildGroup(g)) continue;
    groups.push({ g: g.g, items: g.items || [], ownerLabel: "Bash" });
  }
  let all = [];
  const update = () => shell.setCount(doneCount(all));
  all = checklistGroups(shell.body, groups, { onToggle: update });
  update();
}

function buildCold(grid) {
  const pause = GPT.executionPause || {};
  const shell = cardShell(grid, "work-cold", "Cold Outreach",
    "Bash cold groups. Cold outreach is paused: " + (pause.scope || "recorded as paused in the source data."),
    { collapsible: true, flag: "Paused", flagKind: "bad" });
  let all = [];
  const update = () => shell.setCount(doneCount(all));
  all = checklistGroups(shell.body, (BASH.cold || []).map((g) => ({ g: g.g, items: g.items || [], ownerLabel: "Bash" })), { onToggle: update });
  update();
}

function buildBashCard(grid) {
  const shell = cardShell(grid, "work-bash", "Bash Lane",
    "Email outreach, marketplaces, agencies, inventory and recruiting. The Bash groups render once, in the Focused, Cold and BUILD cards, so ticks never fork. This card is the lane index.", {});
  const totals = BASH.totals || {};
  const rows = [
    ["Dex moves", (BASH.dex || []).length, "work-dex-actions"],
    ["Cold groups", (BASH.cold || []).reduce((n, g) => n + (g.items || []).length, 0), "work-cold"],
    ["Focused groups", (BASH.focused || []).filter((g) => !isBuildGroup(g)).reduce((n, g) => n + (g.items || []).length, 0), "work-focused"],
    ["BUILD group", (BASH.focused || []).filter(isBuildGroup).reduce((n, g) => n + (g.items || []).length, 0), "work-build"],
  ];
  if (totals.coldSent !== undefined) {
    shell.body.appendChild(kvStrip([[totals.coldSent, "Cold sent"], [rows.reduce((n, r) => n + r[1], 0), "Items"]]));
    shell.body.appendChild(muted("Cold sent, per the source file defaults."));
  }
  for (const [label, count, target] of rows) {
    const row = h("div", "stat-row");
    row.appendChild(h("span", "stat-label", label));
    const right = h("span", "wk-stat-right");
    right.appendChild(h("span", "stat-value", count + " items"));
    const jump = h("button", "board-btn is-small", "Open");
    jump.type = "button";
    jump.title = "Open card";
    jump.addEventListener("click", () => {
      const targetEl = document.getElementById(target);
      if (!targetEl) return;
      targetEl.classList.remove("wk-collapsed");
      targetEl.scrollIntoView({ behavior: "smooth", block: "start" });
      targetEl.classList.add("is-flash");
      setTimeout(() => targetEl.classList.remove("is-flash"), 1200);
    });
    right.appendChild(jump);
    row.appendChild(right);
    shell.body.appendChild(row);
  }
}

function listOfStrings(parent, lines, n) {
  const cl = clampedList(parent, n || CLAMP);
  cl.set(lines, (line) => {
    const li = h("li", "board-list-item");
    li.appendChild(h("span", "row-text", typeof line === "string" ? line : JSON.stringify(line)));
    return li;
  });
  return cl;
}

function buildGptCard(grid) {
  const shell = cardShell(grid, "work-gpt", "GPT Lane",
    "Checked " + (GPT.checked || "2026-10-12") + ". Nothing in this lane postdates October 23, 2026. Dex moves live in Dex Actions and focused groups live in Focused Outreach, so this card carries the leads, the gate and rules, the history and the audits.",
    { collapsible: true });
  shell.body.appendChild(kvStrip([
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
        shell.setCount(filtered.length + " of " + leads.length + " leads");
      }
      renderLeads();
    } else if (active === "Gate and rules") {
      pane.appendChild(sectionHead("Pay and quality gate"));
      listOfStrings(pane, GPT.gate || []);
      pane.appendChild(sectionHead("Drafting rules"));
      listOfStrings(pane, GPT.rules || []);
      shell.setCount("");
    } else if (active === "History and review") {
      const hist = GPT.history || {};
      const rev = GPT.review || {};
      pane.appendChild(muted("History is the per lead default state store, " + Object.keys(hist).length + " records. Review overrides, " + Object.keys(rev).length + " records. Search by lead id."));
      let query = "";
      pane.appendChild(searchInput("Search history by lead id", (q) => { query = q; renderHist(); }));
      const list = clampedList(pane, CLAMP, "No records match.");
      function renderHist() {
        const entries = Object.entries(hist).filter(([id]) => !query || id.includes(query));
        list.set(entries, ([id, val]) => {
          const li = h("li", "board-list-item");
          const main = h("div", "wk-main");
          main.appendChild(h("span", "row-text", id));
          const meta = (val.status || "") + (val.d ? ", done" : "");
          if (meta) main.appendChild(h("span", "wk-meta", meta));
          if (rev[id]) {
            const det = detailsFor(rev[id], []);
            if (det) main.appendChild(det);
          }
          li.appendChild(main);
          return li;
        });
        shell.setCount(entries.length + " history records");
      }
      renderHist();
    } else if (active === "Audits") {
      pane.appendChild(muted("Dated reconciliation audits, carried as summaries. The long disposition lists stay in the source repo. The full send register sits in the Totals and Send Audit card."));
      const audits = Object.entries(GPT_AUDIT.audits || {});
      const host = h("div", "wk-groups");
      for (const [key, val] of audits) host.appendChild(textDetails(key, JSON.stringify(val, null, 1), true));
      pane.appendChild(host);
      clampChildren(host, CLAMP);
      shell.setCount(audits.length + " audit summaries");
    } else {
      pane.appendChild(sectionHead("Blocked leads"));
      clampedList(pane, CLAMP).set(GPT.blocked || [], leadRow);
      pane.appendChild(sectionHead("Archives"));
      clampedList(pane, CLAMP).set(GPT.archives || [], leadRow);
      pane.appendChild(sectionHead("Owned by Bash, GPT must not touch", h("span", "wk-sec-count", (GPT.ownedByBash || []).length + " companies")));
      tagCloud(pane, GPT.ownedByBash || [], 14);
      shell.setCount("");
    }
  };
  const tabHost = h("div");
  const renderTabs = () => {
    tabHost.replaceChildren(chipRow(tabs, active, (picked) => { active = picked; renderTabs(); renderPane(); }));
  };
  renderTabs();
  shell.body.appendChild(tabHost);
  shell.body.appendChild(pane);
  renderPane();
}

function buildBuildCard(grid) {
  const group = (BASH.focused || []).find(isBuildGroup);
  const shell = cardShell(grid, "work-build", "BUILD, Fast Cash Build Stack",
    group ? group.g : "The BUILD group inside Bash focused.", {});
  if (group) {
    const items = group.items || [];
    const update = () => shell.setCount(items.filter((it) => isDone(it)).length + " of " + items.length + " offers");
    flatChecklist(shell.body, items, { onToggle: update });
    update();
  }
}

function buildMoonCheats(grid) {
  const moon = cardShell(grid, "work-moon", "Moonshots",
    "Deliberately large asks and giant listings.", { collapsible: true });
  const moonItems = checklistGroups(moon.body, MOON.moon || [], {});
  moon.setCount(moonItems.length + " items");
  const cheats = cardShell(grid, "work-cheats", "Cheat Codes",
    "Systems, not jobs, grouped by tier.", { collapsible: true });
  const cheatItems = checklistGroups(cheats.body, MOON.cheats || [], {});
  cheats.setCount(cheatItems.length + " items");
}

/* ---------- opportunity, funding and client cards ---------- */

function buildClients(grid) {
  const shell = cardShell(grid, "work-clients", "Clients in Progress",
    "Contact data and the negotiation history render only inside the detail block. Status and notes save to the board work doc.", {});
  const clients = CLIENTS.clients || [];
  const statusKind = { "In Progress": "hot", Completed: "good", Cancelled: "bad" };
  const updateCount = () => {
    const live = clients.filter((c) => (state.clientStatus[c.id] || "In Progress") === "In Progress").length;
    shell.setCount(live + " in progress");
  };
  for (const client of clients) {
    const item = h("div", "wk-client");
    const row = h("div", "board-row board-row-wrap");
    row.appendChild(h("span", "row-text wk-strong", client.co || client.id || "Client"));
    const select = h("select", "board-select wk-select");
    select.setAttribute("aria-label", "Client status");
    for (const status of ["In Progress", "Completed", "Cancelled"]) {
      const opt = h("option", null, status);
      opt.value = status;
      select.appendChild(opt);
    }
    select.value = state.clientStatus[client.id] || "In Progress";
    const tag = pill(select.value, statusKind[select.value]);
    select.addEventListener("change", () => {
      state.clientStatus[client.id] = select.value;
      tag.className = "pill " + (statusKind[select.value] || "");
      tag.textContent = select.value;
      saveState();
      updateCount();
    });
    row.appendChild(tag);
    item.appendChild(row);
    item.appendChild(select);
    const det = detailsFor(client, ["co"]);
    if (det) {
      det.open = false;
      item.appendChild(det);
    }
    const notes = h("textarea", "board-textarea");
    notes.rows = 2;
    notes.placeholder = "Client notes";
    notes.value = state.clientNotes[client.id] || "";
    notes.addEventListener("input", () => {
      state.clientNotes[client.id] = notes.value;
      saveState();
    });
    item.appendChild(notes);
    shell.body.appendChild(item);
  }
  updateCount();
}

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

function buildBackers(grid) {
  const backers = BACKERS.backers || [];
  const shell = cardShell(grid, "work-backers", "Backers and Funding",
    BACKERS.stalenessNote || "", { collapsible: true });
  const rulings = BACKERS.rulings || [];
  if (rulings.length) {
    shell.body.appendChild(sectionHead("Rulings"));
    const rl = h("ul", "board-list");
    for (const ruling of rulings) {
      const li = h("li", "board-list-item");
      const row = h("div", "board-row board-row-wrap");
      row.appendChild(h("span", "row-text wk-strong", ruling.name));
      row.appendChild(pill(ruling.status, rulingKind(ruling.status)));
      li.appendChild(row);
      if (ruling.note) li.appendChild(muted(ruling.note));
      rl.appendChild(li);
    }
    shell.body.appendChild(rl);
  }
  const filters = ["All", "Grants", "Funds", "Accelerators", "Publishers", "Loans and debt", "Credits not cash", "Angels", "Submitted", "Closed", "Do not pay", "Contested"];
  let active = "All";
  let query = "";
  shell.body.appendChild(sectionHead("All backers"));
  shell.body.appendChild(searchInput("Search backers", (q) => { query = q; render(); }));
  const chipHost = h("div");
  const renderChips = () => {
    chipHost.replaceChildren(chipRow(filters, active, (picked) => { active = picked; renderChips(); render(); }));
  };
  renderChips();
  shell.body.appendChild(chipHost);
  const list = clampedList(shell.body, CLAMP, "No backers match this filter.");
  function render() {
    const filtered = backers.filter((b) => {
      if (active !== "All" && backerCategory(b) !== active) return false;
      if (query && !(String(b.name || "") + " " + String(b.type || "")).toLowerCase().includes(query)) return false;
      return true;
    });
    list.set(filtered, (b) => {
      const li = h("li", "board-list-item");
      const row = h("div", "board-row wk-top");
      const box = document.createElement("input");
      box.type = "checkbox";
      box.checked = !!state.backerDone[b.id];
      li.classList.toggle("is-done", box.checked);
      box.title = "Pursued or done";
      box.addEventListener("change", () => {
        state.backerDone[b.id] = box.checked;
        li.classList.toggle("is-done", box.checked);
        saveState();
      });
      row.appendChild(box);
      const wrap = h("div", "wk-main");
      const headRow = h("div", "wk-titleline");
      headRow.appendChild(h("span", "row-text wk-strong", b.name || ""));
      if (b.ruling) headRow.appendChild(pill(b.ruling, rulingKind(b.ruling)));
      if (backerCategory(b) === "Do not pay") headRow.appendChild(pill("Do not pay", "bad"));
      if (backerCategory(b) === "Contested") headRow.appendChild(pill("Contested, recheck before use", "warn"));
      wrap.appendChild(headRow);
      const meta = [b.type, b.amount].filter(Boolean).join(", ");
      if (meta) wrap.appendChild(h("span", "wk-meta", meta));
      const det = detailsFor(b, ["name", "type", "amount", "ruling"]);
      if (det) wrap.appendChild(det);
      row.appendChild(wrap);
      li.appendChild(row);
      return li;
    });
    shell.setCount(filtered.length + " of " + backers.length);
  }
  render();
}

function buildWebDesign(grid) {
  const shell = cardShell(grid, "work-webdesign", "Web Design Lane",
    "Grouped by wave. Status label on every row. Contact routes render only inside detail blocks. Killed rows are hidden until the toggle is on.", { collapsible: true });
  const entries = WEBDESIGN.webdesign || [];
  let showKilled = false;
  const toggleRow = h("label", "board-row wk-toggle");
  const toggle = document.createElement("input");
  toggle.type = "checkbox";
  toggle.addEventListener("change", () => { showKilled = toggle.checked; render(); });
  toggleRow.appendChild(toggle);
  toggleRow.appendChild(h("span", null, "Show killed"));
  shell.body.appendChild(toggleRow);
  const host = h("div", "wk-groups");
  shell.body.appendChild(host);
  const render = () => {
    host.replaceChildren();
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
      const cl = clampedList(sec, 1);
      cl.set(waves[wave], (entry) => {
        const li = h("li", "board-list-item");
        const main = h("div", "wk-main");
        const headRow = h("div", "wk-titleline");
        headRow.appendChild(h("span", "row-text wk-strong", entry.name || ""));
        const status = String(entry.type || "").split(", ").pop() || entry.type || "";
        if (status) headRow.appendChild(pill(status, /KILLED/.test(status) ? "bad" : ""));
        main.appendChild(headRow);
        if (entry.amount) main.appendChild(h("span", "wk-meta", entry.amount));
        const det = detailsFor(entry, ["name", "type", "amount"]);
        if (det) main.appendChild(det);
        li.appendChild(main);
        return li;
      });
      host.appendChild(sec);
    }
    shell.setCount(total + " of " + entries.length + " shown");
  };
  render();
}

function buildStartups(grid) {
  const s = GPT_OPPS.startups || {};
  const shell = cardShell(grid, "work-startups", "Startups Cohort",
    "GPT startup outreach cohort, started 2026-10-13. Contact addresses render only inside detail blocks.", { collapsible: true });
  const flags = h("div", "chip-row");
  if (s.active === false) flags.appendChild(pill("Not active", "bad"));
  if (s.noSending) flags.appendChild(pill("No sending", "bad"));
  if (s.noDrafts) flags.appendChild(pill("No drafts", "bad"));
  if (s.requiresExactTextApproval) flags.appendChild(pill("Exact text approval required", "warn"));
  if (s.status) flags.appendChild(pill("Status: " + s.status));
  if (flags.children.length) shell.body.appendChild(flags);
  if (s.outreachNotice) shell.body.appendChild(textDetails("Outreach notice", s.outreachNotice));
  const buckets = [
    ["Contact ready", s.contactReady || []],
    ["Backlog", s.backlog || []],
    ["Rejected", s.rejected || []],
    ["Pass log", s.passLog || []],
    ["Dead", s.dead || []],
  ];
  shell.body.appendChild(kvStrip(buckets.map(([label, rows]) => [rows.length, label])));
  let active = "Contact ready";
  const chipHost = h("div");
  shell.body.appendChild(chipHost);
  const list = clampedList(shell.body, CLAMP, "Nothing in this bucket.");
  const renderBucket = () => {
    const bucket = buckets.find(([label]) => label === active);
    const rows = bucket ? bucket[1] : [];
    list.set(rows, (r) => {
      const li = h("li", "board-list-item");
      const main = h("div", "wk-main");
      main.appendChild(h("span", "row-text wk-strong", r.name || r.id || ""));
      const meta = [r.tier, r.status, r.stage, r.location].filter(Boolean).join(", ");
      if (meta) main.appendChild(h("span", "wk-meta", meta));
      const det = detailsFor(r, ["name", "tier", "status", "stage", "location"]);
      if (det) main.appendChild(det);
      li.appendChild(main);
      return li;
    });
    shell.setCount(rows.length + " " + active.toLowerCase());
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
}

function buildFastCoin(grid) {
  const fc = GPT_OPPS.fastCoin || {};
  const shell = cardShell(grid, "work-fastcoin", "Fast Coin",
    "Started " + (fc.started || "") + ". Checkpoint " + (fc.checkpoint || "") + " has passed. Status: " + (fc.status || "") + ". Target: " + (fc.target || "") + ".",
    { collapsible: true, flag: fc.status === "paused" ? "Paused" : "", flagKind: "warn" });
  shell.body.appendChild(kvStrip([
    [(fc.leads || []).length, "Leads"],
    [(fc.doFirst || []).length, "Do first"],
    [(fc.dead || []).length, "Dead"],
    [(fc.passes || []).length, "Passes"],
  ]));
  if (fc.pauseNote) shell.body.appendChild(textDetails("Pause note", fc.pauseNote));
  shell.body.appendChild(sectionHead("Do first"));
  const doFirst = (fc.doFirst || []).map((d) => ({ id: d.id || d.name, t: d.name || d.t, body: d.nextAction || "" }));
  flatChecklist(shell.body, doFirst, {});
  shell.body.appendChild(sectionHead("Leads"));
  clampedList(shell.body, CLAMP).set(fc.leads || [], leadRow);
  const deadDet = document.createElement("details");
  deadDet.className = "wk-det";
  deadDet.appendChild(h("summary", null, "Dead, " + (fc.dead || []).length));
  clampedList(deadDet, CLAMP).set(fc.dead || [], leadRow);
  shell.body.appendChild(deadDet);
  shell.body.appendChild(textDetails("Pass log, " + (fc.passes || []).length, JSON.stringify(fc.passes || [], null, 1), true));
  if (fc.wrapUpNote) shell.body.appendChild(textDetails("Wrap up note", fc.wrapUpNote));
  shell.setCount((fc.leads || []).length + " leads");
}

function platformCard(grid, id, title, coll, extra) {
  const shell = cardShell(grid, id, title,
    (coll.label || coll.title || "") + (coll.date ? ", " + coll.date : "") + ". Research collection, not a queue.",
    { collapsible: true });
  const companies = coll.companies || coll.records || [];
  if (Array.isArray(coll.topTen) && coll.topTen.length) {
    shell.body.appendChild(sectionHead("Top ten first"));
    const top = clampedList(shell.body, 5, null, "ol");
    top.list.classList.add("wk-ol");
    top.set(coll.topTen, (entry) => h("li", "board-list-item",
      typeof entry === "string" ? entry : (entry.name || entry.title || JSON.stringify(entry))));
  }
  shell.body.appendChild(sectionHead("Companies"));
  clampedList(shell.body, CLAMP).set(companies, leadRow);
  shell.setCount(companies.length + " companies");
  if (extra) extra(shell.body, coll);
  return shell;
}

function buildPlatforms(grid) {
  platformCard(grid, "work-platforms-opp", "Platform Opportunities", GPT_OPPS.platformOpportunities || {});
  platformCard(grid, "work-platforms-eco", "Platform Ecosystems", GPT_OPPS.platformEcosystems || {});
  platformCard(grid, "work-platforms-vol", "Platform Volume Hunt", GPT_OPPS.platformVolumeHunt || {}, (body, coll) => {
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
      clampedList(body, 4).set(records, leadRow);
    }
  });
}

function buildFundedWave(grid) {
  const fw = GPT_OPPS.fundedWaveOct23 || {};
  const shell = cardShell(grid, "work-funded-wave", "Funded Wave, October 23",
    "Recorded " + (fw.recordedAt || "") + " by " + (fw.recordedBy || "") + ".",
    { collapsible: true, flag: "Unverified claims", flagKind: "warn" });
  if (fw.summary) shell.body.appendChild(textDetails("Summary", fw.summary));
  if (fw.sendRule) shell.body.appendChild(muted("Send rule: " + fw.sendRule));
  clampedList(shell.body, CLAMP).set(fw.companies || [], leadRow);
  shell.setCount((fw.companies || []).length + " companies");
}

function buildIncome(grid) {
  const asap = INCOME.asap || {};
  const shell = cardShell(grid, "work-income", "Income ASAP",
    "Checked " + (asap.checked || "2026-10-10") + ", the oldest dated research in the app. Urgent small money plan, remote first.",
    { collapsible: true });
  if (asap.summary) shell.body.appendChild(textDetails("Summary", asap.summary));
  shell.body.appendChild(sectionHead("Account set up, in sequence"));
  const setup = (asap.accountSetup || []).map((s) => ({ id: s.id, t: s.title, body: s.body || "" }));
  flatChecklist(shell.body, setup, {});
  shell.body.appendChild(sectionHead("Profile copy"));
  const profileText = typeof asap.profileCopy === "string" ? asap.profileCopy : JSON.stringify(asap.profileCopy || "");
  const profileRow = h("div", "board-row board-row-wrap");
  if (asap.profileTitle) profileRow.appendChild(h("span", "row-text", asap.profileTitle));
  profileRow.appendChild(copyButton(profileText, "Copy profile copy"));
  shell.body.appendChild(profileRow);
  shell.body.appendChild(textDetails("Read the profile copy", profileText));
  shell.body.appendChild(sectionHead("Leads"));
  clampedList(shell.body, CLAMP).set(asap.leads || [], leadRow);
  for (const section of ["review", "sprint"]) {
    if (asap[section]) {
      shell.body.appendChild(textDetails(section === "review" ? "Portfolio review" : "Sprint",
        typeof asap[section] === "string" ? asap[section] : JSON.stringify(asap[section], null, 1), true));
    }
  }
  shell.body.appendChild(muted("Exclusion note from the app README: old contests, funding, loans and known stale marketplace examples stay on the original board and are excluded from this urgent list."));
  shell.setCount((asap.leads || []).length + " leads");
}

/* ---------- reference stack and archive ---------- */

function buildGuides(grid) {
  const guides = GUIDES.guides || [];
  const shell = cardShell(grid, "work-guides", "Guides and Reference",
    "One collapsed card section per guide. Short version first, full text behind the expander. The resume surfaces registry lives in the work repo root as RESUME-SURFACES.md and is linked from the Resume Sync guide, it is not copied here.",
    { collapsible: true, pill: guides.length + " guides" });
  const host = h("div", "wk-groups");
  for (const guide of guides) {
    const det = document.createElement("details");
    det.className = "wk-group";
    det.appendChild(h("summary", "wk-group-sum", guide.t || "Guide"));
    const inner = h("div", "wk-group-body");
    inner.appendChild(h("div", "wk-long", typeof guide.dex === "string" ? guide.dex : JSON.stringify(guide.dex || "")));
    if (guide.ai) inner.appendChild(textDetails("Full text", typeof guide.ai === "string" ? guide.ai : JSON.stringify(guide.ai || "")));
    det.appendChild(inner);
    host.appendChild(det);
  }
  shell.body.appendChild(host);
  clampChildren(host, 8, "guides");
  shell.body.appendChild(sectionHead("Strategy and application rules"));
  const blocks = [
    ["Honesty rules", FRONT.rules],
    ["High volume sending", FRONT.volume],
    ["Long term strategy", FRONT.longterm],
  ];
  for (const [label, obj] of blocks) {
    if (!obj) continue;
    shell.body.appendChild(textDetails(label, typeof obj === "string" ? obj : JSON.stringify(obj, null, 1), true));
  }
  shell.body.appendChild(sectionHead("Outreach scripts"));
  const scripts = h("ul", "board-list");
  for (const script of FRONT.scripts || []) {
    const li = h("li", "board-list-item");
    const row = h("div", "board-row");
    row.appendChild(h("span", "row-text", script.t || "Script"));
    row.appendChild(copyButton(script.body || "", "Copy script"));
    li.appendChild(row);
    scripts.appendChild(li);
  }
  shell.body.appendChild(scripts);
}

function buildArchive(grid) {
  const files = ARCHIVE.files || [];
  const shell = cardShell(grid, "work-archive", "Archive, Local Draft Corpora",
    ARCHIVE.note || "", { collapsible: true, pill: files.length + " files" });
  const kb = Math.round(files.reduce((n, f) => n + (f.bytes || 0), 0) / 1024);
  shell.body.appendChild(kvStrip([[files.length, "Files"], [kb.toLocaleString(), "KB total"]]));
  clampedList(shell.body, CLAMP).set(files, (file) => {
    const li = h("li", "board-list-item");
    const main = h("div", "wk-main");
    const line = h("div", "board-row");
    line.appendChild(h("span", "row-text wk-strong", file.name));
    line.appendChild(h("span", "row-meta", Math.round((file.bytes || 0) / 1024) + " KB"));
    main.appendChild(line);
    main.appendChild(h("span", "wk-meta", file.path));
    li.appendChild(main);
    return li;
  });
}

/* ---------- mount and unmount ---------- */

export async function mount(container, ctx) {
  rootEl = container;
  storeRef = ctx && ctx.store ? ctx.store : null;
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
  buildTodayWeek(grid);
  buildOneLiner(grid);
  buildStateAndLanes(grid);
  buildTotals(grid);
  buildLadder(grid);
  buildPipeline(grid);
  buildWatchlist(grid);
  buildQuickChannels(grid);
  buildFocused(grid);
  buildCold(grid);
  buildBashCard(grid);
  buildGptCard(grid);
  buildBuildCard(grid);
  buildMoonCheats(grid);
  buildClients(grid);
  buildBackers(grid);
  buildWebDesign(grid);
  buildStartups(grid);
  buildFastCoin(grid);
  buildPlatforms(grid);
  buildFundedWave(grid);
  buildIncome(grid);
  buildGuides(grid);
  buildArchive(grid);
  foldBlocks(grid);
}

/* Fold every block to its head and its first list. A block's later sections
   (a second list, its filters, its notes) go behind one "More in this block"
   button, and any plain list longer than CLAMP rows gets its own Show all.
   Without this Work was about 10,000px tall at 1440. */
function foldBlocks(grid) {
  for (const body of grid.querySelectorAll(":scope > .board-card > .board-card-body")) {
    for (const ul of body.querySelectorAll("ul.board-list")) {
      const next = ul.nextElementSibling;
      if (next && next.classList.contains("more-btn")) continue;
      const items = Array.from(ul.children).filter((li) => li.tagName === "LI" && !li.classList.contains("board-empty"));
      /* Plain lists here are long-form rows (rulings, notes): two show. */
      const SHOW = 2;
      if (items.length <= SHOW) continue;
      const btn = h("button", "more-btn");
      btn.type = "button";
      let open = false;
      const draw = () => {
        items.forEach((li, i) => li.classList.toggle("is-clamped-out", !open && i >= SHOW));
        btn.textContent = open ? "Show fewer" : "Show all (" + items.length + ")";
        btn.setAttribute("aria-expanded", open ? "true" : "false");
      };
      btn.addEventListener("click", () => { open = !open; draw(); });
      ul.after(btn);
      draw();
    }
    const kids = Array.from(body.children);
    let cut = kids.findIndex((k) => k.matches("ul.board-list, table, .kv, details, .wk-groups"));
    if (cut < 0) continue;
    if (kids[cut + 1] && kids[cut + 1].classList.contains("more-btn")) cut += 1;
    const rest = kids.slice(cut + 1);
    if (!rest.length) continue;
    const fold = h("div", "wk-fold");
    fold.hidden = true;
    fold.append(...rest);
    const more = h("button", "more-btn wk-fold-btn", "More in this block");
    more.type = "button";
    more.setAttribute("aria-expanded", "false");
    more.addEventListener("click", () => {
      fold.hidden = !fold.hidden;
      more.textContent = fold.hidden ? "More in this block" : "Less";
      more.setAttribute("aria-expanded", fold.hidden ? "false" : "true");
    });
    body.append(more, fold);
  }
}

export function unmount() {
  if (rootEl) rootEl.replaceChildren();
  rootEl = null;
  storeRef = null;
  state = null;
}
