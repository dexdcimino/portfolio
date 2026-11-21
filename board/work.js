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
   follow up. */

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

function badge(text, warn) {
  const b = h("span", null, text);
  b.style.display = "inline-block";
  b.style.padding = "1px 8px";
  b.style.borderRadius = "999px";
  b.style.fontSize = "11.5px";
  b.style.fontWeight = "700";
  b.style.background = warn ? "var(--danger)" : "var(--accent)";
  b.style.color = warn ? "#ffffff" : "var(--accent-ink)";
  return b;
}

function muted(text) {
  const p = h("p", "board-card-sub", text);
  return p;
}

function link(url, label) {
  const a = h("a", null, label || url);
  a.href = url;
  a.target = "_blank";
  a.rel = "noopener";
  a.style.color = "var(--accent)";
  a.style.fontSize = "12.5px";
  return a;
}

function copyButton(text, label) {
  const b = h("button", "board-btn", label || "Copy");
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

const SKIP_DETAIL = new Set(["id", "t", "title", "name", "co", "role", "pay", "why", "url", "d", "g", "items", "moves"]);

function detailValue(parent, key, val) {
  if (val === null || val === undefined || val === "") return;
  const row = h("div");
  row.style.margin = "4px 0";
  const label = key.startsWith("detail") ? key.slice(6).toLowerCase() : key;
  const strong = h("strong", null, label + ": ");
  strong.style.fontSize = "12.5px";
  row.appendChild(strong);
  if (Array.isArray(val)) {
    const list = h("ul");
    list.style.margin = "2px 0 2px 16px";
    list.style.padding = "0";
    for (const entry of val) {
      const li = h("li", null, typeof entry === "object" ? JSON.stringify(entry) : String(entry));
      li.style.fontSize = "13px";
      li.style.whiteSpace = "pre-wrap";
      list.appendChild(li);
    }
    row.appendChild(list);
  } else if (typeof val === "object") {
    const pre = h("pre", null, JSON.stringify(val, null, 1));
    pre.style.whiteSpace = "pre-wrap";
    pre.style.fontSize = "12.5px";
    pre.style.margin = "2px 0";
    row.appendChild(pre);
  } else {
    const span = h("span", null, String(val));
    span.style.fontSize = "13px";
    span.style.whiteSpace = "pre-wrap";
    row.appendChild(span);
  }
  parent.appendChild(row);
}

/* Expandable detail block. Detail fields (contact data and long text)
   only ever render inside one of these, never in a header or summary. */
function detailsFor(obj, skipExtra) {
  const det = document.createElement("details");
  const sum = h("summary", null, "Details");
  sum.style.cursor = "pointer";
  sum.style.fontSize = "12.5px";
  sum.style.color = "var(--muted)";
  det.appendChild(sum);
  const body = h("div");
  body.style.padding = "4px 0 2px";
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

function cardShell(grid, id, title, sub, opts) {
  const options = opts || {};
  const card = h("section", "board-card");
  if (id) card.id = id;
  if (options.wide) card.style.gridColumn = "1 / -1";
  const head = h("div", "board-card-head");
  const titleWrap = h("div", "board-row board-row-wrap");
  titleWrap.appendChild(h("h3", "board-card-title", title));
  if (options.badge) titleWrap.appendChild(badge(options.badge, options.badgeWarn));
  head.appendChild(titleWrap);
  const right = h("div", "board-row");
  const count = h("span", null, "");
  count.style.fontSize = "12.5px";
  count.style.color = "var(--muted)";
  right.appendChild(count);
  let body = null;
  if (options.collapsible) {
    const toggle = h("button", "board-btn", options.collapsed ? "Show" : "Hide");
    toggle.type = "button";
    toggle.addEventListener("click", () => {
      const hidden = body.style.display === "none";
      body.style.display = hidden ? "" : "none";
      toggle.textContent = hidden ? "Hide" : "Show";
    });
    right.appendChild(toggle);
  }
  head.appendChild(right);
  card.appendChild(head);
  if (sub) card.appendChild(muted(sub));
  body = h("div", "board-card-body");
  if (options.collapsed) body.style.display = "none";
  card.appendChild(body);
  grid.appendChild(card);
  return { card, body, setCount: (txt) => { count.textContent = txt; } };
}

/* ---------- checklist rendering ---------- */

function checklistItem(item, opts) {
  const options = opts || {};
  const li = h("li", "board-list-item");
  const row = h("div", "board-row");
  row.style.alignItems = "flex-start";
  const box = document.createElement("input");
  box.type = "checkbox";
  box.checked = isDone(item);
  box.style.marginTop = "4px";
  box.style.flex = "none";
  box.addEventListener("change", () => {
    setDone(item, box.checked);
    if (typeof options.onToggle === "function") options.onToggle();
  });
  row.appendChild(box);
  const textWrap = h("div");
  textWrap.style.minWidth = "0";
  const label = h("div", null, item.t || item.title || item.name || item.id || "");
  label.style.fontSize = "13.5px";
  textWrap.appendChild(label);
  if (item.body && !options.hideBody) {
    const det = document.createElement("details");
    const sum = h("summary", null, "Notes");
    sum.style.cursor = "pointer";
    sum.style.fontSize = "12.5px";
    sum.style.color = "var(--muted)";
    det.appendChild(sum);
    const pre = h("div", null, item.body);
    pre.style.whiteSpace = "pre-wrap";
    pre.style.fontSize = "13px";
    det.appendChild(pre);
    textWrap.appendChild(det);
  } else {
    const det = detailsFor(item, ["body", "status", "owner", "priority", "checked", "leadId"]);
    if (det) textWrap.appendChild(det);
    else if (item.url) textWrap.appendChild(link(item.url, "Open link"));
  }
  if (item.status || item.owner) {
    const meta = h("div", null, [item.owner, item.status].filter(Boolean).join(", "));
    meta.style.fontSize = "12px";
    meta.style.color = "var(--muted-2)";
    textWrap.appendChild(meta);
  }
  row.appendChild(textWrap);
  li.appendChild(row);
  return li;
}

function checklistGroups(parent, groups, opts) {
  const options = opts || {};
  const allItems = [];
  for (const group of groups) {
    const items = group.items || [];
    for (const it of items) allItems.push(it);
    if (group.g) {
      const head = h("div", "board-row board-row-wrap");
      head.style.margin = "8px 0 4px";
      head.appendChild(h("strong", null, group.g));
      if (group.ownerLabel) head.appendChild(badge(group.ownerLabel));
      const gc = h("span", null, "");
      gc.style.fontSize = "12px";
      gc.style.color = "var(--muted)";
      head.appendChild(gc);
      parent.appendChild(head);
      const updateGroup = () => {
        const done = items.filter((it) => isDone(it)).length;
        gc.textContent = done + " of " + items.length + " done";
      };
      const list = h("ul", "board-list");
      for (const item of items) list.appendChild(checklistItem(item, { onToggle: () => { updateGroup(); if (options.onToggle) options.onToggle(); } }));
      parent.appendChild(list);
      updateGroup();
    } else {
      const list = h("ul", "board-list");
      for (const item of items) list.appendChild(checklistItem(item, { onToggle: options.onToggle }));
      parent.appendChild(list);
    }
  }
  return allItems;
}

function flatChecklist(parent, items, opts) {
  return checklistGroups(parent, [{ g: "", items }], opts);
}

function searchInput(placeholder, onInput) {
  const input = h("input", "board-input");
  input.type = "search";
  input.placeholder = placeholder;
  input.addEventListener("input", () => onInput(input.value.trim().toLowerCase()));
  return input;
}

function chipRow(labels, active, onPick) {
  const row = h("div", "board-row board-row-wrap");
  row.style.margin = "6px 0";
  const buttons = [];
  for (const label of labels) {
    const b = h("button", "board-btn", label);
    b.type = "button";
    if (label === active) {
      b.style.background = "var(--accent)";
      b.style.color = "var(--accent-ink)";
      b.style.borderColor = "var(--accent)";
    }
    b.addEventListener("click", () => onPick(label));
    buttons.push(b);
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
    "The only card that asks Dex to do anything. Bash lane and GPT lane moves, deduped by id.", {});
  const update = () => {
    const done = items.filter((it) => isDone(it)).length;
    shell.setCount(done + " of " + items.length + " done");
  };
  flatChecklist(shell.body, items, { onToggle: update });
  update();
  const formGroup = (GPT.focused || []).find((g) => String(g.g || "").startsWith("Form packets"));
  if (formGroup) {
    const subHead = h("div", null, "Form packets, Bash fills and Dex clicks");
    subHead.style.fontWeight = "700";
    subHead.style.margin = "10px 0 4px";
    shell.body.appendChild(subHead);
    const subItems = formGroup.items || [];
    flatChecklist(shell.body, subItems, { onToggle: update });
    shell.setCount(items.filter((it) => isDone(it)).length + subItems.filter((it) => isDone(it)).length +
      " of " + (items.length + subItems.length) + " done");
  }
}

function buildTodayWeek(grid) {
  const shell = cardShell(grid, "work-today", "Today and This Week",
    "Daily loop, this week, and the set up once list. Week items can be added and removed here.", {});
  shell.body.appendChild(h("strong", null, "Today"));
  flatChecklist(shell.body, FRONT.daily || []);
  const weekHead = h("div", null, "This Week");
  weekHead.style.fontWeight = "700";
  weekHead.style.margin = "10px 0 4px";
  shell.body.appendChild(weekHead);
  const weekList = h("ul", "board-list");
  shell.body.appendChild(weekList);
  const renderWeek = () => {
    weekList.replaceChildren();
    const seed = (FRONT.week || []).filter((w) => !state.weekRemoved.includes(w.id));
    const all = [...seed, ...state.weekAdded];
    for (const item of all) {
      const li = checklistItem(item, {});
      const remove = h("button", "board-btn", "Remove");
      remove.type = "button";
      remove.addEventListener("click", () => {
        if (String(item.id).startsWith("w")) state.weekRemoved.push(item.id);
        state.weekAdded = state.weekAdded.filter((x) => x.id !== item.id);
        saveState();
        renderWeek();
      });
      li.appendChild(remove);
      if (item.hot) li.appendChild(badge("Time sensitive", true));
      weekList.appendChild(li);
    }
    if (!all.length) weekList.appendChild(h("li", "board-empty", "No week items. Add one below."));
  };
  renderWeek();
  const addRow = h("div", "board-row");
  addRow.style.marginTop = "6px";
  const addInput = h("input", "board-input");
  addInput.placeholder = "Add a week item";
  const addBtn = h("button", "board-btn", "Add");
  addBtn.type = "button";
  addBtn.addEventListener("click", () => {
    const text = addInput.value.trim();
    if (!text) return;
    state.weekAdded.push({ id: "wk" + Date.now(), t: text });
    addInput.value = "";
    saveState();
    renderWeek();
  });
  addRow.appendChild(addInput);
  addRow.appendChild(addBtn);
  shell.body.appendChild(addRow);
  const startHead = h("div", null, "Set up once");
  startHead.style.fontWeight = "700";
  startHead.style.margin = "10px 0 4px";
  shell.body.appendChild(startHead);
  flatChecklist(shell.body, FRONT.start || []);
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
  const row = h("div", "board-row");
  row.style.marginTop = "6px";
  row.appendChild(copyButton(area.value, "Copy one liner"));
  shell.body.appendChild(row);
  const det = document.createElement("details");
  const sum = h("summary", null, "Creative native framing");
  sum.style.cursor = "pointer";
  sum.style.fontSize = "12.5px";
  sum.style.color = "var(--muted)";
  det.appendChild(sum);
  const framing = h("div", null, FRONT.creativeNativeFraming || "");
  framing.style.whiteSpace = "pre-wrap";
  framing.style.fontSize = "13px";
  det.appendChild(framing);
  shell.body.appendChild(det);
}

function buildStateAndLanes(grid) {
  const shell = cardShell(grid, "work-state", "State and Lanes",
    "Ticks and edits on this tab save to the board work Firestore doc. The old app live Redis state record could not be read from the board, see the Lane 6 summary, so ticks made in the old app after October are not shown here.", {});
  for (const lane of FRONT.laneStatus || []) {
    const row = h("div", "board-row board-row-wrap");
    row.style.margin = "4px 0";
    row.appendChild(h("strong", null, lane.name));
    row.appendChild(badge(lane.cadence, lane.cadence === "paused"));
    shell.body.appendChild(row);
    shell.body.appendChild(muted(lane.note));
  }
}

/* ---------- money cards: counts and tables only, no amounts in headers ---------- */

function buildTotals(grid) {
  const ob = GPT_AUDIT.outbound || {};
  const g = ob.gpt || {};
  const shell = cardShell(grid, "work-totals", "Totals and Send Audit",
    "Counts only in the header. The register and the day by day log sit inside, collapsed. Totals log last row is 2026-11-06, so these counts are not a current ledger.", { wide: true, collapsible: true, collapsed: true });
  const counts = h("div", "board-row board-row-wrap");
  const parts = [
    "Email records " + (ob.emailRecords || []).length,
    "Form records " + (ob.formRecords || []).length,
    "Cold sends " + (g.cold || 0),
    "Focused sends " + (g.focused || 0),
    "Email applications " + (g.applicationEmails || 0),
    "Bounced " + (g.bounced || 0),
  ];
  for (const part of parts) counts.appendChild(badge(part));
  shell.body.appendChild(counts);
  if (ob.notes) shell.body.appendChild(muted(ob.notes));
  const logHead = h("div", null, "Day by day log");
  logHead.style.fontWeight = "700";
  logHead.style.margin = "10px 0 4px";
  shell.body.appendChild(logHead);
  const logList = h("ul", "board-list");
  for (const row of FRONT.totalsLog || []) {
    const li = h("li", "board-list-item");
    li.appendChild(h("div", null, row.d + ", sent " + (row.sent || 0) + ", apps " + (row.apps || 0)));
    const det = detailsFor(row, ["d", "sent", "apps"]);
    if (det) li.appendChild(det);
    logList.appendChild(li);
  }
  shell.body.appendChild(logList);
  const regHead = h("div", null, "Send and submission register");
  regHead.style.fontWeight = "700";
  regHead.style.margin = "10px 0 4px";
  shell.body.appendChild(regHead);
  const records = [...(ob.emailRecords || []), ...(ob.formRecords || [])];
  const list = h("ul", "board-list");
  let shown = 150;
  let query = "";
  const renderRegister = () => {
    list.replaceChildren();
    const filtered = records.filter((r) => !query || JSON.stringify(r).toLowerCase().includes(query));
    for (const r of filtered.slice(0, shown)) {
      const li = h("li", "board-list-item");
      li.appendChild(h("div", null, [r.company, r.status, r.date].filter(Boolean).join(", ")));
      const det = detailsFor(r, ["company", "status", "date"]);
      if (det) li.appendChild(det);
      list.appendChild(li);
    }
    shell.setCount(filtered.length + " records");
  };
  shell.body.appendChild(searchInput("Search the register", (q) => { query = q; shown = 150; renderRegister(); }));
  shell.body.appendChild(list);
  const more = h("button", "board-btn", "Show more");
  more.type = "button";
  more.addEventListener("click", () => { shown += 150; renderRegister(); });
  shell.body.appendChild(more);
  renderRegister();

  const cash = cardShell(grid, "work-cash", "Cash Board and Log",
    "The old app cash board lives only in its live Redis state record, which the board cannot read, so no figures were imported. This log is the board own, stored in the board work doc.", {});
  const cashList = h("ul", "board-list");
  const renderCash = () => {
    cashList.replaceChildren();
    if (!state.cashLog.length) cashList.appendChild(h("li", "board-empty", "No entries yet."));
    for (const entry of state.cashLog) {
      cashList.appendChild(h("li", "board-list-item", (entry.date || "") + ", " + (entry.text || "")));
    }
  };
  renderCash();
  cash.body.appendChild(cashList);
  const cashRow = h("div", "board-row");
  cashRow.style.marginTop = "6px";
  const cashInput = h("input", "board-input");
  cashInput.placeholder = "Log entry text";
  const cashBtn = h("button", "board-btn", "Add entry");
  cashBtn.type = "button";
  cashBtn.addEventListener("click", () => {
    const text = cashInput.value.trim();
    if (!text) return;
    state.cashLog.push({ date: new Date().toISOString().slice(0, 10), text });
    cashInput.value = "";
    saveState();
    renderCash();
  });
  cashRow.appendChild(cashInput);
  cashRow.appendChild(cashBtn);
  cash.body.appendChild(cashRow);
}

function buildLadder(grid) {
  const shell = cardShell(grid, "work-ladder", "Quick Cash Ladder",
    "Moves grouped by level. Pay, speed and where sit on each row, the how sits in the details.", { collapsible: true, collapsed: true });
  for (const level of QUICKCASH.ladder || []) {
    const head = h("div", null, (level.title || "") + ", aim " + (level.aim || ""));
    head.style.fontWeight = "700";
    head.style.margin = "8px 0 4px";
    shell.body.appendChild(head);
    const items = (level.moves || []).map((m) => ({
      id: m.id,
      t: [m.t, m.pay, m.speed].filter(Boolean).join(", "),
      how: m.how,
      where: m.where,
    }));
    const list = h("ul", "board-list");
    for (const item of items) {
      const li = checklistItem({ id: item.id, t: item.t }, {});
      const det = detailsFor(item, ["t"]);
      if (det) li.appendChild(det);
      list.appendChild(li);
    }
    shell.body.appendChild(list);
  }
}

/* ---------- pipeline ---------- */

function buildPipeline(grid) {
  const companies = PIPELINE.companies || [];
  const shell = cardShell(grid, "work-pipeline", "Applications Pipeline",
    "Public and private pipeline merged and deduped by id. One searchable table card, not one card per company. Checked dates are October snapshots.",
    { wide: true });
  shell.setCount(companies.length + " records, " + PIPELINE.publicCount + " public and " + PIPELINE.privateCount + " private");
  let query = "";
  let pillar = "All";
  let view = "All";
  let shown = 120;
  const pillars = ["All", ...new Set(companies.map((c) => c.pillar).filter(Boolean))];
  const list = h("ul", "board-list");
  const render = () => {
    list.replaceChildren();
    const filtered = companies.filter((c) => {
      if (pillar !== "All" && c.pillar !== pillar) return false;
      if (view === "Done" && !isDone(c)) return false;
      if (view === "Active" && isDone(c)) return false;
      if (query && !(String(c.co || "") + " " + String(c.role || "") + " " + String(c.why || "")).toLowerCase().includes(query)) return false;
      return true;
    });
    for (const c of filtered.slice(0, shown)) {
      const li = h("li", "board-list-item");
      const row = h("div", "board-row");
      row.style.alignItems = "flex-start";
      const box = document.createElement("input");
      box.type = "checkbox";
      box.checked = isDone(c);
      box.style.marginTop = "4px";
      box.style.flex = "none";
      box.addEventListener("change", () => { setDone(c, box.checked); });
      row.appendChild(box);
      const wrap = h("div");
      wrap.style.minWidth = "0";
      wrap.appendChild(h("strong", null, c.co || ""));
      const meta = h("div", null, [c.role, c.pay, c.pillar, c.kind, c.listing].filter(Boolean).join(", "));
      meta.style.fontSize = "12.5px";
      meta.style.color = "var(--muted)";
      wrap.appendChild(meta);
      if (c.why) {
        const why = h("div", null, c.why);
        why.style.fontSize = "13px";
        wrap.appendChild(why);
      }
      if (c.url) wrap.appendChild(link(c.url, "Listing"));
      row.appendChild(wrap);
      li.appendChild(row);
      list.appendChild(li);
    }
    if (!filtered.length) list.appendChild(h("li", "board-empty", "No records match."));
    shell.setCount(filtered.length + " of " + companies.length + " records shown");
  };
  shell.body.appendChild(searchInput("Search company, role or reason", (q) => { query = q; shown = 120; render(); }));
  const pillarSelect = h("select", "board-select");
  for (const p of pillars) {
    const opt = h("option", null, p);
    opt.value = p;
    pillarSelect.appendChild(opt);
  }
  pillarSelect.addEventListener("change", () => { pillar = pillarSelect.value; shown = 120; render(); });
  shell.body.appendChild(pillarSelect);
  shell.body.appendChild(chipRow(["All", "Active", "Done"], view, (picked) => {
    view = picked;
    shown = 120;
    render();
  }));
  shell.body.appendChild(list);
  const more = h("button", "board-btn", "Show more");
  more.type = "button";
  more.addEventListener("click", () => { shown += 120; render(); });
  shell.body.appendChild(more);
  render();
}

function buildWatchlist(grid) {
  const shell = cardShell(grid, "work-watchlist", "Watchlist",
    "Company names only. No per company detail exists in the source.", { collapsible: true, collapsed: true });
  shell.setCount((PIPELINE.watchlist || []).length + " names");
  const wrap = h("div");
  wrap.style.columnCount = "3";
  wrap.style.fontSize = "13px";
  for (const name of PIPELINE.watchlist || []) wrap.appendChild(h("div", null, name));
  shell.body.appendChild(wrap);
}

function buildQuickChannels(grid) {
  const shell = cardShell(grid, "work-quick-channels", "Quick Cash Channels",
    "Channels with timing, reason and link.", { collapsible: true, collapsed: true });
  shell.setCount((QUICKCASH.quick || []).length + " channels");
  const list = h("ul", "board-list");
  for (const c of QUICKCASH.quick || []) {
    const li = h("li", "board-list-item");
    li.appendChild(h("strong", null, c.co || ""));
    const meta = h("div", null, [c.role, c.pay].filter(Boolean).join(", "));
    meta.style.fontSize = "12.5px";
    meta.style.color = "var(--muted)";
    li.appendChild(meta);
    if (c.why) li.appendChild(h("div", null, c.why));
    if (c.url) li.appendChild(link(c.url, "Channel"));
    list.appendChild(li);
  }
  shell.body.appendChild(list);
}

/* ---------- board lane cards ---------- */

function isBuildGroup(group) {
  return String(group.g || "").startsWith("BUILD");
}

function buildFocused(grid) {
  const shell = cardShell(grid, "work-focused", "Focused Outreach",
    "GPT focused groups and Bash focused groups in one checklist, owner labelled. The form packets group lives in Dex Actions, and the BUILD group has its own card, so no group is editable in two places.", { wide: true, collapsible: true, collapsed: true });
  const groups = [];
  for (const g of GPT.focused || []) {
    if (String(g.g || "").startsWith("Form packets")) continue;
    groups.push({ g: g.g, items: g.items || [], ownerLabel: "GPT" });
  }
  for (const g of BASH.focused || []) {
    if (isBuildGroup(g)) continue;
    groups.push({ g: g.g, items: g.items || [], ownerLabel: "Bash" });
  }
  const all = checklistGroups(shell.body, groups, {});
  shell.setCount(all.length + " items");
}

function buildCold(grid) {
  const pause = GPT.executionPause || {};
  const shell = cardShell(grid, "work-cold", "Cold Outreach",
    "Bash cold groups. Cold outreach is paused: " + (pause.scope || "recorded as paused in the source data."),
    { collapsible: true, collapsed: true, badge: "Paused", badgeWarn: true });
  const all = checklistGroups(shell.body, (BASH.cold || []).map((g) => ({ g: g.g, items: g.items || [], ownerLabel: "Bash" })), {});
  shell.setCount(all.length + " items");
}

function buildBashCard(grid) {
  const shell = cardShell(grid, "work-bash", "Bash Lane",
    "Email outreach, marketplaces, agencies, inventory and recruiting. The Bash groups render once, in the Focused, Cold and BUILD cards, so ticks never fork. This card is the lane index.", {});
  const totals = BASH.totals || {};
  if (totals.coldSent !== undefined) shell.body.appendChild(muted("Cold sent, per the source file defaults: " + totals.coldSent));
  const rows = [
    ["Dex moves", (BASH.dex || []).length, "work-dex-actions"],
    ["Cold groups", (BASH.cold || []).reduce((n, g) => n + (g.items || []).length, 0), "work-cold"],
    ["Focused groups", (BASH.focused || []).filter((g) => !isBuildGroup(g)).reduce((n, g) => n + (g.items || []).length, 0), "work-focused"],
    ["BUILD group", (BASH.focused || []).filter(isBuildGroup).reduce((n, g) => n + (g.items || []).length, 0), "work-build"],
  ];
  for (const [label, count, target] of rows) {
    const row = h("div", "board-row board-row-wrap");
    row.style.margin = "4px 0";
    row.appendChild(h("span", null, label + ": " + count + " items"));
    const jump = h("button", "board-btn", "Open card");
    jump.type = "button";
    jump.addEventListener("click", () => {
      const targetEl = document.getElementById(target);
      if (targetEl) targetEl.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    row.appendChild(jump);
    shell.body.appendChild(row);
  }
}

function leadRow(lead) {
  const li = h("li", "board-list-item");
  li.appendChild(h("strong", null, lead.co || lead.name || ""));
  const meta = h("div", null, [lead.role, lead.pay, lead.status, lead.lane, lead.checked].filter(Boolean).join(", "));
  meta.style.fontSize = "12.5px";
  meta.style.color = "var(--muted)";
  li.appendChild(meta);
  if (lead.why) {
    const why = h("div", null, lead.why);
    why.style.fontSize = "13px";
    li.appendChild(why);
  }
  const det = detailsFor(lead, ["why"]);
  if (det) li.appendChild(det);
  return li;
}

function buildGptCard(grid) {
  const shell = cardShell(grid, "work-gpt", "GPT Lane",
    "Checked " + (GPT.checked || "2026-10-12") + ". Nothing in this lane postdates October 23, 2026. Dex moves live in Dex Actions and focused groups live in Focused Outreach, so this card carries the leads, the gate and rules, the history and the audits.",
    { wide: true, collapsible: true, collapsed: true });
  const tabs = ["Migrated leads", "Gate and rules", "History and review", "Audits", "Blocked and owned"];
  const pane = h("div");
  let active = tabs[0];
  const renderPane = () => {
    pane.replaceChildren();
    if (active === "Migrated leads") {
      const leads = GPT_LEADS.migrated || [];
      let query = "";
      let shown = 100;
      const list = h("ul", "board-list");
      const renderLeads = () => {
        list.replaceChildren();
        const filtered = leads.filter((l) => !query || JSON.stringify(l).toLowerCase().includes(query));
        for (const lead of filtered.slice(0, shown)) list.appendChild(leadRow(lead));
        if (!filtered.length) list.appendChild(h("li", "board-empty", "No leads match."));
        shell.setCount(filtered.length + " of " + leads.length + " migrated leads");
      };
      pane.appendChild(searchInput("Search migrated leads", (q) => { query = q; shown = 100; renderLeads(); }));
      pane.appendChild(list);
      const more = h("button", "board-btn", "Show more");
      more.type = "button";
      more.addEventListener("click", () => { shown += 100; renderLeads(); });
      pane.appendChild(more);
      renderLeads();
    } else if (active === "Gate and rules") {
      pane.appendChild(h("strong", null, "Pay and quality gate"));
      const gateList = h("ul");
      for (const line of GPT.gate || []) gateList.appendChild(h("li", null, typeof line === "string" ? line : JSON.stringify(line)));
      pane.appendChild(gateList);
      pane.appendChild(h("strong", null, "Drafting rules"));
      const ruleList = h("ul");
      for (const line of GPT.rules || []) ruleList.appendChild(h("li", null, typeof line === "string" ? line : JSON.stringify(line)));
      pane.appendChild(ruleList);
      shell.setCount("");
    } else if (active === "History and review") {
      const hist = GPT.history || {};
      const rev = GPT.review || {};
      pane.appendChild(muted("History is the per lead default state store, " + Object.keys(hist).length + " records. Review overrides, " + Object.keys(rev).length + " records. Search by lead id."));
      let query = "";
      const list = h("ul", "board-list");
      const renderHist = () => {
        list.replaceChildren();
        const entries = Object.entries(hist).filter(([id]) => !query || id.includes(query));
        for (const [id, val] of entries.slice(0, 150)) {
          const li = h("li", "board-list-item", id + ", " + (val.status || "") + (val.d ? ", done" : ""));
          if (rev[id]) {
            const det = detailsFor(rev[id], []);
            if (det) li.appendChild(det);
          }
          list.appendChild(li);
        }
        shell.setCount(entries.length + " history records");
      };
      pane.appendChild(searchInput("Search history by lead id", (q) => { query = q; renderHist(); }));
      pane.appendChild(list);
      renderHist();
    } else if (active === "Audits") {
      pane.appendChild(muted("Dated reconciliation audits, carried as summaries. The long disposition lists stay in the source repo. The full send register sits in the Totals and Send Audit card."));
      for (const [key, val] of Object.entries(GPT_AUDIT.audits || {})) {
        const det = document.createElement("details");
        const sum = h("summary", null, key);
        sum.style.cursor = "pointer";
        det.appendChild(sum);
        const pre = h("pre", null, JSON.stringify(val, null, 1));
        pre.style.whiteSpace = "pre-wrap";
        pre.style.fontSize = "12.5px";
        det.appendChild(pre);
        pane.appendChild(det);
      }
      shell.setCount(Object.keys(GPT_AUDIT.audits || {}).length + " audit summaries");
    } else {
      pane.appendChild(h("strong", null, "Blocked leads"));
      const bl = h("ul", "board-list");
      for (const b of GPT.blocked || []) bl.appendChild(leadRow(b));
      pane.appendChild(bl);
      pane.appendChild(h("strong", null, "Archives"));
      const ar = h("ul", "board-list");
      for (const b of GPT.archives || []) ar.appendChild(leadRow(b));
      pane.appendChild(ar);
      const ownedHead = h("div", null, "Owned by Bash, GPT must not touch: " + (GPT.ownedByBash || []).length + " companies");
      ownedHead.style.fontWeight = "700";
      ownedHead.style.margin = "8px 0 4px";
      pane.appendChild(ownedHead);
      const wrap = h("div");
      wrap.style.columnCount = "3";
      wrap.style.fontSize = "13px";
      for (const name of GPT.ownedByBash || []) wrap.appendChild(h("div", null, name));
      pane.appendChild(wrap);
      shell.setCount("");
    }
  };
  const tabHost = h("div");
  const renderTabs = () => {
    tabHost.replaceChildren();
    tabHost.appendChild(chipRow(tabs, active, (picked) => { active = picked; renderTabs(); renderPane(); }));
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
    const all = flatChecklist(shell.body, group.items || [], {});
    shell.setCount(all.length + " offers");
  }
}

function buildMoonCheats(grid) {
  const moon = cardShell(grid, "work-moon", "Moonshots",
    "Deliberately large asks and giant listings.", { collapsible: true, collapsed: true });
  const moonItems = checklistGroups(moon.body, MOON.moon || [], {});
  moon.setCount(moonItems.length + " items");
  const cheats = cardShell(grid, "work-cheats", "Cheat Codes",
    "Systems, not jobs, grouped by tier.", { collapsible: true, collapsed: true });
  const cheatItems = checklistGroups(cheats.body, MOON.cheats || [], {});
  cheats.setCount(cheatItems.length + " items");
}

/* ---------- opportunity, funding and client cards ---------- */

function buildClients(grid) {
  const shell = cardShell(grid, "work-clients", "Clients in Progress",
    "Contact data and the negotiation history render only inside the detail block. Status and notes save to the board work doc.", { wide: true });
  const clients = CLIENTS.clients || [];
  shell.setCount(clients.length + (clients.length === 1 ? " client" : " clients"));
  for (const client of clients) {
    const li = h("div", "board-list-item");
    li.appendChild(h("strong", null, client.co || client.id || "Client"));
    const row = h("div", "board-row board-row-wrap");
    row.style.margin = "6px 0";
    const select = h("select", "board-select");
    select.style.width = "auto";
    for (const status of ["In Progress", "Completed", "Cancelled"]) {
      const opt = h("option", null, status);
      opt.value = status;
      select.appendChild(opt);
    }
    select.value = state.clientStatus[client.id] || "In Progress";
    select.addEventListener("change", () => {
      state.clientStatus[client.id] = select.value;
      saveState();
    });
    row.appendChild(select);
    li.appendChild(row);
    const det = detailsFor(client, ["co"]);
    if (det) {
      det.open = false;
      li.appendChild(det);
    }
    const notes = h("textarea", "board-textarea");
    notes.rows = 2;
    notes.placeholder = "Client notes";
    notes.value = state.clientNotes[client.id] || "";
    notes.addEventListener("input", () => {
      state.clientNotes[client.id] = notes.value;
      saveState();
    });
    li.appendChild(notes);
    shell.body.appendChild(li);
  }
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

function buildBackers(grid) {
  const shell = cardShell(grid, "work-backers", "Backers and Funding",
    BACKERS.stalenessNote || "", { wide: true, collapsible: true, collapsed: true });
  const backers = BACKERS.backers || [];
  const rulingWrap = h("div");
  for (const ruling of BACKERS.rulings || []) {
    const row = h("div", "board-row board-row-wrap");
    row.style.margin = "3px 0";
    row.appendChild(h("strong", null, ruling.name));
    row.appendChild(badge(ruling.status));
    rulingWrap.appendChild(row);
    rulingWrap.appendChild(muted(ruling.note));
  }
  shell.body.appendChild(rulingWrap);
  const filters = ["All", "Grants", "Funds", "Accelerators", "Publishers", "Loans and debt", "Credits not cash", "Angels", "Submitted", "Closed", "Do not pay", "Contested"];
  let active = "All";
  let query = "";
  const list = h("ul", "board-list");
  const render = () => {
    list.replaceChildren();
    const filtered = backers.filter((b) => {
      if (active !== "All" && backerCategory(b) !== active) return false;
      if (query && !(String(b.name || "") + " " + String(b.type || "")).toLowerCase().includes(query)) return false;
      return true;
    });
    for (const b of filtered) {
      const li = h("li", "board-list-item");
      const row = h("div", "board-row");
      row.style.alignItems = "flex-start";
      const box = document.createElement("input");
      box.type = "checkbox";
      box.checked = !!state.backerDone[b.id];
      box.style.marginTop = "4px";
      box.style.flex = "none";
      box.title = "Pursued or done";
      box.addEventListener("change", () => {
        state.backerDone[b.id] = box.checked;
        saveState();
      });
      row.appendChild(box);
      const wrap = h("div");
      wrap.style.minWidth = "0";
      const headRow = h("div", "board-row board-row-wrap");
      headRow.appendChild(h("strong", null, b.name || ""));
      if (b.ruling) headRow.appendChild(badge(b.ruling));
      if (backerCategory(b) === "Do not pay") headRow.appendChild(badge("Do not pay", true));
      if (backerCategory(b) === "Contested") headRow.appendChild(badge("Contested, recheck before use", true));
      wrap.appendChild(headRow);
      const meta = h("div", null, [b.type, b.amount].filter(Boolean).join(", "));
      meta.style.fontSize = "12.5px";
      meta.style.color = "var(--muted)";
      wrap.appendChild(meta);
      const det = detailsFor(b, ["name", "type", "amount", "ruling"]);
      if (det) wrap.appendChild(det);
      row.appendChild(wrap);
      li.appendChild(row);
      list.appendChild(li);
    }
    if (!filtered.length) list.appendChild(h("li", "board-empty", "No backers match this filter."));
    shell.setCount(filtered.length + " of " + backers.length + " entries");
  };
  shell.body.appendChild(searchInput("Search backers", (q) => { query = q; render(); }));
  const chipHost = h("div");
  const renderChips = () => {
    chipHost.replaceChildren();
    chipHost.appendChild(chipRow(filters, active, (picked) => { active = picked; renderChips(); render(); }));
  };
  renderChips();
  shell.body.appendChild(chipHost);
  shell.body.appendChild(list);
  render();
}

function buildWebDesign(grid) {
  const shell = cardShell(grid, "work-webdesign", "Web Design Lane",
    "Grouped by wave. Status label on every row. Contact routes render only inside detail blocks. Killed rows are hidden until the toggle is on.", { wide: true, collapsible: true, collapsed: true });
  const entries = WEBDESIGN.webdesign || [];
  let showKilled = false;
  const toggleRow = h("div", "board-row");
  const toggle = document.createElement("input");
  toggle.type = "checkbox";
  toggle.addEventListener("change", () => { showKilled = toggle.checked; render(); });
  toggleRow.appendChild(toggle);
  toggleRow.appendChild(h("span", null, "Show killed"));
  shell.body.appendChild(toggleRow);
  const host = h("div");
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
      const head = h("div", null, wave + " wave");
      head.style.fontWeight = "700";
      head.style.margin = "8px 0 4px";
      host.appendChild(head);
      const list = h("ul", "board-list");
      for (const entry of waves[wave]) {
        total++;
        const li = h("li", "board-list-item");
        const headRow = h("div", "board-row board-row-wrap");
        headRow.appendChild(h("strong", null, entry.name || ""));
        headRow.appendChild(badge(String(entry.type || "").split(", ").pop() || entry.type || ""));
        li.appendChild(headRow);
        if (entry.amount) {
          const amt = h("div", null, entry.amount);
          amt.style.fontSize = "12.5px";
          amt.style.color = "var(--muted)";
          li.appendChild(amt);
        }
        const det = detailsFor(entry, ["name", "type", "amount"]);
        if (det) li.appendChild(det);
        list.appendChild(li);
      }
      host.appendChild(list);
    }
    shell.setCount(total + " of " + entries.length + " entries shown");
  };
  render();
}

function buildStartups(grid) {
  const s = GPT_OPPS.startups || {};
  const shell = cardShell(grid, "work-startups", "Startups Cohort",
    "GPT startup outreach cohort, started 2026-10-13. Contact addresses render only inside detail blocks.", { wide: true, collapsible: true, collapsed: true });
  const flags = h("div", "board-row board-row-wrap");
  if (s.active === false) flags.appendChild(badge("Not active", true));
  if (s.noSending) flags.appendChild(badge("No sending", true));
  if (s.noDrafts) flags.appendChild(badge("No drafts", true));
  if (s.requiresExactTextApproval) flags.appendChild(badge("Exact text approval required", true));
  if (s.status) flags.appendChild(badge("Status: " + s.status));
  shell.body.appendChild(flags);
  if (s.outreachNotice) shell.body.appendChild(muted(s.outreachNotice));
  const buckets = [
    ["Contact ready", s.contactReady || []],
    ["Backlog", s.backlog || []],
    ["Rejected", s.rejected || []],
    ["Pass log", s.passLog || []],
    ["Dead", s.dead || []],
  ];
  let active = "Contact ready";
  const host = h("div");
  const chipHost = h("div");
  const renderBucket = () => {
    host.replaceChildren();
    const bucket = buckets.find(([label]) => label === active);
    const rows = bucket ? bucket[1] : [];
    const list = h("ul", "board-list");
    for (const r of rows.slice(0, 200)) {
      const li = h("li", "board-list-item");
      li.appendChild(h("strong", null, r.name || r.id || ""));
      const meta = h("div", null, [r.tier, r.status, r.stage, r.location].filter(Boolean).join(", "));
      meta.style.fontSize = "12.5px";
      meta.style.color = "var(--muted)";
      li.appendChild(meta);
      const det = detailsFor(r, ["name", "tier", "status", "stage", "location"]);
      if (det) li.appendChild(det);
      list.appendChild(li);
    }
    if (!rows.length) list.appendChild(h("li", "board-empty", "Nothing in this bucket."));
    host.appendChild(list);
    shell.setCount(rows.length + " in " + active.toLowerCase());
  };
  const renderChips = () => {
    chipHost.replaceChildren();
    chipHost.appendChild(chipRow(buckets.map(([label]) => label), active, (picked) => {
      active = picked;
      renderChips();
      renderBucket();
    }));
  };
  renderChips();
  shell.body.appendChild(chipHost);
  shell.body.appendChild(host);
  renderBucket();
}

function buildFastCoin(grid) {
  const fc = GPT_OPPS.fastCoin || {};
  const shell = cardShell(grid, "work-fastcoin", "Fast Coin",
    "Started " + (fc.started || "") + ". Checkpoint " + (fc.checkpoint || "") + " has passed. Status: " + (fc.status || "") + ". Target: " + (fc.target || "") + ".",
    { collapsible: true, collapsed: true, badge: fc.status === "paused" ? "Paused" : "", badgeWarn: fc.status === "paused" });
  if (fc.pauseNote) shell.body.appendChild(muted(fc.pauseNote));
  shell.body.appendChild(h("strong", null, "Do first"));
  const doFirst = (fc.doFirst || []).map((d) => ({ id: d.id || d.name, t: d.name || d.t, body: d.nextAction || "" }));
  flatChecklist(shell.body, doFirst, {});
  const leadsHead = h("div", null, "Leads");
  leadsHead.style.fontWeight = "700";
  leadsHead.style.margin = "8px 0 4px";
  shell.body.appendChild(leadsHead);
  const list = h("ul", "board-list");
  for (const lead of fc.leads || []) list.appendChild(leadRow(lead));
  shell.body.appendChild(list);
  const deadDet = document.createElement("details");
  const deadSum = h("summary", null, "Dead, " + (fc.dead || []).length);
  deadSum.style.cursor = "pointer";
  deadDet.appendChild(deadSum);
  const deadList = h("ul", "board-list");
  for (const d of fc.dead || []) deadList.appendChild(leadRow(d));
  deadDet.appendChild(deadList);
  shell.body.appendChild(deadDet);
  const passDet = document.createElement("details");
  const passSum = h("summary", null, "Pass log, " + (fc.passes || []).length);
  passSum.style.cursor = "pointer";
  passDet.appendChild(passSum);
  const passPre = h("pre", null, JSON.stringify(fc.passes || [], null, 1));
  passPre.style.whiteSpace = "pre-wrap";
  passPre.style.fontSize = "12.5px";
  passDet.appendChild(passPre);
  shell.body.appendChild(passDet);
  if (fc.wrapUpNote) shell.body.appendChild(muted(fc.wrapUpNote));
  shell.setCount((fc.leads || []).length + " leads");
}

function platformCard(grid, id, title, coll, extra) {
  const shell = cardShell(grid, id, title,
    (coll.label || coll.title || "") + (coll.date ? ", " + coll.date : "") + ". Research collection, not a queue.",
    { collapsible: true, collapsed: true });
  const companies = coll.companies || coll.records || [];
  if (Array.isArray(coll.topTen) && coll.topTen.length) {
    shell.body.appendChild(h("strong", null, "Top ten first"));
    const top = h("ol");
    for (const entry of coll.topTen) {
      top.appendChild(h("li", null, typeof entry === "string" ? entry : (entry.name || entry.title || JSON.stringify(entry))));
    }
    shell.body.appendChild(top);
  }
  let showAll = false;
  const list = h("ul", "board-list");
  const render = () => {
    list.replaceChildren();
    const rows = showAll ? companies : companies.slice(0, 15);
    for (const c of rows) list.appendChild(leadRow(c));
    shell.setCount(companies.length + " companies");
  };
  shell.body.appendChild(list);
  const toggle = h("button", "board-btn", "Show all");
  toggle.type = "button";
  toggle.addEventListener("click", () => {
    showAll = !showAll;
    toggle.textContent = showAll ? "Show top slice" : "Show all";
    render();
  });
  shell.body.appendChild(toggle);
  if (extra) extra(shell.body, coll);
  render();
  return shell;
}

function buildPlatforms(grid) {
  platformCard(grid, "work-platforms-opp", "Platform Opportunities", GPT_OPPS.platformOpportunities || {});
  platformCard(grid, "work-platforms-eco", "Platform Ecosystems", GPT_OPPS.platformEcosystems || {});
  platformCard(grid, "work-platforms-vol", "Platform Volume Hunt", GPT_OPPS.platformVolumeHunt || {}, (body, coll) => {
    for (const key of ["protected", "neverContact"]) {
      if (Array.isArray(coll[key]) && coll[key].length) {
        const det = document.createElement("details");
        const sum = h("summary", null, (key === "protected" ? "Protected list" : "Never contact list") + ", " + coll[key].length);
        sum.style.cursor = "pointer";
        sum.style.color = "var(--danger)";
        det.appendChild(sum);
        const wrap = h("div");
        for (const entry of coll[key]) wrap.appendChild(h("div", null, typeof entry === "string" ? entry : JSON.stringify(entry)));
        det.appendChild(wrap);
        body.appendChild(det);
      }
    }
    const wave2 = GPT_OPPS.platformVolumeHuntWave2 || {};
    if (wave2.title) {
      const head = h("div", null, wave2.title);
      head.style.fontWeight = "700";
      head.style.margin = "8px 0 4px";
      body.appendChild(head);
      const list = h("ul", "board-list");
      const records = Array.isArray(wave2.records) ? wave2.records.flatMap((r) => Array.isArray(r.items) ? r.items : [r]) : [];
      for (const r of records) list.appendChild(leadRow(r));
      body.appendChild(list);
    }
  });
}

function buildFundedWave(grid) {
  const fw = GPT_OPPS.fundedWaveOct23 || {};
  const shell = cardShell(grid, "work-funded-wave", "Funded Wave, October 23",
    "Recorded " + (fw.recordedAt || "") + " by " + (fw.recordedBy || "") + ".",
    { collapsible: true, collapsed: true, badge: "Unverified claims", badgeWarn: true });
  if (fw.summary) shell.body.appendChild(muted(fw.summary));
  if (fw.sendRule) shell.body.appendChild(muted("Send rule: " + fw.sendRule));
  const list = h("ul", "board-list");
  for (const c of fw.companies || []) list.appendChild(leadRow(c));
  shell.body.appendChild(list);
  shell.setCount((fw.companies || []).length + " companies");
}

function buildIncome(grid) {
  const asap = INCOME.asap || {};
  const shell = cardShell(grid, "work-income", "Income ASAP",
    "Checked " + (asap.checked || "2026-10-10") + ", the oldest dated research in the app. Urgent small money plan, remote first.",
    { wide: true, collapsible: true, collapsed: true });
  if (asap.summary) shell.body.appendChild(muted(asap.summary));
  shell.body.appendChild(h("strong", null, "Account set up, in sequence"));
  const setup = (asap.accountSetup || []).map((s) => ({ id: s.id, t: s.title, body: s.body || "" }));
  flatChecklist(shell.body, setup, {});
  const profileHead = h("div", null, "Profile copy");
  profileHead.style.fontWeight = "700";
  profileHead.style.margin = "8px 0 4px";
  shell.body.appendChild(profileHead);
  if (asap.profileTitle) shell.body.appendChild(h("div", null, asap.profileTitle));
  const profileText = typeof asap.profileCopy === "string" ? asap.profileCopy : JSON.stringify(asap.profileCopy || "");
  const profile = h("div", null, profileText);
  profile.style.whiteSpace = "pre-wrap";
  profile.style.fontSize = "13px";
  shell.body.appendChild(profile);
  shell.body.appendChild(copyButton(profileText, "Copy profile copy"));
  const leadsHead = h("div", null, "Leads");
  leadsHead.style.fontWeight = "700";
  leadsHead.style.margin = "8px 0 4px";
  shell.body.appendChild(leadsHead);
  const list = h("ul", "board-list");
  for (const lead of asap.leads || []) list.appendChild(leadRow(lead));
  shell.body.appendChild(list);
  for (const section of ["review", "sprint"]) {
    if (asap[section]) {
      const det = document.createElement("details");
      const sum = h("summary", null, section === "review" ? "Portfolio review" : "Sprint");
      sum.style.cursor = "pointer";
      det.appendChild(sum);
      const pre = h("pre", null, typeof asap[section] === "string" ? asap[section] : JSON.stringify(asap[section], null, 1));
      pre.style.whiteSpace = "pre-wrap";
      pre.style.fontSize = "12.5px";
      det.appendChild(pre);
      shell.body.appendChild(det);
    }
  }
  shell.body.appendChild(muted("Exclusion note from the app README: old contests, funding, loans and known stale marketplace examples stay on the original board and are excluded from this urgent list."));
  shell.setCount((asap.leads || []).length + " leads");
}

/* ---------- reference stack and archive ---------- */

function buildGuides(grid) {
  const shell = cardShell(grid, "work-guides", "Guides and Reference",
    "One collapsed card section per guide. Short version first, full text behind the expander. The resume surfaces registry lives in the work repo root as RESUME-SURFACES.md and is linked from the Resume Sync guide, it is not copied here.",
    { wide: true, collapsible: true, collapsed: true });
  shell.setCount((GUIDES.guides || []).length + " guides");
  for (const guide of GUIDES.guides || []) {
    const det = document.createElement("details");
    const sum = h("summary", null, guide.t || "Guide");
    sum.style.cursor = "pointer";
    sum.style.fontWeight = "600";
    det.appendChild(sum);
    const dexText = h("div", null, typeof guide.dex === "string" ? guide.dex : JSON.stringify(guide.dex || ""));
    dexText.style.whiteSpace = "pre-wrap";
    dexText.style.fontSize = "13px";
    det.appendChild(dexText);
    if (guide.ai) {
      const aiDet = document.createElement("details");
      const aiSum = h("summary", null, "Full text");
      aiSum.style.cursor = "pointer";
      aiSum.style.fontSize = "12.5px";
      aiSum.style.color = "var(--muted)";
      aiDet.appendChild(aiSum);
      const aiText = h("div", null, typeof guide.ai === "string" ? guide.ai : JSON.stringify(guide.ai || ""));
      aiText.style.whiteSpace = "pre-wrap";
      aiText.style.fontSize = "13px";
      aiDet.appendChild(aiText);
      det.appendChild(aiDet);
    }
    shell.body.appendChild(det);
  }
  const stratHead = h("div", null, "Strategy and application rules");
  stratHead.style.fontWeight = "700";
  stratHead.style.margin = "10px 0 4px";
  shell.body.appendChild(stratHead);
  const blocks = [
    ["Honesty rules", FRONT.rules],
    ["High volume sending", FRONT.volume],
    ["Long term strategy", FRONT.longterm],
  ];
  for (const [label, obj] of blocks) {
    if (!obj) continue;
    const det = document.createElement("details");
    const sum = h("summary", null, label);
    sum.style.cursor = "pointer";
    det.appendChild(sum);
    const pre = h("pre", null, typeof obj === "string" ? obj : JSON.stringify(obj, null, 1));
    pre.style.whiteSpace = "pre-wrap";
    pre.style.fontSize = "12.5px";
    det.appendChild(pre);
    shell.body.appendChild(det);
  }
  const scriptsHead = h("div", null, "Outreach scripts");
  scriptsHead.style.fontWeight = "700";
  scriptsHead.style.margin = "10px 0 4px";
  shell.body.appendChild(scriptsHead);
  for (const script of FRONT.scripts || []) {
    const row = h("div", "board-row board-row-wrap");
    row.style.margin = "4px 0";
    row.appendChild(h("span", null, script.t || "Script"));
    row.appendChild(copyButton(script.body || "", "Copy script"));
    shell.body.appendChild(row);
  }
}

function buildArchive(grid) {
  const shell = cardShell(grid, "work-archive", "Archive, Local Draft Corpora",
    ARCHIVE.note || "", { collapsible: true, collapsed: true });
  const files = ARCHIVE.files || [];
  shell.setCount(files.length + " files");
  const list = h("ul", "board-list");
  for (const file of files) {
    const li = h("li", "board-list-item");
    li.appendChild(h("strong", null, file.name));
    const meta = h("div", null, Math.round((file.bytes || 0) / 1024) + " KB, " + file.path);
    meta.style.fontSize = "12.5px";
    meta.style.color = "var(--muted)";
    li.appendChild(meta);
    list.appendChild(li);
  }
  shell.body.appendChild(list);
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
  const grid = h("div", "board-grid");
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
}

export function unmount() {
  if (rootEl) rootEl.replaceChildren();
  rootEl = null;
  storeRef = null;
  state = null;
}
