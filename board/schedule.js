/* Dex Board Schedule tab.
   Data lives in the board-schedule doc:
   days: { monday: [{ id, time, text }], tuesday: [...], and so on
     through sunday }
   time is an HH:MM string from a time input, or an empty string.
   recurring: [{ id, when, text }]   free text "when", e.g. Daily, M W F
   deadlines: [{ id, date, text }]   date as YYYY-MM-DD
   The week starts empty apart from the seven day structure. Every
   change saves through the store, and store.listen keeps the tab in
   step with changes from another device. */

const DOC = "board-schedule";
const DAYS = [
  { key: "monday", label: "Monday" },
  { key: "tuesday", label: "Tuesday" },
  { key: "wednesday", label: "Wednesday" },
  { key: "thursday", label: "Thursday" },
  { key: "friday", label: "Friday" },
  { key: "saturday", label: "Saturday" },
  { key: "sunday", label: "Sunday" },
];

let ctxRef = null;
let rootEl = null;
let state = null;
let unlisten = null;
let lastSerialized = "";

function newId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "id-" + Date.now().toString(36) + "-" + Math.floor(Math.random() * 1e9).toString(36);
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

function defaultState() {
  const days = {};
  for (const day of DAYS) days[day.key] = [];
  return { days, recurring: [], deadlines: [] };
}

function normalize(data) {
  const out = defaultState();
  if (!data || typeof data !== "object") return out;
  if (Array.isArray(data.recurring)) {
    out.recurring = data.recurring.filter((e) => e && typeof e === "object")
      .map((e) => ({ id: String(e.id || newId()), when: String(e.when || ""), text: String(e.text || "") }));
  }
  if (Array.isArray(data.deadlines)) {
    out.deadlines = data.deadlines.filter((e) => e && typeof e === "object")
      .map((e) => ({ id: String(e.id || newId()), date: String(e.date || ""), text: String(e.text || "") }));
  }
  if (!data.days || typeof data.days !== "object") return out;
  for (const day of DAYS) {
    const list = data.days[day.key];
    if (!Array.isArray(list)) continue;
    out.days[day.key] = list
      .filter((e) => e && typeof e === "object")
      .map((e) => ({ id: String(e.id || newId()), time: String(e.time || ""), text: String(e.text || "") }));
  }
  return out;
}

function serialize() {
  return JSON.stringify(state);
}

function save() {
  if (!ctxRef || !state) return;
  lastSerialized = serialize();
  ctxRef.store.save(DOC, state);
  announce();
}

function announce() {
  try { window.dispatchEvent(new CustomEvent("board:schedule", { detail: JSON.parse(serialize()) })); } catch (err) { void err; }
}

function removeButton(label, onClick) {
  const b = el("button", "row-x", "×");
  b.type = "button";
  b.setAttribute("aria-label", label);
  b.addEventListener("click", onClick);
  return b;
}

function editableText(value, label, onChange) {
  const span = el("span", "row-text", value);
  span.contentEditable = "plaintext-only";
  if (span.contentEditable !== "plaintext-only") span.contentEditable = "true";
  span.setAttribute("role", "textbox");
  span.setAttribute("aria-label", label);
  span.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); span.blur(); } });
  span.addEventListener("input", () => onChange(span.textContent.replace(/\s+/g, " ").trim()));
  return span;
}

function sortedEntries(dayKey) {
  return state.days[dayKey].slice().sort((a, b) => {
    if (!a.time && !b.time) return 0;
    if (!a.time) return 1;
    if (!b.time) return -1;
    return a.time < b.time ? -1 : a.time > b.time ? 1 : 0;
  });
}

function timeLabel(t) {
  if (!t) return "--:--";
  const [h, m] = t.split(":").map(Number);
  if (!Number.isFinite(h)) return t;
  const hh = ((h + 11) % 12) + 1;
  return hh + ":" + String(m || 0).padStart(2, "0") + (h >= 12 ? "p" : "a");
}

function blockCard(title, pillText, pillKind) {
  const wrap = el("section", "board-card");
  const head = el("div", "board-card-head");
  head.appendChild(el("h3", "board-card-title", title));
  if (pillText) head.appendChild(el("span", "pill" + (pillKind ? " " + pillKind : ""), pillText));
  wrap.appendChild(head);
  const body = el("div", "board-card-body");
  wrap.appendChild(body);
  return { wrap, body };
}

function addForm(first, placeholder, onAdd) {
  const row = el("div", "add-row");
  const text = el("input", "board-input");
  text.type = "text";
  text.placeholder = placeholder;
  text.setAttribute("aria-label", placeholder);
  const add = el("button", "board-btn board-btn-primary", "Add");
  add.type = "button";
  const submit = () => {
    const v = text.value.trim();
    if (!v) { text.focus(); return; }
    onAdd(v);
    save();
    render();
    const again = rootEl && rootEl.querySelector('input[placeholder="' + placeholder + '"]');
    if (again) again.focus();
  };
  add.addEventListener("click", submit);
  text.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
  if (first) row.appendChild(first);
  row.append(text, add);
  return row;
}

function renderDay(day, offset) {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  const title = offset === 0 ? "Today, " + day.label : offset === 1 ? "Tomorrow, " + day.label : day.label;
  const entries = sortedEntries(day.key);
  const c = blockCard(title, offset === 0 ? (entries.length + " planned") : date.toLocaleDateString("en-US", { month: "short", day: "numeric" }), offset === 0 ? "hot" : "");
  if (!entries.length) c.body.appendChild(el("div", "board-empty", "Nothing planned."));
  const list = el("ul", "board-list");
  for (const entry of entries) {
    const item = el("li", "board-list-item");
    item.setAttribute("data-id", entry.id);
    const row = el("div", "board-row");
    const time = el("input", "board-input sched-time");
    time.type = "time";
    time.value = entry.time;
    time.setAttribute("aria-label", "Time");
    time.addEventListener("change", () => { entry.time = time.value || ""; save(); render(); });
    const text = editableText(entry.text, day.label + " entry", (v) => { entry.text = v; save(); });
    row.append(time, text, removeButton("Remove entry", () => {
      state.days[day.key] = state.days[day.key].filter((e) => e.id !== entry.id);
      save();
      render();
    }));
    item.appendChild(row);
    list.appendChild(item);
  }
  c.body.appendChild(list);
  const timeIn = el("input", "board-input sched-time");
  timeIn.type = "time";
  timeIn.setAttribute("aria-label", "New entry time");
  c.body.appendChild(addForm(timeIn, "Add to " + day.label, (text) => {
    state.days[day.key].push({ id: newId(), time: timeIn.value || "", text });
  }));
  return c.wrap;
}

function renderRecurring() {
  const c = blockCard("Recurring", state.recurring.length ? state.recurring.length + " set" : "", "good");
  if (!state.recurring.length) c.body.appendChild(el("div", "board-empty", "Routines that repeat: daily, M W F, weekly."));
  const list = el("ul", "board-list");
  for (const r of state.recurring) {
    const item = el("li", "board-list-item");
    const row = el("div", "board-row");
    const when = editableText(r.when || "When", "When", (v) => { r.when = v; save(); });
    when.classList.add("row-meta", "sched-when");
    when.classList.remove("row-text");
    const text = editableText(r.text, "Recurring item", (v) => { r.text = v; save(); });
    row.append(when, text, removeButton("Remove recurring item", () => {
      state.recurring = state.recurring.filter((x) => x.id !== r.id);
      save();
      render();
    }));
    item.appendChild(row);
    list.appendChild(item);
  }
  c.body.appendChild(list);
  const whenIn = el("input", "board-input sched-when-in");
  whenIn.type = "text";
  whenIn.placeholder = "Daily";
  whenIn.setAttribute("aria-label", "How often");
  c.body.appendChild(addForm(whenIn, "Add a routine", (text) => {
    state.recurring.push({ id: newId(), when: whenIn.value.trim() || "Daily", text });
  }));
  return c.wrap;
}

function renderDeadlines() {
  const sorted = state.deadlines.slice().sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999"));
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const near = sorted.filter((d) => {
    if (!d.date) return false;
    const [y, m, dd] = d.date.split("-").map(Number);
    const n = (new Date(y, m - 1, dd) - today) / 86400000;
    return n >= 0 && n <= 7;
  }).length;
  const c = blockCard("Deadlines", near ? near + " near" : (sorted.length ? sorted.length + " set" : ""), near ? "hot" : "");
  if (!sorted.length) c.body.appendChild(el("div", "board-empty", "Hard dates: renewals, due dates, launches."));
  const list = el("ul", "board-list");
  for (const d of sorted) {
    const item = el("li", "board-list-item");
    const row = el("div", "board-row");
    let label = "No date";
    let hot = false;
    if (d.date) {
      const [y, m, dd] = d.date.split("-").map(Number);
      const date = new Date(y, m - 1, dd);
      label = date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      const n = (date - today) / 86400000;
      hot = n >= 0 && n <= 7;
    }
    const text = editableText(d.text, "Deadline", (v) => { d.text = v; save(); });
    row.append(el("span", "row-meta" + (hot ? " hot" : ""), label), text, removeButton("Remove deadline", () => {
      state.deadlines = state.deadlines.filter((x) => x.id !== d.id);
      save();
      render();
    }));
    item.appendChild(row);
    list.appendChild(item);
  }
  c.body.appendChild(list);
  const dateIn = el("input", "board-input");
  dateIn.type = "date";
  dateIn.setAttribute("aria-label", "Deadline date");
  dateIn.style.flex = "0 1 160px";
  c.body.appendChild(addForm(dateIn, "Add a deadline", (text) => {
    state.deadlines.push({ id: newId(), date: dateIn.value || "", text });
  }));
  return c.wrap;
}

function render() {
  if (!rootEl || !state) return;
  rootEl.replaceChildren();
  const grid = el("div", "board-grid");
  /* Today first, then the rest of the week in order, so the day that matters
     is top left. Monday = 0 in DAYS; getDay() has Sunday = 0. */
  const todayIndex = (new Date().getDay() + 6) % 7;
  for (let i = 0; i < 7; i += 1) {
    const day = DAYS[(todayIndex + i) % 7];
    grid.appendChild(renderDay(day, i));
    if (i === 1) { grid.appendChild(renderRecurring()); grid.appendChild(renderDeadlines()); }
  }
  rootEl.appendChild(grid);
}

export async function mount(container, ctx) {
  ctxRef = ctx;
  rootEl = container;
  container.replaceChildren();
  container.appendChild(el("div", "board-loading-card", "Schedule loading..."));
  let data = null;
  try { data = await ctx.store.load(DOC); } catch (err) { console.warn("board schedule: load failed", err); }
  if (rootEl !== container) return;
  state = normalize(data);
  lastSerialized = serialize();
  render();
  announce();
  if (unlisten) { unlisten(); unlisten = null; }
  unlisten = ctx.store.listen(DOC, (incoming) => {
    if (!incoming) return;
    const next = normalize(incoming);
    const nextSerialized = JSON.stringify(next);
    if (nextSerialized === lastSerialized || nextSerialized === serialize()) return;
    const active = document.activeElement;
    if (active && container.contains(active) && (/INPUT|TEXTAREA|SELECT/.test(active.tagName) || active.isContentEditable)) return;
    state = next;
    lastSerialized = nextSerialized;
    render();
  });
}

export function unmount() {
  if (unlisten) { unlisten(); unlisten = null; }
  ctxRef = null;
  rootEl = null;
  state = null;
  lastSerialized = "";
}
