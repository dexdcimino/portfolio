/* Dex Board Schedule tab.
   Data lives in the board-schedule doc:
   days: { monday: [{ id, time, text }], tuesday: [...], and so on
     through sunday }
   time is an HH:MM string from a time input, or an empty string.
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
  return { days };
}

function normalize(data) {
  const out = defaultState();
  if (!data || typeof data !== "object" || !data.days || typeof data.days !== "object") return out;
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
}

function smallButton(text) {
  const btn = el("button", "board-btn", text);
  btn.type = "button";
  btn.style.padding = "5px 10px";
  btn.style.fontSize = "12.5px";
  return btn;
}

function sortedEntries(dayKey) {
  return state.days[dayKey].slice().sort((a, b) => {
    if (!a.time && !b.time) return 0;
    if (!a.time) return 1;
    if (!b.time) return -1;
    return a.time < b.time ? -1 : a.time > b.time ? 1 : 0;
  });
}

function renderDay(day) {
  const wrap = el("section", "board-card");
  const head = el("div", "board-card-head");
  head.appendChild(el("h3", "board-card-title", day.label));
  wrap.appendChild(head);
  const body = el("div", "board-card-body");
  wrap.appendChild(body);

  const entries = sortedEntries(day.key);
  if (!entries.length) {
    body.appendChild(el("div", "board-empty", "Nothing scheduled."));
  } else {
    const list = el("ul", "board-list");
    for (const entry of entries) {
      const item = el("li", "board-list-item");
      item.setAttribute("data-id", entry.id);
      const row = el("div", "board-row");
      const timeInput = el("input", "board-input");
      timeInput.type = "time";
      timeInput.value = entry.time;
      timeInput.setAttribute("aria-label", "Time");
      timeInput.style.flex = "0 0 108px";
      timeInput.addEventListener("change", () => { entry.time = timeInput.value || ""; save(); render(); });
      const textInput = el("input", "board-input");
      textInput.type = "text";
      textInput.value = entry.text;
      textInput.setAttribute("aria-label", "Entry");
      textInput.style.flex = "1 1 auto";
      textInput.style.minWidth = "0";
      textInput.addEventListener("change", () => { entry.text = textInput.value; save(); });
      const del = smallButton("Delete");
      del.addEventListener("click", () => {
        state.days[day.key] = state.days[day.key].filter((e) => e.id !== entry.id);
        save();
        render();
      });
      row.appendChild(timeInput);
      row.appendChild(textInput);
      row.appendChild(del);
      item.appendChild(row);
      list.appendChild(item);
    }
    body.appendChild(list);
  }

  const addRow = el("div", "board-row");
  addRow.style.marginTop = "8px";
  const timeInput = el("input", "board-input");
  timeInput.type = "time";
  timeInput.setAttribute("aria-label", "New entry time");
  timeInput.style.flex = "0 0 108px";
  const textInput = el("input", "board-input");
  textInput.type = "text";
  textInput.placeholder = "Add an entry";
  textInput.style.flex = "1 1 auto";
  textInput.style.minWidth = "0";
  const add = el("button", "board-btn board-btn-primary", "Add");
  add.type = "button";
  const submit = () => {
    const text = textInput.value.trim();
    if (!text) return;
    state.days[day.key].push({ id: newId(), time: timeInput.value || "", text });
    save();
    render();
  };
  add.addEventListener("click", submit);
  textInput.addEventListener("keydown", (event) => { if (event.key === "Enter") submit(); });
  addRow.appendChild(timeInput);
  addRow.appendChild(textInput);
  addRow.appendChild(add);
  body.appendChild(addRow);
  return wrap;
}

function render() {
  if (!rootEl || !state) return;
  rootEl.replaceChildren();
  const grid = el("div", "board-grid-dense");
  for (const day of DAYS) grid.appendChild(renderDay(day));
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
  if (unlisten) { unlisten(); unlisten = null; }
  unlisten = ctx.store.listen(DOC, (incoming) => {
    if (!incoming) return;
    const next = normalize(incoming);
    const nextSerialized = JSON.stringify(next);
    if (nextSerialized === lastSerialized || nextSerialized === serialize()) return;
    const active = document.activeElement;
    if (active && container.contains(active) && /INPUT|TEXTAREA|SELECT/.test(active.tagName)) return;
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
