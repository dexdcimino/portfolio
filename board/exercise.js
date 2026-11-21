/* Dex Board Exercise tab.
   Data lives in the board-exercise doc:
   split: [{ day, focus }] with one row per weekday, Monday first,
     and focus as an editable label such as Push, Pull, Legs or Rest
   exercises: [{ id, name, sets: [{ done }] }] for the today workout
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

function card(title, sub) {
  const wrap = el("section", "board-card");
  const head = el("div", "board-card-head");
  head.appendChild(el("h3", "board-card-title", title));
  wrap.appendChild(head);
  if (sub) wrap.appendChild(el("p", "board-card-sub", sub));
  const body = el("div", "board-card-body");
  wrap.appendChild(body);
  return { wrap, body };
}

function renderSplit(body) {
  const list = el("ul", "board-list");
  for (const row of state.split) {
    const item = el("li", "board-list-item");
    const line = el("div", "board-row");
    const dayLabel = el("span", null, row.day);
    dayLabel.style.flex = "0 0 96px";
    dayLabel.style.fontWeight = "600";
    const focus = el("input", "board-input");
    focus.type = "text";
    focus.value = row.focus;
    focus.placeholder = "Focus, for example Push or Rest";
    focus.setAttribute("aria-label", row.day + " focus");
    focus.style.flex = "1 1 auto";
    focus.style.minWidth = "0";
    focus.addEventListener("change", () => { row.focus = focus.value; save(); });
    line.appendChild(dayLabel);
    line.appendChild(focus);
    item.appendChild(line);
    list.appendChild(item);
  }
  body.appendChild(list);
}

function renderToday(body) {
  if (!state.exercises.length) {
    body.appendChild(el("div", "board-empty", "No exercises yet. Add the first one below."));
  } else {
    const list = el("ul", "board-list");
    for (const exercise of state.exercises) {
      const item = el("li", "board-list-item");
      item.setAttribute("data-id", exercise.id);
      const headRow = el("div", "board-row");
      const name = el("input", "board-input");
      name.type = "text";
      name.value = exercise.name;
      name.placeholder = "Exercise name";
      name.setAttribute("aria-label", "Exercise name");
      name.style.flex = "1 1 auto";
      name.style.minWidth = "0";
      name.addEventListener("change", () => { exercise.name = name.value; save(); });
      const removeExercise = smallButton("Remove");
      removeExercise.addEventListener("click", () => {
        state.exercises = state.exercises.filter((e) => e.id !== exercise.id);
        save();
        render();
      });
      headRow.appendChild(name);
      headRow.appendChild(removeExercise);
      item.appendChild(headRow);

      const setsRow = el("div", "board-row board-row-wrap");
      setsRow.style.marginTop = "8px";
      exercise.sets.forEach((set, index) => {
        const setWrap = el("span", "board-row");
        setWrap.style.gap = "4px";
        const check = document.createElement("input");
        check.type = "checkbox";
        check.checked = set.done;
        check.setAttribute("aria-label", "Set " + (index + 1));
        check.addEventListener("change", () => { set.done = check.checked; save(); });
        const setLabel = el("span", null, "Set " + (index + 1));
        setLabel.style.fontSize = "13px";
        setLabel.style.color = "var(--muted)";
        const removeSet = smallButton("x");
        removeSet.setAttribute("aria-label", "Remove set " + (index + 1));
        removeSet.style.padding = "2px 7px";
        removeSet.addEventListener("click", () => {
          exercise.sets.splice(index, 1);
          save();
          render();
        });
        setWrap.appendChild(check);
        setWrap.appendChild(setLabel);
        setWrap.appendChild(removeSet);
        setsRow.appendChild(setWrap);
      });
      const addSet = smallButton("Add set");
      addSet.addEventListener("click", () => {
        exercise.sets.push({ done: false });
        save();
        render();
      });
      setsRow.appendChild(addSet);
      item.appendChild(setsRow);
      list.appendChild(item);
    }
    body.appendChild(list);
  }

  const addRow = el("div", "board-row");
  addRow.style.marginTop = "8px";
  const input = el("input", "board-input");
  input.type = "text";
  input.placeholder = "Add an exercise";
  input.style.flex = "1 1 auto";
  input.style.minWidth = "0";
  const add = el("button", "board-btn board-btn-primary", "Add");
  add.type = "button";
  const submit = () => {
    const name = input.value.trim();
    if (!name) return;
    state.exercises.push({ id: newId(), name, sets: [{ done: false }, { done: false }, { done: false }] });
    save();
    render();
  };
  add.addEventListener("click", submit);
  input.addEventListener("keydown", (event) => { if (event.key === "Enter") submit(); });
  addRow.appendChild(input);
  addRow.appendChild(add);
  body.appendChild(addRow);
}

function render() {
  if (!rootEl || !state) return;
  rootEl.replaceChildren();
  const grid = el("div", "board-grid");
  const split = card("Weekly split", "Starter labels, all editable. Change any day to match your week.");
  renderSplit(split.body);
  grid.appendChild(split.wrap);
  const today = card("Today workout", "Tick off sets as you finish them.");
  renderToday(today.body);
  grid.appendChild(today.wrap);
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
