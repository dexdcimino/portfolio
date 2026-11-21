/* Dex Board Exercise tab.
   Data lives in the board-exercise doc:
   split: [{ day, focus }] with one row per weekday, Monday first,
     and focus as an editable label such as Push, Pull, Legs or Rest
   exercises: [{ id, name, sets: [{ done }] }] for the today workout
   recovery: [{ id, text, done }] the recovery checklist
   The starter split is structure only and every label is editable.
   There is no training history. Every change saves through the
   store, and store.listen keeps the tab in step with changes from
   another device. */

const DOC = "board-exercise";
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const STARTER_FOCUS = ["Push", "Pull", "Legs", "Rest", "Push", "Pull", "Rest"];

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
  return {
    split: DAYS.map((day, i) => ({ day, focus: STARTER_FOCUS[i] })),
    exercises: [],
    recovery: [],
  };
}

function normalize(data) {
  const out = defaultState();
  if (!data || typeof data !== "object") return out;
  if (Array.isArray(data.split) && data.split.length) {
    const byDay = new Map();
    for (const row of data.split) {
      if (row && typeof row === "object" && typeof row.day === "string") {
        byDay.set(row.day, String(row.focus || ""));
      }
    }
    out.split = DAYS.map((day, i) => ({ day, focus: byDay.has(day) ? byDay.get(day) : STARTER_FOCUS[i] }));
  }
  if (Array.isArray(data.exercises)) {
    out.exercises = data.exercises
      .filter((e) => e && typeof e === "object")
      .map((e) => ({
        id: String(e.id || newId()),
        name: String(e.name || ""),
        sets: Array.isArray(e.sets)
          ? e.sets.filter((s) => s && typeof s === "object").map((s) => ({ done: !!s.done }))
          : [],
      }));
  }
  if (Array.isArray(data.recovery)) {
    out.recovery = data.recovery.filter((r) => r && typeof r === "object")
      .map((r) => ({ id: String(r.id || newId()), text: String(r.text || ""), done: !!r.done }));
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

function removeButton(label, onClick) {
  const b = el("button", "row-x", "×");
  b.type = "button";
  b.setAttribute("aria-label", label);
  b.addEventListener("click", onClick);
  return b;
}

function editableText(value, label, onChange, placeholder) {
  const span = el("span", "row-text", value);
  span.contentEditable = "plaintext-only";
  if (span.contentEditable !== "plaintext-only") span.contentEditable = "true";
  span.setAttribute("role", "textbox");
  span.setAttribute("aria-label", label);
  if (placeholder) span.dataset.placeholder = placeholder;
  span.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); span.blur(); } });
  span.addEventListener("input", () => onChange(span.textContent.replace(/\s+/g, " ").trim()));
  return span;
}

function card(title, pillText, pillKind) {
  const wrap = el("section", "board-card");
  const head = el("div", "board-card-head");
  head.appendChild(el("h3", "board-card-title", title));
  let pill = null;
  if (pillText !== undefined) { pill = el("span", "pill" + (pillKind ? " " + pillKind : ""), pillText); head.appendChild(pill); }
  wrap.appendChild(head);
  const body = el("div", "board-card-body");
  wrap.appendChild(body);
  return { wrap, body, pill };
}

function addForm(placeholder, onAdd) {
  const row = el("div", "add-row");
  const input = el("input", "board-input");
  input.type = "text";
  input.placeholder = placeholder;
  input.setAttribute("aria-label", placeholder);
  const add = el("button", "board-btn board-btn-primary", "Add");
  add.type = "button";
  const submit = () => {
    const v = input.value.trim();
    if (!v) { input.focus(); return; }
    onAdd(v);
    save();
    render();
    const again = rootEl && rootEl.querySelector('input[placeholder="' + placeholder + '"]');
    if (again) again.focus();
  };
  add.addEventListener("click", submit);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
  row.append(input, add);
  return row;
}

function todayName() {
  return DAYS[(new Date().getDay() + 6) % 7];
}

function renderSplit(c) {
  const today = todayName();
  const todayRow = state.split.find((r) => r.day === today);
  c.pill.textContent = todayRow && todayRow.focus ? "Today: " + todayRow.focus : "Week";
  const list = el("ul", "board-list");
  for (const row of state.split) {
    const item = el("li", "board-list-item");
    const line = el("div", "board-row");
    const isToday = row.day === today;
    line.append(
      el("span", "row-meta ex-day" + (isToday ? " hot" : ""), row.day.slice(0, 3)),
      editableText(row.focus, row.day + " focus", (v) => { row.focus = v; save(); }, "Rest"),
    );
    if (isToday) line.append(el("span", "row-meta hot", "Today"));
    item.appendChild(line);
    list.appendChild(item);
  }
  c.body.appendChild(list);
}

function setCounts() {
  let total = 0;
  let done = 0;
  for (const e of state.exercises) for (const s of e.sets) { total += 1; if (s.done) done += 1; }
  return { total, done };
}

function renderToday(c) {
  const { total, done } = setCounts();
  c.pill.textContent = (total - done) + (total - done === 1 ? " set left" : " sets left");
  if (!state.exercises.length) c.body.appendChild(el("div", "board-empty", "No exercises yet. Add the first one below."));
  const list = el("ul", "board-list");
  for (const exercise of state.exercises) {
    const item = el("li", "board-list-item ex-item");
    item.setAttribute("data-id", exercise.id);
    const head = el("div", "board-row");
    head.append(
      editableText(exercise.name, "Exercise name", (v) => { exercise.name = v; save(); }, "Exercise"),
      removeButton("Remove exercise", () => {
        state.exercises = state.exercises.filter((e) => e.id !== exercise.id);
        save();
        render();
      }),
    );
    const sets = el("div", "ex-sets");
    exercise.sets.forEach((set, index) => {
      const b = el("button", "ex-set" + (set.done ? " is-done" : ""), String(index + 1));
      b.type = "button";
      b.setAttribute("aria-pressed", set.done ? "true" : "false");
      b.setAttribute("aria-label", "Set " + (index + 1) + (set.done ? ", done" : ""));
      b.title = "Tap to tick. Right click or long press to remove.";
      b.addEventListener("click", () => { set.done = !set.done; save(); render(); });
      b.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        exercise.sets.splice(index, 1);
        save();
        render();
      });
      sets.appendChild(b);
    });
    const addSet = el("button", "ex-set ex-set-add", "+");
    addSet.type = "button";
    addSet.setAttribute("aria-label", "Add a set");
    addSet.addEventListener("click", () => { exercise.sets.push({ done: false }); save(); render(); });
    sets.appendChild(addSet);
    if (exercise.sets.length) {
      const less = el("button", "ex-set ex-set-add", "−");
      less.type = "button";
      less.setAttribute("aria-label", "Remove the last set");
      less.addEventListener("click", () => { exercise.sets.pop(); save(); render(); });
      sets.appendChild(less);
    }
    item.append(head, sets);
    list.appendChild(item);
  }
  c.body.appendChild(list);
  c.body.appendChild(addForm("Add an exercise", (name) => {
    state.exercises.push({ id: newId(), name, sets: [{ done: false }, { done: false }, { done: false }] });
  }));
}

function renderProgress(c) {
  const { total, done } = setCounts();
  const pct = total ? Math.round((done / total) * 100) : 0;
  c.pill.textContent = pct + "%";
  const today = state.split.find((r) => r.day === todayName());
  const restDays = state.split.filter((r) => /rest/i.test(r.focus)).length;
  const rows = [
    ["Sets done today", done + " of " + total, pct],
    ["Training days this week", (7 - restDays) + " of 7", Math.round(((7 - restDays) / 7) * 100)],
  ];
  for (const [label, value, w] of rows) {
    const r = el("div", "stat-row");
    r.append(el("span", "stat-label", label), el("span", "stat-value", value));
    const bar = el("div", "bar");
    const fill = el("i");
    fill.style.width = w + "%";
    bar.appendChild(fill);
    c.body.append(r, bar);
  }
  const r = el("div", "stat-row");
  r.append(el("span", "stat-label", "Today's focus"), el("span", "stat-value", (today && today.focus) || "Rest"));
  c.body.append(r);
}

function renderRecovery(c) {
  const open = state.recovery.filter((r) => !r.done).length;
  c.pill.textContent = open ? open + " to do" : "Done";
  const list = el("ul", "board-list");
  if (!state.recovery.length) c.body.appendChild(el("div", "board-empty", "Mobility, walks, sleep."));
  for (const r of state.recovery) {
    const item = el("li", "board-list-item" + (r.done ? " is-done" : ""));
    const row = el("div", "board-row");
    const check = document.createElement("input");
    check.type = "checkbox";
    check.checked = r.done;
    check.setAttribute("aria-label", "Done: " + r.text);
    check.addEventListener("change", () => { r.done = check.checked; save(); render(); });
    row.append(check, editableText(r.text, "Recovery item", (v) => { r.text = v; save(); }), removeButton("Remove item", () => {
      state.recovery = state.recovery.filter((x) => x.id !== r.id);
      save();
      render();
    }));
    item.appendChild(row);
    list.appendChild(item);
  }
  c.body.appendChild(list);
  c.body.appendChild(addForm("Add a recovery item", (text) => { state.recovery.push({ id: newId(), text, done: false }); }));
}

function render() {
  if (!rootEl || !state) return;
  rootEl.replaceChildren();
  const grid = el("div", "board-grid");
  const split = card("Weekly split", "");
  renderSplit(split);
  const today = card("Today's workout", "", "hot");
  renderToday(today);
  const progress = card("Progress", "", "good");
  renderProgress(progress);
  const recovery = card("Recovery", "");
  renderRecovery(recovery);
  grid.append(today.wrap, split.wrap, progress.wrap, recovery.wrap);
  rootEl.appendChild(grid);
}

export async function mount(container, ctx) {
  ctxRef = ctx;
  rootEl = container;
  container.replaceChildren();
  container.appendChild(el("div", "board-loading-card", "Exercise loading..."));
  let data = null;
  try { data = await ctx.store.load(DOC); } catch (err) { console.warn("board exercise: load failed", err); }
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
