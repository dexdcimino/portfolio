/* Dex Board Overview tab.
   Data lives in the board-overview doc:
   tasks: [{ id, text, done }]
   comingUp: [{ id, text, date }] with date as YYYY-MM-DD
   bills: [{ id, payee, amount, cadence, dueDay, dueMonth }] with cadence
     "monthly" or "yearly", dueDay as a day of month number, and dueMonth
     as a month number from 1 to 12 used only for yearly bills, or null
     for monthly bills and for yearly bills saved before dueMonth existed
   fitnessText: string, seeded with the fitness snapshot note
   Every change saves through the store, and store.listen keeps the
   tab in step with changes from another device. */

const DOC = "board-overview";
const FITNESS_SEED = "Fasting plus regular gym. 40 pounds lost.";

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
  return { tasks: [], comingUp: [], bills: [], fitnessText: FITNESS_SEED };
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

function smallButton(text) {
  const btn = el("button", "board-btn", text);
  btn.type = "button";
  btn.style.padding = "5px 10px";
  btn.style.fontSize = "12.5px";
  return btn;
}

function renderToday(body) {
  const list = el("ul", "board-list");
  list.setAttribute("data-tasks-list", "1");
  if (!state.tasks.length) {
    body.appendChild(el("div", "board-empty", "No tasks yet."));
  } else {
    for (const task of state.tasks) {
      const item = el("li", "board-list-item");
      item.setAttribute("data-id", task.id);
      const row = el("div", "board-row");
      const check = document.createElement("input");
      check.type = "checkbox";
      check.checked = task.done;
      check.setAttribute("aria-label", "Done");
      check.addEventListener("change", () => {
        task.done = check.checked;
        save();
        render();
      });
      const label = el("span", null, task.text);
      label.style.flex = "1 1 auto";
      label.style.minWidth = "0";
      if (task.done) {
        label.style.color = "var(--muted)";
        label.style.textDecoration = "line-through";
      }
      const del = smallButton("Delete");
      del.addEventListener("click", () => {
        state.tasks = state.tasks.filter((t) => t.id !== task.id);
        save();
        render();
      });
      row.appendChild(check);
      row.appendChild(label);
      row.appendChild(del);
      item.appendChild(row);
      list.appendChild(item);
    }
  }
  body.appendChild(list);

  if (taskSortable) { taskSortable.destroy(); taskSortable = null; }
  if (ctxRef && ctxRef.dnd && state.tasks.length > 1) {
    taskSortable = ctxRef.dnd.makeSortable(list, {
      itemSelector: ".board-list-item",
      onCommit: ({ ids }) => {
        const byId = new Map(state.tasks.map((t) => [t.id, t]));
        const reordered = [];
        for (const id of ids) {
          if (byId.has(id)) { reordered.push(byId.get(id)); byId.delete(id); }
        }
        for (const t of byId.values()) reordered.push(t);
        state.tasks = reordered;
        save();
      },
    });
  }

  const addRow = el("div", "board-row");
  addRow.style.marginTop = "8px";
  const input = el("input", "board-input");
  input.type = "text";
  input.placeholder = "Add a task";
  input.style.flex = "1 1 auto";
  const add = el("button", "board-btn board-btn-primary", "Add");
  add.type = "button";
  const submit = () => {
    const text = input.value.trim();
    if (!text) return;
    state.tasks.push({ id: newId(), text, done: false });
    save();
    render();
  };
  add.addEventListener("click", submit);
  input.addEventListener("keydown", (event) => { if (event.key === "Enter") submit(); });
  addRow.appendChild(input);
  addRow.appendChild(add);
  body.appendChild(addRow);
}

function renderComingUp(body) {
  const sorted = state.comingUp.slice().sort((a, b) => {
    if (!a.date && !b.date) return 0;
    if (!a.date) return 1;
    if (!b.date) return -1;
    return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
  });
  if (!sorted.length) {
    body.appendChild(el("div", "board-empty", "Nothing coming up yet."));
  } else {
    const list = el("ul", "board-list");
    for (const itemData of sorted) {
      const item = el("li", "board-list-item");
      const row = el("div", "board-row");
      const textWrap = el("div");
      textWrap.style.flex = "1 1 auto";
      textWrap.style.minWidth = "0";
      textWrap.appendChild(el("div", null, itemData.text));
      const dateLabel = el("div", null, formatDateLabel(itemData.date));
      dateLabel.style.fontSize = "12.5px";
      dateLabel.style.color = "var(--muted)";
      textWrap.appendChild(dateLabel);
      const del = smallButton("Delete");
      del.addEventListener("click", () => {
        state.comingUp = state.comingUp.filter((t) => t.id !== itemData.id);
        save();
        render();
      });
      row.appendChild(textWrap);
      row.appendChild(del);
      item.appendChild(row);
      list.appendChild(item);
    }
    body.appendChild(list);
  }

  const addRow = el("div", "board-row board-row-wrap");
  addRow.style.marginTop = "8px";
  const textInput = el("input", "board-input");
  textInput.type = "text";
  textInput.placeholder = "What is coming up";
  textInput.style.flex = "1 1 140px";
  const dateInput = el("input", "board-input");
  dateInput.type = "date";
  dateInput.style.flex = "0 1 160px";
  const add = el("button", "board-btn board-btn-primary", "Add");
  add.type = "button";
  const submit = () => {
    const text = textInput.value.trim();
    if (!text) return;
    state.comingUp.push({ id: newId(), text, date: dateInput.value || "" });
    save();
    render();
  };
  add.addEventListener("click", submit);
  textInput.addEventListener("keydown", (event) => { if (event.key === "Enter") submit(); });
  addRow.appendChild(textInput);
  addRow.appendChild(dateInput);
  addRow.appendChild(add);
  body.appendChild(addRow);
}

function renderBills(body) {
  if (!state.bills.length) {
    body.appendChild(el("div", "board-empty", "No bills yet."));
  } else {
    const list = el("ul", "board-list");
    for (const bill of state.bills) {
      const item = el("li", "board-list-item");
      const row = el("div", "board-row board-row-wrap");
      const payee = el("input", "board-input");
      payee.type = "text";
      payee.value = bill.payee;
      payee.placeholder = "Payee";
      payee.setAttribute("aria-label", "Payee");
      payee.style.flex = "1 1 110px";
      payee.addEventListener("change", () => { bill.payee = payee.value.trim(); save(); render(); });
      const amount = el("input", "board-input");
      amount.type = "number";
      amount.min = "0";
      amount.step = "0.01";
      amount.value = bill.amount ? String(bill.amount) : "";
      amount.placeholder = "Amount";
      amount.setAttribute("aria-label", "Amount");
      amount.style.flex = "0 1 90px";
      amount.addEventListener("change", () => { bill.amount = Number(amount.value) || 0; save(); render(); });
      const cadence = el("select", "board-select");
      cadence.setAttribute("aria-label", "Cadence");
      cadence.style.flex = "0 1 110px";
      for (const value of ["monthly", "yearly"]) {
        const opt = el("option", null, value);
        opt.value = value;
        if (bill.cadence === value) opt.selected = true;
        cadence.appendChild(opt);
      }
      cadence.addEventListener("change", () => {
        bill.cadence = cadence.value === "yearly" ? "yearly" : "monthly";
        if (bill.cadence === "yearly" && validDueMonth(bill.dueMonth) === null) {
          bill.dueMonth = currentMonthNumber();
        }
        save();
        render();
      });
      let dueMonthSelect = null;
      if (bill.cadence === "yearly") {
        dueMonthSelect = makeMonthSelect(validDueMonth(bill.dueMonth) || currentMonthNumber());
        dueMonthSelect.addEventListener("change", () => {
          bill.dueMonth = validDueMonth(dueMonthSelect.value);
          save();
          render();
        });
      }
      const dueDay = el("input", "board-input");
      dueDay.type = "number";
      dueDay.min = "1";
      dueDay.max = "31";
      dueDay.value = String(bill.dueDay);
      dueDay.setAttribute("aria-label", "Due day");
      dueDay.style.flex = "0 1 64px";
      dueDay.addEventListener("change", () => {
        bill.dueDay = Math.min(31, Math.max(1, parseInt(dueDay.value, 10) || 1));
        save();
        render();
      });
      const del = smallButton("Delete");
      del.addEventListener("click", () => {
        state.bills = state.bills.filter((b) => b.id !== bill.id);
        save();
        render();
      });
      row.appendChild(payee);
      row.appendChild(amount);
      row.appendChild(cadence);
      if (dueMonthSelect) row.appendChild(dueMonthSelect);
      row.appendChild(dueDay);
      row.appendChild(del);
      item.appendChild(row);
      const meta = el("div", null, nextDueLabel(bill) + " and the amount is $" + bill.amount.toFixed(2));
      meta.style.fontSize = "12.5px";
      meta.style.color = "var(--muted)";
      meta.style.marginTop = "6px";
      item.appendChild(meta);
      list.appendChild(item);
    }
    body.appendChild(list);
  }

  const addRow = el("div", "board-row board-row-wrap");
  addRow.style.marginTop = "8px";
  const payeeInput = el("input", "board-input");
  payeeInput.type = "text";
  payeeInput.placeholder = "Payee";
  payeeInput.style.flex = "1 1 110px";
  const amountInput = el("input", "board-input");
  amountInput.type = "number";
  amountInput.min = "0";
  amountInput.step = "0.01";
  amountInput.placeholder = "Amount";
  amountInput.style.flex = "0 1 90px";
  const cadenceInput = el("select", "board-select");
  cadenceInput.style.flex = "0 1 110px";
  for (const value of ["monthly", "yearly"]) {
    const opt = el("option", null, value);
    opt.value = value;
    cadenceInput.appendChild(opt);
  }
  const monthInput = makeMonthSelect(currentMonthNumber());
  monthInput.style.display = "none";
  cadenceInput.addEventListener("change", () => {
    monthInput.style.display = cadenceInput.value === "yearly" ? "" : "none";
  });
  const dueInput = el("input", "board-input");
  dueInput.type = "number";
  dueInput.min = "1";
  dueInput.max = "31";
  dueInput.placeholder = "Day";
  dueInput.style.flex = "0 1 64px";
  const add = el("button", "board-btn board-btn-primary", "Add");
  add.type = "button";
  add.addEventListener("click", () => {
    const payee = payeeInput.value.trim();
    if (!payee) return;
    const cadence = cadenceInput.value === "yearly" ? "yearly" : "monthly";
    state.bills.push({
      id: newId(),
      payee,
      amount: Number(amountInput.value) || 0,
      cadence,
      dueDay: Math.min(31, Math.max(1, parseInt(dueInput.value, 10) || 1)),
      dueMonth: cadence === "yearly" ? validDueMonth(monthInput.value) : null,
    });
    save();
    render();
  });
  addRow.appendChild(payeeInput);
  addRow.appendChild(amountInput);
  addRow.appendChild(cadenceInput);
  addRow.appendChild(monthInput);
  addRow.appendChild(dueInput);
  addRow.appendChild(add);
  body.appendChild(addRow);
}

function renderFitness(body) {
  const area = el("textarea", "board-textarea");
  area.rows = 3;
  area.value = state.fitnessText;
  area.setAttribute("aria-label", "Fitness snapshot");
  area.addEventListener("input", () => {
    state.fitnessText = area.value;
    save();
  });
  body.appendChild(area);
  const note = el("p", "board-card-sub", "Editable. Saves as you type.");
  note.style.margin = "6px 0 0";
  body.appendChild(note);
}

function render() {
  if (!rootEl || !state) return;
  if (taskSortable) { taskSortable.destroy(); taskSortable = null; }
  rootEl.replaceChildren();
  const grid = el("div", "board-grid");
  const today = card("Today", "Pressing tasks. Drag to reorder.");
  renderToday(today.body);
  grid.appendChild(today.wrap);
  const coming = card("Coming up", "Dated items, soonest first.");
  renderComingUp(coming.body);
  grid.appendChild(coming.wrap);
  const bills = card("Bills", "Payee, amount, cadence and due day.");
  renderBills(bills.body);
  grid.appendChild(bills.wrap);
  const fitness = card("Fitness snapshot", null);
  renderFitness(fitness.body);
  grid.appendChild(fitness.wrap);
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
  if (taskSortable) { taskSortable.destroy(); taskSortable = null; }
  ctxRef = null;
  rootEl = null;
  state = null;
  lastSerialized = "";
}
