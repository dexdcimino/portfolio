/* The right panel: the mockup's today rail, on every tab.
   Clock and date, today's open tasks, bills due in the next 30 days with the
   monthly total, what is coming up, today's schedule entries, and quick
   links. It READS the board-overview and board-schedule docs (store.listen
   for other devices, and the board:overview / board:schedule events the tabs
   send on every local save) and writes nothing: a click goes to the tab
   where the item lives. */

let root = null;
let ctxRef = null;
let overview = null;
let schedule = null;
let clockTimer = 0;
const unlisteners = [];
const DAY_KEYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined && text !== null) n.textContent = text;
  return n;
}

function panel(title, aside) {
  const wrap = el("section", "rail-panel");
  const h = el("h3", null, title);
  if (aside) h.append(el("small", null, aside));
  const body = el("div", "rail-body");
  wrap.append(h, body);
  return { wrap, body, h };
}

function daysIn(y, m) { return new Date(y, m + 1, 0).getDate(); }

/* Same rule as overview.js nextDueDate, kept here so the rail never imports
   a tab module. */
function nextDue(bill) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = Math.min(31, Math.max(1, parseInt(bill.dueDay, 10) || 1));
  if (bill.cadence === "yearly") {
    const m = parseInt(bill.dueMonth, 10);
    const mi = m >= 1 && m <= 12 ? m - 1 : today.getMonth();
    let y = today.getFullYear();
    let d = new Date(y, mi, Math.min(day, daysIn(y, mi)));
    if (d < today) { y += 1; d = new Date(y, mi, Math.min(day, daysIn(y, mi))); }
    return d;
  }
  let d = new Date(today.getFullYear(), today.getMonth(), Math.min(day, daysIn(today.getFullYear(), today.getMonth())));
  if (d < today) {
    const n = new Date(today.getFullYear(), today.getMonth() + 1, 1);
    d = new Date(n.getFullYear(), n.getMonth(), Math.min(day, daysIn(n.getFullYear(), n.getMonth())));
  }
  return d;
}

const money = (n) => "$" + (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const short = (d) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });

function tick(clock) {
  const d = new Date();
  clock.textContent = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function go(tab) {
  if (ctxRef && ctxRef.boardApi) void ctxRef.boardApi.switchTab(tab);
}

/* What the panel shows depends on the tab, so it never repeats the canvas
   beside it: on Overview the tasks, bills and dates ARE the canvas, so the
   panel keeps only the clock, today's schedule and links; on Schedule it
   drops today's entries (they are the first block) and keeps the rest. */
function currentTab() {
  const app = document.getElementById("board-app");
  return (app && app.getAttribute("data-tab")) || "overview";
}

function render() {
  if (!root) return;
  root.replaceChildren();
  const tab = currentTab();
  const show = {
    entries: tab !== "schedule",
    tasks: tab !== "overview",
    bills: tab !== "overview",
    coming: tab !== "overview",
  };

  const today = panel("Today");
  const clock = el("div", "rail-clock");
  tick(clock);
  today.body.append(clock, el("div", "rail-date", new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })));
  const dayKey = DAY_KEYS[new Date().getDay()];
  const entries = schedule && schedule.days && Array.isArray(schedule.days[dayKey]) ? schedule.days[dayKey].slice() : [];
  entries.sort((a, b) => (a.time || "99").localeCompare(b.time || "99"));
  for (const e of show.entries ? entries.slice(0, 6) : []) {
    const row = el("div", "rail-item");
    row.append(el("time", null, e.time || "--:--"), el("span", "ri-text", e.text));
    today.body.append(row);
  }
  root.append(today.wrap);
  clearInterval(clockTimer);
  clockTimer = setInterval(() => tick(clock), 15000);

  const tasks = overview && Array.isArray(overview.tasks) ? overview.tasks : [];
  const open = tasks.filter((t) => !t.done);
  const tp = panel("To do", open.length ? open.length + " open" : "");
  if (!tasks.length) tp.body.append(el("div", "rail-empty", "No tasks yet."));
  for (const t of open.slice(0, 7)) {
    const row = el("div", "rail-item");
    row.append(el("span", "ri-dot"), el("span", "ri-text", t.text));
    tp.body.append(row);
  }
  if (open.length > 7) tp.body.append(el("div", "rail-empty", "+" + (open.length - 7) + " more on Overview"));
  if (tasks.length && !open.length) tp.body.append(el("div", "rail-empty", "All done."));
  tp.h.style.cursor = "pointer";
  tp.h.addEventListener("click", () => go("overview"));
  if (show.tasks) root.append(tp.wrap);

  const bills = overview && Array.isArray(overview.bills) ? overview.bills : [];
  const soon = bills.map((b) => ({ b, d: nextDue(b) }))
    .filter((x) => (x.d - new Date()) / 86400000 <= 31)
    .sort((a, b) => a.d - b.d);
  const monthly = bills.reduce((s, b) => s + (b.cadence === "yearly" ? (Number(b.amount) || 0) / 12 : Number(b.amount) || 0), 0);
  const bp = panel("Bills due", bills.length ? soon.length + " in 30 days" : "");
  if (!bills.length) bp.body.append(el("div", "rail-empty", "No bills yet. Add them on Overview."));
  for (const x of soon.slice(0, 8)) {
    const row = el("div", "rail-item");
    row.append(el("time", null, short(x.d)), el("span", "ri-text", x.b.payee || "Bill"), el("span", "ri-amt", money(x.b.amount)));
    bp.body.append(row);
  }
  if (bills.length) {
    const total = el("div", "rail-total");
    total.append("A month, all in", el("b", null, money(monthly)));
    bp.body.append(total);
  }
  bp.h.style.cursor = "pointer";
  bp.h.addEventListener("click", () => go("overview"));
  if (show.bills) root.append(bp.wrap);

  const coming = overview && Array.isArray(overview.comingUp) ? overview.comingUp.slice() : [];
  coming.sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999"));
  const cp = panel("Coming up");
  if (!coming.length) cp.body.append(el("div", "rail-empty", "Nothing dated yet."));
  for (const c of coming.slice(0, 6)) {
    const row = el("div", "rail-item");
    let label = "";
    if (c.date) {
      const [y, m, d] = c.date.split("-").map(Number);
      label = new Date(y, m - 1, d).toLocaleDateString("en-US", { weekday: "short", day: "numeric" });
    }
    row.append(el("time", null, label || "Soon"), el("span", "ri-text", c.text));
    cp.body.append(row);
  }
  if (show.coming) root.append(cp.wrap);

  const links = panel("Quick links");
  for (const [label, href] of [["Portfolio site", "/"], ["DexNote", "/dexnote/"], ["Inko", "/inko/"], ["Mission Control", "https://work-kohl-kappa.vercel.app"]]) {
    const a = el("a", "quick-link", label);
    a.href = href;
    if (/^https?:/.test(href)) { a.target = "_blank"; a.rel = "noopener"; }
    a.append(el("span", null, "->"));
    links.body.append(a);
  }
  root.append(links.wrap);

  if (ctxRef && ctxRef.boardApi && ctxRef.boardApi.setCount) ctxRef.boardApi.setCount("overview", open.length || "");
}

const onOverview = (e) => { overview = e.detail; render(); };
const onSchedule = (e) => { schedule = e.detail; render(); };

let tabWatch = null;

export async function mount(container, ctx) {
  root = container;
  ctxRef = ctx;
  render();
  const app = document.getElementById("board-app");
  if (app) {
    tabWatch = new MutationObserver(() => render());
    tabWatch.observe(app, { attributes: true, attributeFilter: ["data-tab"] });
  }
  window.addEventListener("board:overview", onOverview);
  window.addEventListener("board:schedule", onSchedule);
  try {
    const [o, s] = await Promise.all([ctx.store.load("board-overview"), ctx.store.load("board-schedule")]);
    if (root !== container) return;
    overview = o;
    schedule = s;
    render();
    unlisteners.push(ctx.store.listen("board-overview", (v) => { if (v) { overview = v; render(); } }));
    unlisteners.push(ctx.store.listen("board-schedule", (v) => { if (v) { schedule = v; render(); } }));
  } catch (err) {
    console.warn("board rail: could not read today", err);
  }
}

export function unmount() {
  if (tabWatch) { tabWatch.disconnect(); tabWatch = null; }
  window.removeEventListener("board:overview", onOverview);
  window.removeEventListener("board:schedule", onSchedule);
  for (const u of unlisteners.splice(0)) { try { u(); } catch (err) { void err; } }
  clearInterval(clockTimer);
  if (root) root.replaceChildren();
  root = null;
  ctxRef = null;
  overview = null;
  schedule = null;
}
