// OVERVIEW: one read-only picture of an office, across its floors — the plan (what waits for you, what runs, today),
// the goals with their deadlines, and a report per team. Opened from under a building, it covers that office only:
// another person's office keeps its own plan. Nothing here changes anything: a tap on a team just opens its floor.
import { BANG } from "./office.js";
import { statusWord } from "./now.js";
import { cadenceLabel, latestReports, mountReports } from "./reports.js";

export const MODES = [["plan", "Plan", "list"], ["goals", "Goals", "target"], ["report", "Report", "chart"]];

const CARD = "border-2 border-foreground/10 bg-card";
const CHIP = {
  done: ["border-emerald-300 bg-emerald-50 text-emerald-800", (ctx) => ctx.icon("check", "size-3")],
  working: ["border-[#4f5bd5]/40 bg-[#4f5bd5]/[0.06] text-[#4f5bd5]", () => '<span class="size-1.5 animate-pulse rounded-full bg-[#4f5bd5]"></span>'],
  you: ["border-amber-400 bg-amber-50 text-amber-900", () => `<span class="grid size-3.5 place-items-center rounded-full bg-amber-400 text-white">${BANG("size-2.5")}</span>`],
  failed: ["border-red-300 bg-red-50 text-red-700", (ctx) => ctx.icon("alert", "size-3")],
  waiting: ["border-foreground/15 bg-card text-foreground/50", () => '<span class="size-1.5 rounded-full bg-foreground/25"></span>'],
};
const list = (x) => (Array.isArray(x) ? x : []);

// A task's steps as STATUS.md has them (a step whose file is there counts as done).
export function stepsOf(task) {
  const files = list(task?.files).map((f) => String(f?.name ?? ""));
  const has = (p) => !!p && files.some((n) => (p.includes("*") ? n.startsWith(p.replace("*", "")) : n === p));
  return list(task?.status?.rows).map((r) => {
    const s = String(r?.status ?? "");
    // what STATUS.md says wins (the same rule as the floor: its first word decides); the file counts only otherwise
    const said = { done: "done", needs_you: "you", working: "working", failed: "failed", paused: "failed" }[statusWord(s)] ?? null;
    const kind = said ?? (has(String(r?.file ?? "")) ? "done" : "waiting");
    return { who: String(r?.who ?? ""), kind, text: s.replace(/^waiting for you:\s*/i, "") };
  });
}

const chain = (ctx, steps) => `
  <div class="mt-2 flex flex-wrap items-center gap-1">
    ${steps.map((s, i) => {
      const [tone, mark] = CHIP[s.kind] ?? CHIP.waiting;
      return `${i ? ctx.icon("chevronRight", "size-3 shrink-0 text-foreground/25") : ""}<span class="flex items-center gap-1 border px-1.5 py-0.5 text-[11px] ${tone}">${mark(ctx)}${ctx.esc(s.who)}</span>`;
    }).join("")}
  </div>`;

const bar = (done, total) => `<div class="mt-2 h-1 bg-foreground/10"><div class="h-full bg-[#4f5bd5]" style="width:${Math.round((done / Math.max(1, total)) * 100)}%"></div></div>`;
// the office the overview was opened under (none when there is only one, or it is gone)
const officeOf = (ctx) => (list(ctx.S.offices).length > 1 ? list(ctx.S.offices).find((o) => o.id === ctx.ui.overviewOffice) ?? null : null);
const where = (ctx, t) => ctx.esc(t.name ?? t.slug);
const teams = (ctx) => list(ctx.S.teams).filter((t) => t && !t.setupPending && (!officeOf(ctx) || t.office === officeOf(ctx).id));
const openTasks = (t) => list(t.tasks).filter((x) => x && !x.complete);
const heading = (ctx, text, n = "") => `<div class="mt-6 flex items-baseline justify-between"><p class="${ctx.LABEL}">${text}</p>${n !== "" ? `<span class="text-[11px] text-foreground/45">${n}</span>` : ""}</div>`;
const quiet = (text) => `<p class="mt-2 text-[12.5px] text-foreground/50">${text}</p>`;

function plan(ctx) {
  const waiting = [], running = [], today = [];
  for (const t of teams(ctx)) {
    for (const task of openTasks(t)) {
      const steps = stepsOf(task);
      const you = steps.findIndex((s) => s.kind === "you");
      if (you >= 0) waiting.push({ t, task, step: you + 1, total: steps.length, what: steps[you].text });
      running.push({ t, task, steps });
    }
    const plan = typeof t.today?.plan === "string" ? [t.today.plan] : list(t.today?.plan);  // SKILL.md writes one line
    for (const item of plan) today.push({ t, item: typeof item === "string" ? item : item?.title ?? item?.what ?? "" });
  }
  return `
    ${heading(ctx, "Waiting for you", waiting.length)}
    ${waiting.length ? `<div class="mt-2 flex flex-col gap-2">${waiting.map(({ t, task, step, total, what }) => `
      <button data-floor="${ctx.esc(t.slug)}" class="flex w-full items-start gap-2.5 border-2 border-amber-400 bg-amber-50 px-3 py-2.5 text-left hover:bg-amber-100">
        <span class="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-amber-400 text-white">${BANG("size-3")}</span>
        <span class="min-w-0 flex-1">
          <span class="${ctx.PX} block truncate text-[7px] leading-relaxed text-amber-900">${where(ctx, t)} · step ${step} of ${total}</span>
          <span class="mt-0.5 block text-[12.5px] leading-snug text-amber-950">${ctx.esc(what || task.title || "Your step")}</span>
        </span>
      </button>`).join("")}</div>` : quiet("Nothing waits for you.")}
    ${heading(ctx, "Running", running.length)}
    ${running.length ? `<div class="mt-2 flex flex-col gap-2">${running.map(({ t, task, steps }) => {
      const done = steps.filter((s) => s.kind === "done").length;
      return `
      <button data-floor="${ctx.esc(t.slug)}" class="${CARD} w-full p-3 text-left hover:border-[#4f5bd5]/40">
        <span class="flex items-baseline justify-between gap-2"><span class="${ctx.PX} truncate text-[7px] text-foreground/50">${where(ctx, t)}</span><span class="shrink-0 text-[11px] text-foreground/50">${done}/${steps.length}</span></span>
        <span class="mt-1 block text-[13px] font-semibold leading-snug">${ctx.esc(String(task.title ?? task.name ?? "").replace(/^task:\s*/i, ""))}</span>
        ${bar(done, steps.length)}
        ${chain(ctx, steps)}
        ${task.status?.now ? `<span class="mt-2 block text-[12px] leading-snug text-foreground/70"><b>Now:</b> ${ctx.esc(task.status.now)}</span>` : ""}
        ${task.status?.next ? `<span class="mt-0.5 block text-[12px] leading-snug text-foreground/50"><b>Next:</b> ${ctx.esc(task.status.next)}</span>` : ""}
      </button>`;
    }).join("")}</div>` : quiet("No task is running. Start one in a team's chat.")}
    ${today.length ? `${heading(ctx, "Today", today.length)}<div class="${CARD} mt-2 flex flex-col divide-y divide-foreground/10">${today.map(({ t, item }) => `
      <p class="px-3 py-2 text-[12.5px] leading-snug"><span class="${ctx.PX} mr-1.5 text-[6.5px] text-foreground/45">${ctx.esc(t.name ?? t.slug)}</span>${ctx.esc(item)}</p>`).join("")}</div>` : ""}`;
}

// whole days to a deadline, counted on the person's own calendar: "2026-11-22" is that day where they are, not UTC
function daysLeft(deadline) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(deadline ?? "").trim());
  const d = m ? new Date(+m[1], +m[2] - 1, +m[3]).getTime() : Date.parse(deadline ?? "");
  if (!Number.isFinite(d)) return null;
  const now = new Date();
  return Math.round((d - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / 86_400_000);
}

function goals(ctx) {
  const all = teams(ctx).flatMap((t) => list(t.goals).filter((g) => g && typeof g === "object").map((g) => ({ t, g, left: daysLeft(g.deadline) })))
    .sort((a, b) => (a.left ?? 1e9) - (b.left ?? 1e9));
  if (!all.length) return `${heading(ctx, "Goals")}${quiet("No goals yet. Set one in a team's chat: “Teamly: new goal”.")}`;
  return `
    ${heading(ctx, "Goals", all.length)}
    <div class="mt-2 flex flex-col gap-2">${all.map(({ t, g, left }) => {
      const total = Number(g.targetCount ?? 0);
      const progress = Number(g.progress ?? 0);
      const names = list(g.chain).map((s) => (s === "you" ? "You" : typeof s === "string"
        ? list(t.agents).find((a) => a.slug === s)?.name ?? ctx.A.agentBySlug[s]?.name ?? s : s?.create ?? (s?.who === "you" ? "You" : "")));
      return `
      <button data-floor="${ctx.esc(t.slug)}" class="${CARD} w-full p-3 text-left hover:border-[#4f5bd5]/40">
        <span class="flex items-baseline justify-between gap-2">
          <span class="${ctx.PX} truncate text-[7px] text-foreground/50">${where(ctx, t)}</span>
          ${left === null ? "" : `<span class="${ctx.PX} shrink-0 text-[7px] ${left < 0 ? "text-red-600" : left <= 7 ? "text-amber-700" : "text-foreground/50"}">${left < 0 ? `${-left} d late` : left === 0 ? "due today" : `${left} d left`}</span>`}
        </span>
        <span class="mt-1 block text-[13px] font-semibold leading-snug">${ctx.esc(g.target ?? g.title ?? "")}</span>
        ${g.title && g.target ? `<span class="mt-0.5 block text-[11.5px] text-foreground/55">${ctx.esc(g.title)}</span>` : ""}
        ${total ? `${bar(progress, total)}<span class="mt-1 block text-[11px] text-foreground/50">${progress} of ${total}${g.deadline ? ` · by ${ctx.esc(g.deadline)}` : ""}</span>` : g.deadline ? `<span class="mt-1 block text-[11px] text-foreground/50">by ${ctx.esc(g.deadline)}</span>` : ""}
        ${names.length ? `<span class="mt-2 block text-[11px] text-foreground/50">${names.map((n) => ctx.esc(n)).join(" → ")}</span>` : ""}
      </button>`;
    }).join("")}</div>`;
}

function report(ctx) {
  const all = ctx.S.funnel?.counts ?? {};
  const own = teams(ctx).flatMap((t) => list(t.tasks));
  // one office of several counts its own floors and tasks (ratings belong to agents, wherever they work)
  const c = officeOf(ctx) ? { ...all, floors: teams(ctx).length, agents: teams(ctx).reduce((n, t) => n + list(t.agents).length, 0),
    tasks: own.length, tasksDone: own.filter((x) => x?.complete).length } : all;
  const stat = (n, label) => `<div class="${CARD} px-2 py-2.5 text-center"><p class="${ctx.PX} text-[13px] text-[#0a0a0a]">${n}</p><p class="mt-1.5 text-[10.5px] text-foreground/50">${label}</p></div>`;
  const rows = teams(ctx).map((t) => {
    const tasks = list(t.tasks);
    const done = tasks.filter((x) => x?.complete).length;
    const active = openTasks(t)[0];
    const steps = active ? stepsOf(active) : [];
    const you = steps.some((s) => s.kind === "you");
    const on = steps.find((s) => s.kind === "working") ?? steps.find((s) => s.kind === "you") ?? steps.find((s) => s.kind === "waiting");
    const last = Math.max(0, ...tasks.map((x) => Number(x?.mtime) || 0));
    const g = list(t.goals)[0];
    return `
    <button data-floor="${ctx.esc(t.slug)}" class="${CARD} w-full p-3 text-left hover:border-[#4f5bd5]/40">
      <span class="flex items-center gap-2">
        <span class="min-w-0 flex-1 truncate text-[13.5px] font-semibold">${where(ctx, t)}</span>
        ${you ? `<span class="${ctx.PX} shrink-0 border border-amber-400 bg-amber-50 px-1.5 py-0.5 text-[6.5px] text-amber-800">Needs you</span>` : ""}
      </span>
      <span class="mt-2 flex -space-x-1">${list(t.agents).slice(0, 5).map((a) => ctx.avatar(a.card?.sprite ?? ctx.A.agentBySlug[a.slug]?.sprite, "size-6")).join("")}</span>
      <span class="mt-2 grid grid-cols-3 gap-2 text-[11.5px]">
        <span><span class="block text-foreground/45">Agents</span><b>${list(t.agents).length}</b></span>
        <span><span class="block text-foreground/45">Tasks done</span><b>${done}/${tasks.length}</b></span>
        <span><span class="block text-foreground/45">Last work</span><b>${last ? ctx.esc(ctx.minsAgo(last * 1000)) : "—"}</b></span>
      </span>
      ${active ? `<span class="mt-2 block text-[12px] leading-snug text-foreground/70"><b>Now:</b> ${ctx.esc(String(active.title ?? active.name ?? "").replace(/^task:\s*/i, ""))}${on ? ` · ${ctx.esc(on.kind === "you" ? "your step" : on.who)}` : ""}</span>` : `<span class="mt-2 block text-[12px] text-foreground/50">No task running</span>`}
      ${g ? `<span class="mt-1 block text-[12px] leading-snug text-foreground/55"><b>Goal:</b> ${ctx.esc(g.target ?? g.title ?? "")}${g.targetCount ? ` · ${Number(g.progress ?? 0)} of ${Number(g.targetCount)}` : ""}</span>` : ""}
      <span class="mt-1 block text-[12px] leading-snug text-foreground/55"><b>Reports:</b> ${ctx.esc(cadenceLabel(t.reports) ?? "not set up")}${list(t.reportFiles)[0] ? ` · last ${ctx.esc(t.reportFiles[0].date)}` : ""}</span>
    </button>`;
  });
  return `
    <div class="mt-4 grid grid-cols-2 gap-2 min-[480px]:grid-cols-4">
      ${stat(c.floors ?? teams(ctx).length, "floors")}${stat(c.agents ?? 0, "agents")}
      ${stat(`${c.tasksDone ?? 0}/${c.tasks ?? 0}`, "tasks done")}${stat(c.avgStars ? `${c.avgStars}★` : "—", `${c.ratings ?? 0} ratings`)}
    </div>
    ${latestReports(ctx, teams(ctx)) ? `${heading(ctx, "Latest reports")}<div class="mt-2">${latestReports(ctx, teams(ctx))}</div>` : ""}
    ${heading(ctx, "By team", rows.length)}
    ${rows.length ? `<div class="mt-2 flex flex-col gap-2">${rows.join("")}</div>` : quiet("No teams yet.")}`;
}

export function render(ctx) {
  const mode = MODES.some(([id]) => id === ctx.ui.overview) ? ctx.ui.overview : "plan";
  const office = officeOf(ctx);
  return `
  <div class="px-4 pb-24 pt-4">
    <button data-back class="${ctx.PX} flex items-center gap-1 text-[7px] text-foreground/50 hover:text-[#4f5bd5]">${ctx.icon("arrowLeft", "size-3")} Office</button>
    <p class="${ctx.PX} mt-3 truncate text-[11px]">${office ? ctx.esc(office.name) : "Overview"}</p>
    <div class="mt-3 flex gap-1 rounded-lg bg-muted p-1">
      ${MODES.map(([id, label, ic]) => `<button data-mode="${id}" class="flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-[12.5px] ${id === mode ? "bg-card font-semibold text-foreground shadow-sm" : "text-foreground/55 hover:text-foreground"}">${ctx.icon(ic, "size-3.5")}${label}</button>`).join("")}
    </div>
    ${mode === "goals" ? goals(ctx) : mode === "report" ? report(ctx) : plan(ctx)}
  </div>`;
}

export function mount(root, ctx) {
  root.querySelector("[data-back]").onclick = () => ctx.go("teams");
  root.querySelectorAll("[data-mode]").forEach((b) => { b.onclick = () => { ctx.ui.overview = b.dataset.mode; ctx.saveUI(); ctx.rerender(); }; });
  root.querySelectorAll("[data-floor]").forEach((b) => { b.onclick = () => { ctx.ui.teamSlug = b.dataset.floor; ctx.saveUI(); ctx.go("team"); }; });
  mountReports(root, ctx);   // here only to read a report
}
