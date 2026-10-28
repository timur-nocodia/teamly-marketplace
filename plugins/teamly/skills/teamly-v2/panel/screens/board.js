// BOARD: the team's work as a Trello-like board, next to the Office view of the same floor.
// Top: today — the coordinator's plan for the day, what's on you right now, and who is doing what.
// Columns: To do → In progress → Done; one card per AGENT step of every task (from each task's STATUS.md).
// Your steps are not cards: when the work waits for you, a yellow "Needs you" hangs under the card of the agent who
// waits (with "I did it" — the prompt is copied, the chat opens). "Optimize without me" asks the coordinator to cut
// those steps. Cards move by themselves as STATUS.md changes; a card that just moved is highlighted.
import { liveSteps, openStep } from "./now.js";

const COLUMNS = [
  { id: "todo", label: "To do", head: "text-foreground/55", dot: "bg-foreground/25" },
  { id: "doing", label: "In progress", head: "text-emerald-700", dot: "bg-emerald-500" },
  { id: "done", label: "Done", head: "text-[#4f5bd5]", dot: "bg-[#4f5bd5]" },
];
const columnOf = (st) => (st === "done" ? "done" : st === "working" || st === "failed" || st === "paused" ? "doing" : "todo");
const clean = (line = "") => String(line).replace(/^(done|working|waiting for you|waiting|failed|paused|готово|в работе|пауза|ждём|ждем)\s*[\d:]*\s*[:—-]?\s*/i, "").trim();
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };  // local date, as the coordinator writes it

// Every agent step of every task, as cards. A human step that waits ("waiting for you: …") is not a card: it hangs
// as a yellow warning under the agent who is next in line in that task (or the last one, if the human step ends it).
function cards(ctx, team) {
  const out = [];
  for (const task of team.tasks ?? []) {
    if (!task.status?.rows?.length) continue;
    const steps = liveSteps({ ...team, task });
    const mine = [];
    let ask = null;
    steps.forEach((s, i) => {
      const row = { status: s.line, file: s.fileName, who: s.who };  // each step carries its own row: never index by position
      const n = s.step ?? i + 1;
      if (s.slug === "you") {
        if (s.status === "needs_you") ask = { step: n, what: clean(row.status ?? "") || "your step" };
        return;
      }
      const ta = (team.agents ?? []).find((a) => a.slug === s.slug);
      mine.push({
        key: `${task.slug}:${i}`, task: task.slug, taskTitle: (task.title ?? task.slug).replace(/^(Task|Задача):\s*/i, ""), started: task.status?.started ?? "",
        step: n, slug: s.slug, col: columnOf(s.status), status: s.status,
        name: ta?.name ?? ctx.A.agentBySlug[s.slug]?.name ?? row.who ?? s.slug,
        sprite: ta?.card?.sprite ?? ctx.A.agentBySlug[ta?.upstream ?? s.slug]?.sprite ?? ctx.A.spriteFor(s.slug),
        role: ta?.role ?? ctx.A.agentBySlug[s.slug]?.role ?? "",
        line: clean(row.status ?? ""), file: s.file?.path ?? null, fileName: s.file?.name ?? row.file ?? "",
        doneAt: s.status === "done" ? (/(\d{1,2}:\d{2})/.exec(row.status ?? "")?.[1] ?? null) : null,
        // agents can also ask you themselves ("waiting for you" on their own row)
        ask: s.status === "needs_you" ? { step: n, what: clean(row.status ?? ""), agent: true } : null,
      });
    });
    if (ask) (mine.find((c) => c.col !== "done") ?? mine.at(-1) ?? {}).ask ??= ask;
    out.push(...mine);
  }
  return out;
}

// Optimization proposals the coordinator wrote (team.optimize): the path with you and without you side by side,
// how it would work, what you gain and lose, the risk, and the test that decides — never a silent switch.
const RISK = { low: "bg-emerald-50 text-emerald-700", medium: "bg-amber-50 text-amber-800", high: "bg-red-50 text-red-700" };
const lane = (ctx, steps, side) => `
  <ol class="flex flex-col gap-1">
    ${(steps ?? []).map((st, i) => {
      const you = /^(you|ты)$/i.test(st.who ?? "");
      const tone = you ? "border-amber-300 bg-amber-50" : st.new ? "border-[#4f5bd5]/50 bg-[#4f5bd5]/[0.06]" : "border-foreground/10 bg-card";
      return `<li class="flex items-start gap-1.5 rounded-lg border ${tone} px-2 py-1.5">
        <span class="mt-[1px] flex size-4 shrink-0 items-center justify-center rounded text-[9px] font-bold ${you ? "bg-amber-400 text-white" : "bg-foreground/10 text-foreground/60"}">${i + 1}</span>
        <span class="min-w-0 flex-1 text-[11.5px] leading-snug"><b>${ctx.esc(st.who ?? "")}</b>${st.new ? ` <span class="rounded bg-[#4f5bd5] px-1 text-[9px] font-semibold text-white">new</span>` : ""}<span class="block text-foreground/60">${ctx.esc(st.does ?? "")}${st.time ? ` · ${ctx.esc(st.time)}` : ""}</span></span>
      </li>`;
    }).join("")}
  </ol>`;
function optimizeHTML(ctx, team) {
  // the coordinator writes these: a list can come as text or one object, and must not take the board down
  const asList = (x) => (Array.isArray(x) ? x : x ? [x] : []);
  const list = asList(team.optimize?.proposals).filter((p) => p && typeof p === "object")
    .map((p) => ({ ...p, pros: asList(p.pros), cons: asList(p.cons), research: asList(p.research), withYou: asList(p.withYou), withoutYou: asList(p.withoutYou) }));
  if (!list.length) return "";
  return `
  <div class="mt-3 flex flex-col gap-3">
    ${list.map((p) => `
    <div class="rounded-xl border-2 border-[#4f5bd5]/30 p-3">
      <div class="flex flex-wrap items-center gap-2">
        <span class="text-[16px]">⚡</span>
        <p class="min-w-0 flex-1 text-[13.5px] font-semibold">Without you: ${ctx.esc(p.touchpoint ?? "")}</p>
        ${p.risk ? `<span class="rounded px-1.5 py-0.5 text-[10.5px] font-semibold ${RISK[p.risk] ?? RISK.medium}">risk: ${ctx.esc(p.risk)}</span>` : ""}
        <span class="rounded bg-muted px-1.5 py-0.5 text-[10.5px] text-foreground/60">${ctx.esc(p.status ?? team.optimize.status ?? "proposed")}</span>
      </div>
      ${p.ask ? `<p class="mt-1 text-[12px] italic text-foreground/55">“${ctx.esc(p.ask)}”</p>` : ""}
      <div class="mt-2.5 grid gap-2 min-[520px]:grid-cols-2">
        <div><p class="${ctx.LABEL} mb-1.5">With you</p>${lane(ctx, p.withYou)}</div>
        <div><p class="${ctx.PX} mb-1.5 text-[7px] text-[#4f5bd5]">Without you</p>${lane(ctx, p.withoutYou)}</div>
      </div>
      ${p.how ? `<p class="mt-2.5 text-[12px] leading-snug"><b>How it works:</b> ${ctx.esc(p.how)}</p>` : ""}
      <div class="mt-2 grid gap-2 min-[520px]:grid-cols-2">
        <div class="rounded-lg bg-emerald-50 px-2.5 py-2"><p class="text-[11px] font-semibold text-emerald-700">What you gain</p>${(p.pros ?? []).map((x) => `<p class="mt-0.5 text-[11.5px] leading-snug">+ ${ctx.esc(x)}</p>`).join("")}</div>
        <div class="rounded-lg bg-red-50 px-2.5 py-2"><p class="text-[11px] font-semibold text-red-700">What you lose</p>${(p.cons ?? []).map((x) => `<p class="mt-0.5 text-[11.5px] leading-snug">− ${ctx.esc(x)}</p>`).join("")}</div>
      </div>
      <p class="mt-2 text-[11.5px] text-foreground/65">${[p.saves ? `Saves: ${ctx.esc(p.saves)}` : "", p.cost ? `Cost: ${ctx.esc(p.cost)}` : ""].filter(Boolean).join(" · ")}</p>
      ${p.test ? `<p class="mt-1 rounded-lg border border-dashed border-[#4f5bd5]/40 px-2.5 py-1.5 text-[11.5px] leading-snug"><b>Test first:</b> ${ctx.esc(String(p.test.runs ?? 3))} tasks without you${p.test.compare ? ` — compare ${ctx.esc(p.test.compare)}` : ""}${p.test.rollback ? `. Undo: ${ctx.esc(p.test.rollback)}` : ""}</p>` : ""}
      ${(p.research ?? []).length ? `<details class="mt-2"><summary class="cursor-pointer text-[11px] text-foreground/50">What the coordinator checked (${p.research.length})</summary>${p.research.map((r) => `<p class="mt-1 text-[11px] leading-snug text-foreground/65">${ctx.esc(r.finding ?? "")} <span class="text-foreground/40">— ${ctx.esc(r.source ?? "")}${r.date ? `, ${ctx.esc(r.date)}` : ""}</span></p>`).join("")}</details>` : ""}
      ${(p.status ?? "proposed") === "proposed" ? `<button data-opt-test="${ctx.esc(p.id ?? "")}" class="mt-2.5 w-full rounded-lg bg-[#4f5bd5] py-2 text-[12px] font-semibold text-white hover:bg-[#3f4bc5]">Run the test — in the coordinator's chat</button>` : ""}
    </div>`).join("")}
  </div>`;
}

function cardHTML(ctx, c, moved) {
  const tone = c.ask ? "border-amber-300 bg-card" : c.status === "failed" || c.status === "paused" ? "border-red-300 bg-red-50/60" : "border-foreground/10 bg-card";
  return `
  <div data-card="${ctx.esc(c.key)}" class="rounded-xl border-2 ${tone} p-2.5 shadow-[0_1px_0_rgba(0,0,0,.04)] transition ${moved ? "ring-2 ring-[#4f5bd5]/50 animate-[fadeSlideUp_0.4s_ease-out_both]" : ""}">
    <p class="truncate text-[10.5px] text-foreground/45">${ctx.esc(c.taskTitle)} · step ${c.step}</p>
    <div class="mt-1.5 flex items-center gap-2">
      <img src="./assets/agents/${c.sprite}.png" alt="" class="size-8 shrink-0 object-contain" />
      <span class="min-w-0 flex-1"><span class="block truncate text-[13px] font-semibold">${ctx.esc(c.name)}</span><span class="block truncate text-[10.5px] text-foreground/50">${ctx.esc(c.role)}</span></span>
    </div>
    ${c.line && c.col !== "todo" && c.status !== "needs_you" ? `<p class="mt-1.5 line-clamp-3 text-[11.5px] leading-snug text-foreground/75">${c.status === "working" ? '<span class="mr-1 inline-block size-1.5 animate-pulse rounded-full bg-emerald-500 align-middle"></span>' : ""}${ctx.esc(c.line)}</p>` : ""}
    ${c.status === "failed" || c.status === "paused" ? `<p class="mt-1 text-[11px] font-semibold text-red-600">${c.status === "failed" ? "Failed" : "Paused"}</p>` : ""}
    ${c.status === "failed" ? `<button data-card-bug="${ctx.esc(c.key)}" class="mt-1 text-[11px] text-[#4f5bd5] underline">Report to the founder</button>` : ""}
    <div class="mt-2 flex items-center gap-2">
      ${c.file ? `<button data-card-file="${ctx.esc(c.file)}" class="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-[#4f5bd5] hover:bg-[#4f5bd5]/10">${ctx.icon("file", "size-3")}${ctx.esc(c.fileName)}</button>` : c.fileName ? `<span class="text-[10.5px] text-foreground/35">${ctx.esc(c.fileName)}</span>` : ""}
      ${c.doneAt ? `<span class="ml-auto text-[10.5px] text-foreground/40">${c.doneAt}</span>` : ""}
    </div>
    ${c.ask ? `
    <div class="-mx-2.5 -mb-2.5 mt-2.5 rounded-b-[10px] border-t-2 border-amber-300 bg-amber-50 px-2.5 py-2">
      <p class="flex items-start gap-1.5 text-[11.5px] leading-snug text-amber-950"><span class="mt-[1px] flex size-4 shrink-0 items-center justify-center rounded-full bg-amber-400 text-[10px] font-black text-white">!</span><span><b>Needs you:</b> ${ctx.esc(c.ask.what)}</span></p>
      ${c.ask.agent  // the agent asked a question: the answer goes in the chat, it isn't a step the person did
        ? `<button data-card-answer="${ctx.esc(c.key)}" class="mt-1.5 w-full rounded-md bg-amber-400 py-1 text-[11px] font-semibold text-white hover:bg-amber-500">Answer in the team's chat</button>`
        : `<button data-card-done="${ctx.esc(c.key)}" class="mt-1.5 w-full rounded-md bg-amber-400 py-1 text-[11px] font-semibold text-white hover:bg-amber-500">I did it — tell the coordinator</button>`}
    </div>` : ""}
  </div>`;
}

export function boardHTML(ctx, team) {
  const l = ctx.local("board");
  const all = cards(ctx, team);
  // a card whose column changed since the last look gets highlighted once
  const prev = l.cols ?? {};
  const moved = new Set(all.filter((c) => prev[c.key] && prev[c.key] !== c.col).map((c) => c.key));
  l.cols = Object.fromEntries(all.map((c) => [c.key, c.col]));
  const onYou = all.filter((c) => c.ask);
  const doing = all.filter((c) => c.col === "doing");
  const people = (team.agents ?? []).map((a) => a.slug).map((slug) => {
    const mine = all.filter((c) => c.slug === slug);
    const now = mine.find((c) => c.col === "doing") ?? null;
    const done = mine.filter((c) => c.col === "done").length;
    const waits = mine.find((c) => c.ask);
    const ta = team.agents.find((a) => a.slug === slug);
    return { slug, card: now, waits, done, ready: !!ta?.share?.ready, name: ta?.name ?? slug, sprite: mine[0]?.sprite ?? ctx.A.agentBySlug[slug]?.sprite ?? ctx.A.spriteFor(slug) };
  });
  // how often the work stops for you: human steps in the latest task's chain
  const lastTask = (team.tasks ?? []).find((x) => x.active) ?? (team.tasks ?? [])[0];
  const touches = (lastTask?.status?.rows ?? []).filter((r) => /^(you|ты)(?=[\s(:]|$)|игорь|take/i.test(r.who ?? "")).length;
  const plan = team.today?.date === today() ? team.today.plan : null;
  const dateLabel = new Date().toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  return `
  <div class="mt-3 rounded-xl border-2 border-foreground/10 p-3">
    <div class="flex items-baseline justify-between gap-2"><p class="${ctx.PX} text-[9px]">Today</p><span class="text-[11px] text-foreground/45">${dateLabel}</span></div>
    <p class="mt-1.5 text-[12.5px] leading-snug ${plan ? "" : "text-foreground/50"}">${plan ? ctx.esc(plan) : "No plan for today yet — the coordinator makes it with your first message of the day."}</p>
    ${onYou.length
      ? `<button data-on-you class="mt-2.5 flex w-full items-center gap-2 rounded-lg border-2 border-amber-400 bg-amber-50 px-2.5 py-2 text-left hover:bg-amber-100"><span class="flex size-6 shrink-0 items-center justify-center rounded-full bg-amber-400 text-[13px] font-black text-white">!</span><span class="min-w-0 flex-1 text-[12.5px] text-amber-950"><b>Needs you:</b> ${ctx.esc(onYou[0].ask.what)}</span>${ctx.icon("chevronRight", "size-4 text-amber-700")}</button>`
      : `<p class="mt-2.5 rounded-lg bg-muted px-2.5 py-2 text-[12.5px] text-foreground/65">Nothing on you right now${doing.length ? ` — ${ctx.esc(doing.map((c) => c.name).join(", "))} ${doing.length === 1 ? "is" : "are"} working` : ""}.</p>`}
    <div class="mt-3 flex flex-col gap-1.5">
      ${people.map((p) => `
      <div class="flex items-center gap-2">
        <img src="./assets/agents/${p.sprite}.png" alt="" class="size-7 shrink-0 object-contain" />
        <span class="w-[110px] shrink-0 truncate text-[12px] font-semibold">${ctx.esc(p.name)}</span>
        ${p.ready ? `<span class="shrink-0 rounded bg-emerald-100 px-1 text-[9.5px] font-semibold text-emerald-700">★ share</span>` : ""}
        <span class="size-1.5 shrink-0 rounded-full ${p.card ? "animate-pulse bg-emerald-500" : p.waits ? "bg-amber-400" : "bg-foreground/20"}"></span>
        <span class="min-w-0 flex-1 truncate text-[11.5px] ${p.waits && !p.card ? "text-amber-700" : "text-foreground/60"}">${p.card ? ctx.esc(p.card.line || p.card.role) : p.waits ? "waits for you" : p.done ? `${p.done} done today` : "free"}</span>
      </div>`).join("")}
    </div>
    <button data-optimize class="mt-3 flex w-full items-center gap-2.5 rounded-lg border-2 border-[#4f5bd5]/40 bg-[#4f5bd5]/[0.05] px-2.5 py-2 text-left hover:border-[#4f5bd5]">
      <span class="text-[18px]">⚡</span>
      <span class="min-w-0 flex-1"><span class="block text-[12.5px] font-semibold text-[#4f5bd5]">Optimize without me</span><span class="block text-[11px] text-foreground/55">${touches ? `The work stops for you ${touches}× per task. The coordinator finds what can run without you.` : "The coordinator looks for steps that still need you."}</span></span>
      ${ctx.icon("chevronRight", "size-4 text-[#4f5bd5]")}
    </button>
  </div>
  ${optimizeHTML(ctx, team)}
  <div data-keep-x="board" class="-mx-4 mt-3 overflow-x-auto px-4 pb-2">
    <div class="flex gap-2.5" style="min-width:max-content">
      ${COLUMNS.map((col) => {
        const list = all.filter((c) => c.col === col.id);
        return `
        <section class="flex w-[230px] shrink-0 flex-col rounded-xl bg-muted/70 p-2">
          <div class="flex items-center gap-1.5 px-1 pb-2"><span class="size-2 rounded-full ${col.dot}"></span><span class="${ctx.PX} text-[7px] ${col.head}">${col.label}</span><span class="ml-auto text-[11px] text-foreground/45">${list.length}</span></div>
          <div class="flex flex-col gap-2">${list.map((c) => cardHTML(ctx, c, moved.has(c.key))).join("") || `<p class="rounded-lg border-2 border-dashed border-foreground/10 py-4 text-center text-[11px] text-foreground/35">Empty</p>`}</div>
        </section>`;
      }).join("")}
    </div>
  </div>`;
}

export function boardMount(root, ctx, team) {
  const all = cards(ctx, team);
  root.querySelectorAll("[data-card-file]").forEach((b) => { b.onclick = () => openStep(ctx, b.dataset.cardFile, true); });
  const tellDone = (c) => {
    const prompt = `Teamly: done — ${c.taskTitle} (${c.task}), step ${c.ask?.step ?? c.step}`;  // the person's step; the folder tells days apart
    navigator.clipboard?.writeText(prompt).catch(() => {});
    if (team.coordinator_session) ctx.A.live.openChat(team.coordinator_session).then(() => ctx.toast("Copied — paste it in the chat")).catch(() => ctx.toast(`Copied: ${(prompt)}`));
    else ctx.toast(`Copied: ${(prompt)} — paste it in the team's chat`);
  };
  root.querySelectorAll("[data-card-bug]").forEach((b) => {
    b.onclick = () => {
      const c = all.find((x) => x.key === b.dataset.cardBug);
      if (!c) return;
      const prompt = `Teamly: report a bug — ${c.taskTitle} (${c.task}), step ${c.step} (${c.name} failed)`;
      navigator.clipboard?.writeText(prompt).catch(() => {});
      if (team.coordinator_session) ctx.A.live.openChat(team.coordinator_session).then(() => ctx.toast("Copied — paste it in the coordinator's chat")).catch(() => ctx.toast(`Copied: ${prompt}`));
      else ctx.toast(`Copied: ${prompt} — paste it in the team's chat`);
    };
  });
  root.querySelectorAll("[data-card-done]").forEach((b) => { b.onclick = () => { const c = all.find((x) => x.key === b.dataset.cardDone); if (c) tellDone(c); }; });
  root.querySelectorAll("[data-card-answer]").forEach((b) => {
    b.onclick = () => {
      if (team.coordinator_session) ctx.A.live.openChat(team.coordinator_session).catch(() => ctx.toast("Open the team's chat in the sidebar to answer"));
      else ctx.toast("Open the team's chat in the sidebar to answer");
    };
  });
  root.querySelector("[data-optimize]")?.addEventListener("click", () => {
    const prompt = "Teamly: optimize without me";
    navigator.clipboard?.writeText(prompt).catch(() => {});
    if (team.coordinator_session) ctx.A.live.openChat(team.coordinator_session).then(() => ctx.toast("Copied — paste it in the coordinator's chat")).catch(() => ctx.toast(`Copied: ${prompt}`));
    else ctx.toast(`Copied: ${prompt} — paste it in the team's chat`);
  });
  root.querySelectorAll("[data-opt-test]").forEach((b) => {
    b.onclick = () => {
      const prompt = `Teamly: test optimization ${b.dataset.optTest}`;
      navigator.clipboard?.writeText(prompt).catch(() => {});
      if (team.coordinator_session) ctx.A.live.openChat(team.coordinator_session).then(() => ctx.toast("Copied — paste it in the coordinator's chat")).catch(() => ctx.toast(`Copied: ${prompt}`));
      else ctx.toast(`Copied: ${prompt} — paste it in the team's chat`);
    };
  });
  root.querySelector("[data-on-you]")?.addEventListener("click", () => {
    if (team.coordinator_session) ctx.A.live.openChat(team.coordinator_session).catch(() => ctx.toast("Open the team's chat in the sidebar"));
  });
}
