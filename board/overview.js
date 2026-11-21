/* Dex Board Overview tab.
   Data lives in the board-overview doc:
   tasks: [{ id, text, done }]
   comingUp: [{ id, text, date }] with date as YYYY-MM-DD
   bills: [{ id, payee, amount, cadence, dueDay, dueMonth }] with cadence
     "monthly" or "yearly", dueDay as a day of month number, and dueMonth
     as a month number from 1 to 12 used only for yearly bills, or null
     for monthly bills and for yearly bills saved before dueMonth existed
   fitnessText: string, seeded with the fitness snapshot note
   quickNote: string, the quick capture box
   Every change saves through the store, and store.listen keeps the
   tab in step with changes from another device. */

const DOC = "board-overview";
const FITNESS_SEED = "";

let ctxRef = null;
let rootEl = null;
let state = null;
let unlisten = null;
let taskSortable = null;
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

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function validDueMonth(value) {
  const n = parseInt(value, 10);
  return n >= 1 && n <= 12 ? n : null;
}

function currentMonthNumber() {
  return new Date().getMonth() + 1;
}

function makeMonthSelect(selectedMonth) {
  const select = el("select", "board-select");
  select.setAttribute("aria-label", "Due month");
  select.style.flex = "0 1 120px";
  for (let month = 1; month <= 12; month += 1) {
    const opt = el("option", null, MONTH_NAMES[month - 1]);
    opt.value = String(month);
    if (month === selectedMonth) opt.selected = true;
    select.appendChild(opt);
  }
  return select;
}

function defaultState() {
  return { tasks: [], comingUp: [], bills: [], fitnessText: FITNESS_SEED, quickNote: "" };
}

function normalize(data) {
  const out = defaultState();
  if (!data || typeof data !== "object") return out;
  if (Array.isArray(data.tasks)) {
    out.tasks = data.tasks
      .filter((t) => t && typeof t === "object")
      .map((t) => ({ id: String(t.id || newId()), text: String(t.text || ""), done: !!t.done }));
  }
  if (Array.isArray(data.comingUp)) {
    out.comingUp = data.comingUp
      .filter((t) => t && typeof t === "object")
      .map((t) => ({ id: String(t.id || newId()), text: String(t.text || ""), date: String(t.date || "") }));
  }
  if (Array.isArray(data.bills)) {
    out.bills = data.bills
      .filter((b) => b && typeof b === "object")
      .map((b) => ({
        id: String(b.id || newId()),
        payee: String(b.payee || ""),
        amount: typeof b.amount === "number" && isFinite(b.amount) ? b.amount : Number(b.amount) || 0,
        cadence: b.cadence === "yearly" ? "yearly" : "monthly",
        dueDay: Math.min(31, Math.max(1, parseInt(b.dueDay, 10) || 1)),
        dueMonth: validDueMonth(b.dueMonth),
      }));
  }
  if (typeof data.fitnessText === "string") out.fitnessText = data.fitnessText;
  if (typeof data.quickNote === "string") out.quickNote = data.quickNote;
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

/* The today rail (board/rail.js) reads this doc too; tell it at once rather
   than waiting for the debounced write to come back through listen. */
function announce() {
  try { window.dispatchEvent(new CustomEvent("board:overview", { detail: JSON.parse(serialize()) })); } catch (err) { void err; }
}

function formatDateLabel(value) {
  if (!value) return "No date";
  const parts = value.split("-").map((p) => parseInt(p, 10));
  if (parts.length !== 3 || parts.some((n) => !isFinite(n))) return value;
  const d = new Date(parts[0], parts[1] - 1, parts[2]);
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

function daysInMonth(year, monthIndex) {
  return new Date(year, monthIndex + 1, 0).getDate();
}

function nextDueDate(bill) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayThisMonth = Math.min(bill.dueDay, daysInMonth(today.getFullYear(), today.getMonth()));
  let candidate = new Date(today.getFullYear(), today.getMonth(), dayThisMonth);
  if (bill.cadence === "yearly") {
    const dueMonth = validDueMonth(bill.dueMonth);
    if (dueMonth !== null) {
      const monthIndex = dueMonth - 1;
      let year = today.getFullYear();
      let due = new Date(year, monthIndex, Math.min(bill.dueDay, daysInMonth(year, monthIndex)));
      if (due < today) {
        year += 1;
        due = new Date(year, monthIndex, Math.min(bill.dueDay, daysInMonth(year, monthIndex)));
      }
      return due;
    }
    if (candidate < today) {
      const year = today.getFullYear() + 1;
      candidate = new Date(year, today.getMonth(), Math.min(bill.dueDay, daysInMonth(year, today.getMonth())));
    }
    return candidate;
  }
  if (candidate < today) {
    const next = new Date(today.getFullYear(), today.getMonth() + 1, 1);
    candidate = new Date(next.getFullYear(), next.getMonth(), Math.min(bill.dueDay, daysInMonth(next.getFullYear(), next.getMonth())));
  }
  return candidate;
}

function nextDueLabel(bill) {
  const d = nextDueDate(bill);
  const when = d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  return "Next due " + when;
}

function card(title, pillText, pillKind) {
  const wrap = el("section", "board-card");
  const head = el("div", "board-card-head");
  head.appendChild(el("h3", "board-card-title", title));
  let pill = null;
  if (pillText !== undefined) {
    pill = el("span", "pill" + (pillKind ? " " + pillKind : ""), pillText);
    head.appendChild(pill);
  }
  wrap.appendChild(head);
  const body = el("div", "board-card-body");
  wrap.appendChild(body);
  return { wrap, body, pill };
}

function removeButton(label, onClick) {
  const b = el("button", "row-x", "×");
  b.type = "button";
  b.setAttribute("aria-label", label);
  b.addEventListener("click", onClick);
  return b;
}

/* Inline editable text, the mockup's rows: click the words to change them.
   Saves as you type; Enter leaves the field. */
function editableText(value, label, onChange) {
  const span = el("span", "row-text", value);
  span.contentEditable = "plaintext-only";
  if (span.contentEditable !== "plaintext-only") span.contentEditable = "true";
  span.spellcheck = true;
  span.setAttribute("role", "textbox");
  span.setAttribute("aria-label", label);
  span.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); span.blur(); } });
  span.addEventListener("input", () => onChange(span.textContent.replace(/\s+/g, " ").trim()));
  return span;
}

function addRow(placeholder, buttonText, extras, onSubmit) {
  const row = el("div", "add-row");
  const input = el("input", "board-input");
  input.type = "text";
  input.placeholder = placeholder;
  input.setAttribute("aria-label", placeholder);
  row.appendChild(input);
  for (const x of extras || []) row.appendChild(x);
  const add = el("button", "board-btn board-btn-primary", buttonText);
  add.type = "button";
  const submit = () => {
    const text = input.value.trim();
    if (!text) { input.focus(); return; }
    onSubmit(text);
  };
  add.addEventListener("click", submit);
  input.addEventListener("keydown", (event) => { if (event.key === "Enter") submit(); });
  row.appendChild(add);
  return { row, input };
}

function dayDiff(date) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((date - today) / 86400000);
}

function renderToday(c) {
  const open = state.tasks.filter((t) => !t.done).length;
  c.pill.textContent = open + " open";
  const list = el("ul", "board-list");
  if (!state.tasks.length) c.body.appendChild(el("div", "board-empty", "No tasks yet. Add the first one below."));
  for (const task of state.tasks) {
    const item = el("li", "board-list-item" + (task.done ? " is-done" : ""));
    item.setAttribute("data-id", task.id);
    const row = el("div", "board-row");
    const check = document.createElement("input");
    check.type = "checkbox";
    check.checked = task.done;
    check.setAttribute("aria-label", "Done: " + task.text);
    check.addEventListener("change", () => {
      task.done = check.checked;
      item.classList.toggle("is-done", task.done);
      c.pill.textContent = state.tasks.filter((t) => !t.done).length + " open";
      save();
    });
    const text = editableText(task.text, "Task", (v) => { task.text = v; save(); });
    row.append(check, text, removeButton("Remove task", () => {
      state.tasks = state.tasks.filter((t) => t.id !== task.id);
      save();
      render();
    }));
    item.appendChild(row);
    list.appendChild(item);
  }
  c.body.appendChild(list);

  if (taskSortable) { taskSortable.destroy(); taskSortable = null; }
  if (ctxRef && ctxRef.dnd && state.tasks.length > 1) {
    taskSortable = ctxRef.dnd.makeSortable(list, {
      itemSelector: ".board-list-item",
      onCommit: ({ ids }) => {
        const byId = new Map(state.tasks.map((t) => [t.id, t]));
        const reordered = [];
        for (const id of ids) if (byId.has(id)) { reordered.push(byId.get(id)); byId.delete(id); }
        for (const t of byId.values()) reordered.push(t);
        state.tasks = reordered;
        save();
      },
    });
  }

  const add = addRow("Add a task", "Add", null, (text) => {
    state.tasks.push({ id: newId(), text, done: false });
    save();
    render();
    focusAdd("Add a task");
  });
  c.body.appendChild(add.row);
}

function renderComingUp(c) {
  const sorted = state.comingUp.slice().sort((a, b) => {
    if (!a.date && !b.date) return 0;
    if (!a.date) return 1;
    if (!b.date) return -1;
    return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
  });
  const week = sorted.filter((x) => {
    if (!x.date) return false;
    const [y, m, d] = x.date.split("-").map(Number);
    const n = dayDiff(new Date(y, m - 1, d));
    return n >= 0 && n <= 7;
  }).length;
  c.pill.textContent = week + " this week";
  if (!week) c.pill.classList.remove("warn", "hot");
  if (!sorted.length) c.body.appendChild(el("div", "board-empty", "Nothing coming up yet."));
  const list = el("ul", "board-list");
  for (const itemData of sorted) {
    const item = el("li", "board-list-item");
    const row = el("div", "board-row");
    let label = "No date";
    let hot = false;
    if (itemData.date) {
      const [y, m, d] = itemData.date.split("-").map(Number);
      const date = new Date(y, m - 1, d);
      const n = dayDiff(date);
      label = n === 0 ? "Today" : n === 1 ? "Tomorrow" : date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
      hot = n >= 0 && n <= 3;
    }
    const meta = el("span", "row-meta" + (hot ? " hot" : ""), label);
    meta.title = formatDateLabel(itemData.date);
    const text = editableText(itemData.text, "Coming up", (v) => { itemData.text = v; save(); });
    row.append(meta, text, removeButton("Remove item", () => {
      state.comingUp = state.comingUp.filter((t) => t.id !== itemData.id);
      save();
      render();
    }));
    item.appendChild(row);
    list.appendChild(item);
  }
  c.body.appendChild(list);
  const dateInput = el("input", "board-input");
  dateInput.type = "date";
  dateInput.setAttribute("aria-label", "Date");
  dateInput.style.flex = "0 1 160px";
  const add = addRow("What is coming up", "Add", [dateInput], (text) => {
    state.comingUp.push({ id: newId(), text, date: dateInput.value || "" });
    save();
    render();
    focusAdd("What is coming up");
  });
  c.body.appendChild(add.row);
}

function money(n) {
  return "$" + (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function cadenceSelect(value) {
  const s = el("select", "board-select");
  s.setAttribute("aria-label", "How often");
  for (const v of ["monthly", "yearly"]) {
    const opt = el("option", null, v === "monthly" ? "Monthly" : "Yearly");
    opt.value = v;
    if (v === value) opt.selected = true;
    s.appendChild(opt);
  }
  return s;
}

function dayInput(value) {
  const i = el("input", "board-input");
  i.type = "number";
  i.min = "1";
  i.max = "31";
  i.placeholder = "Day";
  if (value) i.value = String(value);
  i.setAttribute("aria-label", "Due day of the month");
  return i;
}

function amountInput(value) {
  const i = el("input", "board-input");
  i.type = "number";
  i.min = "0";
  i.step = "0.01";
  i.placeholder = "Amount";
  if (value) i.value = String(value);
  i.setAttribute("aria-label", "Amount");
  return i;
}

/* Bills: who, how much, monthly or yearly, and the due day (and month for a
   yearly one). Sorted by when each is next due. */
function renderBills(c) {
  const monthly = state.bills.reduce((s, b) => s + (b.cadence === "yearly" ? b.amount / 12 : b.amount), 0);
  c.pill.textContent = money(monthly) + " a month";
  const sorted = state.bills.map((b) => ({ b, d: nextDueDate(b) })).sort((x, y) => x.d - y.d);
  if (!sorted.length) c.body.appendChild(el("div", "board-empty", "No bills yet. Add who it goes to, how much, and when it is due."));
  const list = el("ul", "board-list bill-list");
  for (const { b: bill, d } of sorted) {
    const item = el("li", "board-list-item bill-item");
    const top = el("div", "board-row");
    const payee = editableText(bill.payee, "Who the bill goes to", (v) => { bill.payee = v; save(); });
    payee.classList.add("bill-payee");
    const n = dayDiff(d);
    const when = el("span", "row-meta" + (n <= 3 ? " hot" : n <= 10 ? " warn" : ""),
      n === 0 ? "Due today" : n === 1 ? "Due tomorrow" : "Due " + d.toLocaleDateString("en-US", { month: "short", day: "numeric" }));
    const amt = el("button", "bill-amt", money(bill.amount) + (bill.cadence === "yearly" ? " /yr" : " /mo"));
    amt.type = "button";
    amt.title = "Edit amount, how often and the due day";
    amt.setAttribute("aria-expanded", "false");
    amt.addEventListener("click", () => {
      const open = !item.classList.contains("is-open");
      item.classList.toggle("is-open", open);
      amt.setAttribute("aria-expanded", open ? "true" : "false");
      if (open) { const f = item.querySelector(".bill-edit input"); if (f) f.focus(); }
    });
    top.append(payee, when, amt, removeButton("Remove bill", () => {
      state.bills = state.bills.filter((x) => x.id !== bill.id);
      save();
      render();
    }));
    const edit = el("div", "bill-edit");
    const amount = amountInput(bill.amount);
    amount.addEventListener("change", () => { bill.amount = Math.max(0, Number(amount.value) || 0); save(); render(); });
    const cadence = cadenceSelect(bill.cadence);
    cadence.addEventListener("change", () => {
      bill.cadence = cadence.value === "yearly" ? "yearly" : "monthly";
      if (bill.cadence === "yearly" && validDueMonth(bill.dueMonth) === null) bill.dueMonth = currentMonthNumber();
      save();
      render();
    });
    edit.append(amount, cadence);
    if (bill.cadence === "yearly") {
      const month = makeMonthSelect(validDueMonth(bill.dueMonth) || currentMonthNumber());
      month.style.flex = "";
      month.addEventListener("change", () => { bill.dueMonth = validDueMonth(month.value); save(); render(); });
      edit.append(month);
    }
    const day = dayInput(bill.dueDay);
    day.addEventListener("change", () => { bill.dueDay = Math.min(31, Math.max(1, parseInt(day.value, 10) || 1)); save(); render(); });
    edit.append(day);
    item.append(top, edit);
    list.appendChild(item);
  }
  c.body.appendChild(list);

  const form = el("div", "bill-add");
  const payeeIn = el("input", "board-input bill-add-payee");
  payeeIn.type = "text";
  payeeIn.placeholder = "Who it goes to";
  payeeIn.setAttribute("aria-label", "Who the new bill goes to");
  const amountIn = amountInput("");
  const cadenceIn = cadenceSelect("monthly");
  const monthIn = makeMonthSelect(currentMonthNumber());
  monthIn.style.flex = "";
  monthIn.hidden = true;
  cadenceIn.addEventListener("change", () => { monthIn.hidden = cadenceIn.value !== "yearly"; });
  const dayIn = dayInput("");
  const add = el("button", "board-btn board-btn-primary", "Add bill");
  add.type = "button";
  const submit = () => {
    const payee = payeeIn.value.trim();
    if (!payee) { payeeIn.focus(); return; }
    const cadence = cadenceIn.value === "yearly" ? "yearly" : "monthly";
    state.bills.push({
      id: newId(),
      payee,
      amount: Math.max(0, Number(amountIn.value) || 0),
      cadence,
      dueDay: Math.min(31, Math.max(1, parseInt(dayIn.value, 10) || 1)),
      dueMonth: cadence === "yearly" ? validDueMonth(monthIn.value) : null,
    });
    save();
    render();
  };
  add.addEventListener("click", submit);
  for (const i of [payeeIn, amountIn, dayIn]) i.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
  form.append(payeeIn, amountIn, cadenceIn, monthIn, dayIn, add);
  c.body.appendChild(form);
}

function autosize(area) {
  const fit = () => { area.style.height = "auto"; area.style.height = Math.max(area.scrollHeight + 2, 64) + "px"; };
  area.addEventListener("input", fit);
  requestAnimationFrame(fit);
}

function renderText(c, key, label, placeholder) {
  const area = el("textarea", "board-textarea");
  area.rows = 3;
  area.value = state[key];
  area.placeholder = placeholder;
  area.setAttribute("aria-label", label);
  area.addEventListener("input", () => { state[key] = area.value; save(); });
  autosize(area);
  c.body.appendChild(area);
}

function focusAdd(placeholder) {
  if (!rootEl) return;
  const input = rootEl.querySelector('input[placeholder="' + placeholder + '"]');
  if (input) input.focus();
}

function render() {
  if (!rootEl || !state) return;
  if (taskSortable) { taskSortable.destroy(); taskSortable = null; }
  rootEl.replaceChildren();
  const grid = el("div", "board-grid");
  const today = card("Today", "", "hot");
  renderToday(today);
  const coming = card("Coming up", "", "warn");
  renderComingUp(coming);
  const bills = card("Bills", "", "good");
  renderBills(bills);
  const fitness = card("Fitness snapshot", "Saves as you type");
  renderText(fitness, "fitnessText", "Fitness snapshot", "Weight, streak, how training is going.");
  const quick = card("Quick note", "Scratch");
  renderText(quick, "quickNote", "Quick note", "Anything that needs a home for ten minutes.");
  grid.append(today.wrap, bills.wrap, coming.wrap, fitness.wrap, quick.wrap);
  rootEl.appendChild(grid);
}

export async function mount(container, ctx) {
  ctxRef = ctx;
  rootEl = container;
  container.replaceChildren();
  const loading = el("div", "board-loading-card", "Overview loading...");
  container.appendChild(loading);
  let data = null;
  try { data = await ctx.store.load(DOC); } catch (err) { console.warn("board overview: load failed", err); }
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
    announce();
  });
}

export function unmount() {
  if (unlisten) { unlisten(); unlisten = null; }
  if (taskSortable) { taskSortable.destroy(); taskSortable = null; }
  ctxRef = null;
  rootEl = null;
  state = null;
  lastSerialized = "";
}
