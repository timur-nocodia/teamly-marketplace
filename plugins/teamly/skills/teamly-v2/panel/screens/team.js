// TEAM: the result of onboarding is a PACKED TEAM. The coordinator runs onboarding in the chat
// (4 questions, optional analysis of your sessions) and writes ~/.teamly/onboarding.json at every step.
// This screen only shows where you are and what is already assembled — it never asks anything.
// Steps: start → analysis → jobs → team → packaged → started (then: team seats + the work below).
import * as now from "./now.js";
import * as office from "./office.js";
import { boardHTML, boardMount } from "./board.js";
import { siteFloor, BUILD, BUILD_AT, chainAgents } from "./teams.js";
import { reportsBlock, mountReports } from "./reports.js";

const SEATS = 3;
const STEPS = [["area", "Area"], ["goal", "Goal"], ["approaches", "Approaches"], ["fork", "Agents"], ["packaged", "Ready"]];
const STEP_INDEX = { start: 0, area: 1, goal: 2, now: 2, analysis: 2, jobs: 2, approaches: 2, match: 2, ontology: 3, fork: 3, forge: 3, team: 4, packaged: 4, started: 5 };

function onboarding(ctx) { return ctx.S.onboarding ?? ctx.ui.mockOb ?? null; }
// lists the coordinator writes can arrive as one string: show it, never crash on it
const arr = (x) => (Array.isArray(x) ? x : x ? [String(x)] : []);

function liveTeamRec(ctx) {
  const slug = ctx.ui.teamSlug ?? ctx.S.onboarding?.team?.slug;
  return slug ? (ctx.S.teams ?? []).find((t) => t.slug === slug) ?? null : null;
}
function inSetup(ctx) {
  const ob = onboarding(ctx);
  return !!ob && ob.step !== "started" && (!ctx.ui.teamSlug || ob.team?.slug === ctx.ui.teamSlug);
}

function members(ctx) {
  const ob = onboarding(ctx);
  if (ob?.step === "started" && ob.team?.agents) return ob.team.agents.map((x) => agentView(ctx, x));
  return ctx.A.AGENTS.filter((a) => ctx.isHired(a.slug));
}

// A team member: catalog card if we have one, otherwise what the coordinator wrote (agents built from your chats).
function agentView(ctx, x) {
  const c = ctx.A.agentBySlug[x.slug];
  const sprite = [x.sprite, c?.sprite].find((v) => typeof v === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(v)) ?? null;  // files from others
  return { slug: x.slug, name: x.name ?? c?.name ?? x.slug, role: x.role ?? c?.role ?? "", sprite, why: x.why ?? ctx.A.WHY[x.slug] ?? "", source: x.source ?? (c ? "catalog" : "built"), builtFrom: x.builtFrom, cost: c?.cost ?? x.cost ?? 0 };
}

function header(ctx, count) {
  const ob = onboarding(ctx);
  const live = liveTeamRec(ctx);
  const name = live?.name ?? ob?.team?.name ?? ctx.ui.teamName ?? (ctx.ui.dept ? ctx.A.teamById[ctx.ui.dept]?.name : null) ?? "New team";
  // a working floor can go to someone else as one file: its agents and recipe, never its tasks, ratings or chats
  const share = live && (live.agents ?? []).length && !live.setupPending
    ? `<button data-share-team title="Send this team to someone as a file or a link" class="flex items-center gap-1 rounded-md border border-foreground/12 px-2 py-1 text-[11px] text-foreground/65 hover:border-[#4f5bd5]/40 hover:text-[#4f5bd5]">${ctx.icon("external", "size-3")} Share</button>` : "";
  return `
  <div class="flex items-center gap-2">
    <p class="${ctx.PX} min-w-0 truncate text-[11px]">${ctx.esc(name)}</p>
    <button data-rename aria-label="Rename team" class="rounded p-1 text-foreground/35 hover:bg-muted hover:text-foreground">${ctx.icon("pencil", "size-3")}</button>
    <span class="${ctx.PX} ml-auto text-[7px] text-foreground/40">${count} agents</span>
    ${share}
  </div>`;
}

function stepper(ctx, ob) {
  const cur = STEP_INDEX[ob?.step ?? "start"] ?? 0;
  return `
  <div class="mt-4 flex items-center gap-1.5">
    ${STEPS.map(([, label], i) => `
      <div class="flex min-w-0 flex-1 flex-col gap-1.5">
        <div class="h-1.5 rounded-full ${i < cur ? "bg-[#4f5bd5]" : i === cur ? "bg-[#4f5bd5]/50 animate-pulse" : "bg-foreground/10"}"></div>
        <span class="${ctx.PX} truncate text-[6px] ${i <= cur ? "text-[#4f5bd5]" : "text-foreground/35"}">${i + 1}. ${label}</span>
      </div>`).join("")}
  </div>`;
}

const toChat = (ctx, text) => `
  <div class="mt-3 flex items-center gap-2 rounded-lg bg-[#4f5bd5] px-3 py-2.5 text-[13px] font-medium text-white">
    ${ctx.icon("arrowLeft", "size-4 shrink-0")}<span>${text}</span>
  </div>`;

function avatarOf(ctx, a, cls) {
  return a.sprite ? ctx.avatar(a.sprite, cls) : `<img src="./assets/agents/create-agent-silhouette.png" alt="" class="${cls} shrink-0 rounded-md border-2 border-dashed border-[#4f5bd5]/40 bg-[#4f5bd5]/5 object-contain p-0.5" />`;
}
const sourceBadge = (ctx, a) => a.source === "built"
  ? `<span class="${ctx.PX} rounded bg-amber-100 px-1 py-0.5 text-[5px] text-amber-700">Built from ${ctx.esc(a.builtFrom ?? "your")} chats</span>`
  : `<span class="${ctx.PX} rounded bg-[#4f5bd5]/10 px-1 py-0.5 text-[5px] text-[#4f5bd5]">Catalog</span>`;

// ---------------------------------------------------------------- onboarding views
function viewStart(ctx) {
  const steps = [
    ["Your goal", "What you want to achieve, measurable, with a date"],
    ["How you go now", "What works, what blocks you, what you already have"],
    ["How others reach it", "Approaches from the library you haven't thought of, with proof"],
    ["Made yours, then a team", "Agents tuned to your voice and rules, working toward the goal"],
  ];
  return `
  <div class="${ctx.CARD} mt-4 p-4 text-center animate-[fadeSlideUp_0.4s_ease-out_both]">
    <img src="./assets/agents/formal01.png" alt="" class="mx-auto size-20 object-contain animate-[pixelBob_3s_ease-in-out_infinite]" />
    <p class="mt-2 text-[16px] font-semibold">Onboarding happens in the chat</p>
    <p class="mt-1 text-[13px] text-muted-foreground">The coordinator is asking you a few questions on the left. Your team appears here.</p>
    ${toChat(ctx, "Answer the coordinator in the chat")}
  </div>
  <div class="mt-4 flex flex-col gap-2">
    ${steps.map(([t, s], i) => `
    <div class="flex items-start gap-3 rounded-xl border-2 border-foreground/10 p-3">
      <span class="${ctx.PX} flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-[8px] text-foreground/60">${i + 1}</span>
      <div><p class="text-[13px] font-medium">${t}</p><p class="text-[11px] text-foreground/50">${s}</p></div>
    </div>`).join("")}
  </div>
  <button data-gallery class="${ctx.PX} mt-4 w-full py-2 text-[7px] text-foreground/40 hover:text-foreground/70">Or browse agents in the gallery</button>`;
}

function goalHeader(ctx, g, progress) {
  if (!g) return "";
  const p = progress && g.targetCount ? Math.min(100, Math.round((progress / g.targetCount) * 100)) : null;
  return `
  <div class="mt-4 rounded-xl border-2 border-[#4f5bd5]/30 bg-[#4f5bd5]/[0.04] p-3.5">
    <p class="${ctx.LABEL}">Goal</p>
    <p class="mt-1.5 text-[16px] font-semibold leading-snug">${ctx.esc(g.target ?? g.title)}</p>
    ${g.deadline || g.title ? `<p class="mt-0.5 text-[12px] text-foreground/60">${ctx.esc([g.title, g.deadline ? `by ${g.deadline}` : ""].filter(Boolean).join(" · "))}</p>` : ""}
    ${p !== null ? `<div class="mt-2 h-1.5 rounded-full bg-foreground/10"><div class="h-full rounded-full bg-[#4f5bd5]" style="width:${p}%"></div></div><p class="mt-1 text-[11px] text-foreground/55">${ctx.esc(progress)} of ${ctx.esc(g.targetCount)}</p>` : ""}
  </div>`;
}

function viewGoal(ctx, ob) {
  return `${goalHeader(ctx, ob.goal)}${toChat(ctx, "A few quick questions about how you go now — in the chat")}`;
}

function viewNow(ctx, ob) {
  const n = ob.now ?? {};
  const list = (title, items, tone) => arr(items).length ? `<p class="${ctx.LABEL} mt-3">${title}</p><div class="mt-1.5 flex flex-wrap gap-1.5">${arr(items).map((x) => `<span class="rounded-md ${tone} px-2 py-1 text-[11px]">${ctx.esc(x)}</span>`).join("")}</div>` : "";
  return `${goalHeader(ctx, ob.goal)}
  <div class="${ctx.CARD} mt-3 p-3.5">
    <p class="${ctx.LABEL}">How you go now</p>
    ${n.current ? `<p class="mt-1.5 text-[13px]">${ctx.esc(n.current)}</p>` : ""}
    ${list("What blocks you", n.blockers, "bg-amber-50 text-amber-800")}
    ${list("Already have", n.alreadyHave, "bg-emerald-50 text-emerald-700")}
    ${list("Gaps", n.gaps, "bg-muted text-foreground/70")}
  </div>
  ${toChat(ctx, "Finding how others reach this goal…")}`;
}

// What the agent is connected to. No price: it is known only after a tool runs (paid tools go through the Teamly key,
// the agents' own work runs on the Claude plan).
function costBlock(ctx, x) {
  const list = ctx.A.integrationsOf({ ...(ctx.A.agentBySlug[x.slug] ?? {}), ...x });
  return `
  <div class="mt-1.5 rounded-md border border-foreground/10 px-2.5 py-2 text-[11px]">
    <p class="flex flex-wrap items-center gap-1.5 font-medium">${ctx.icon("link", "size-3.5 text-foreground/50")} ${list.length
      ? list.map((i) => `${ctx.esc(i.name)}${i.optional ? ' <span class="font-normal text-foreground/40">(optional)</span>' : ""}`).join(" · ")
      : "Only Claude Code's own tools"}</p>
  </div>`;
}

function viewForge(ctx, ob) {
  const f = ob.forge ?? {};
  const PH = [["mine", "Reading your chats"], ["research", "Researching the craft"], ["ontology", "Building the ontology"], ["confirm", "Your OK"], ["tests", "Writing 5 tests"], ["proof", "Against plain Claude"]];
  const cur = Math.max(0, PH.findIndex(([id]) => id === f.phase));
  const done = f.phase === "done";
  const detail = {
    mine: f.found ? `${f.found.sessions ?? 0} sessions · ${f.found.corrections ?? 0} of your corrections${f.found.examples ? ` · ${f.found.examples} examples` : ""}` : "",
    research: f.research ? `${f.research.sources ?? 0} sources` : "",
    ontology: f.ontology?.rules ? `${f.ontology.rules.length} rules, ${f.ontology.quality?.length ?? 0} quality checks` : "",
    confirm: "", tests: f.tests ? `${f.tests} tests` : "",
    proof: f.proof ? `${f.proof.win ?? 0} wins · ${f.proof.tie ?? 0} ties · ${f.proof.loss ?? 0} losses` : "",
  };
  return `
  <div class="${ctx.CARD} mt-4 p-3.5">
    <div class="flex items-center gap-2.5">
      <img src="./assets/agents/create-agent-silhouette.png" alt="" class="size-12 object-contain ${done ? "" : "animate-[pixelBob_2s_ease-in-out_infinite]"}" />
      <div><p class="${ctx.LABEL}">${done ? "Agent created" : "Creating your agent"}</p><p class="mt-1 text-[15px] font-semibold">${ctx.esc(f.agent?.name ?? "New agent")}</p><p class="text-[11px] text-foreground/55">${ctx.esc(f.agent?.role ?? "")}</p></div>
    </div>
    <div class="mt-3 flex flex-col gap-1.5">
      ${PH.map(([id, label], i) => {
        const st = done || i < cur ? "done" : i === cur ? "active" : "next";
        return `<div class="flex items-start gap-2.5 rounded-lg px-2 py-1.5 ${st === "active" ? "bg-[#4f5bd5]/[0.06]" : ""}">
          <span class="mt-0.5 flex size-4 shrink-0 items-center justify-center">${st === "done" ? ctx.icon("check", "size-4 text-emerald-600") : st === "active" ? '<span class="size-3 animate-spin rounded-full border-2 border-[#4f5bd5]/25 border-t-[#4f5bd5]"></span>' : '<span class="size-2 rounded-full bg-foreground/15"></span>'}</span>
          <div class="min-w-0"><p class="text-[13px] ${st === "next" ? "text-foreground/40" : "font-medium"}">${label}</p>${detail[id] && st !== "next" ? `<p class="text-[11px] text-foreground/55">${ctx.esc(detail[id])}</p>` : ""}</div>
        </div>`;
      }).join("")}
    </div>
  </div>
  ${arr(f.research?.highlights).length ? `<p class="${ctx.LABEL} mt-4">What the craft says</p><div class="mt-1.5 flex flex-col gap-1">${arr(f.research?.highlights).slice(0, 5).map((h) => `<p class="rounded-md bg-muted px-2 py-1.5 text-[11px] leading-snug">${ctx.esc(h)}</p>`).join("")}</div>` : ""}
  ${arr(f.ontology?.rules).length ? `<p class="${ctx.LABEL} mt-4">Rules so far</p><div class="mt-1.5 flex flex-col gap-1">${arr(f.ontology?.rules).slice(0, 7).map((r) => `<p class="rounded-md border border-foreground/10 px-2 py-1.5 text-[11px] leading-snug">${ctx.esc(r.text ?? r)}${r.source ? ` <span class="text-foreground/40">· ${ctx.esc(String(r.source).slice(0, 30))}</span>` : ""}</p>`).join("")}</div>` : ""}
  ${toChat(ctx, f.phase === "confirm" ? "Is the ontology right? Answer in the chat" : done ? "Agent ready — next steps in the chat" : "Creating… you can watch here")}`;
}

function viewApproaches(ctx, ob) {
  const picked = new Set(ob.picked ?? []);
  const kindLabel = { practitioner: "practitioner", craft: "craft", research: "research" };
  return `
  <p class="${ctx.LABEL} mt-5">How others reach it</p>
  <div class="mt-2 flex flex-col gap-3">
    ${ob.approaches.map((x) => {
      const on = picked.has(x.slug);
      const chain = (x.chain ?? []).map((sl, i) => {
        if (sl && typeof sl === "object" && sl.create) {
          return `${i ? `<span class="pt-2 text-foreground/25">${ctx.icon("chevronRight", "size-3")}</span>` : ""}<span class="flex flex-col items-center gap-0.5"><span class="flex size-7 items-center justify-center rounded-md border-2 border-dashed border-amber-400 text-amber-600">${ctx.icon("plus", "size-3.5")}</span><span class="max-w-16 text-center text-[9px] leading-tight text-amber-700">to create: ${ctx.esc(sl.create)}</span></span>`;
        }
        const a = sl === "you" ? null : agentView(ctx, { slug: sl });
        const miss = (x.missing ?? []).includes(sl);
        return `${i ? `<span class="pt-2 text-foreground/25">${ctx.icon("chevronRight", "size-3")}</span>` : ""}<span class="flex flex-col items-center gap-0.5 ${miss ? "opacity-40" : ""}">${a ? avatarOf(ctx, a, "size-7") : ctx.avatar(null, "size-7")}<span class="text-[9px] text-foreground/55">${ctx.esc(a ? a.name : "You")}${miss ? " (soon)" : ""}</span></span>`;
      }).join("");
      return `
      <div class="rounded-xl border-2 ${on ? "border-[#4f5bd5] shadow-[2px_2px_0_0_#4f5bd5]" : "border-foreground/10"} p-3.5">
        <div class="flex items-start gap-2">
          <p class="flex-1 text-[15px] font-semibold leading-snug">${ctx.esc(x.title)}</p>
          ${on ? `<span class="${ctx.PX} rounded bg-[#4f5bd5] px-1.5 py-0.5 text-[6px] text-white">Chosen</span>` : ""}
        </div>
        <p class="mt-1.5 text-[12px] leading-snug text-foreground/75">${ctx.esc(x.idea)}</p>
        ${x.whatsNewForYou ?? x.whatsNew ? `<div class="mt-2 rounded-lg bg-[#4f5bd5]/[0.06] px-2.5 py-2 text-[12px] leading-snug"><b class="text-[#4f5bd5]">New for you:</b> ${ctx.esc(x.whatsNewForYou ?? x.whatsNew)}</div>` : ""}
        <div class="mt-2.5 flex items-start gap-1 overflow-x-auto pb-1">${chain}</div>
        ${(x.evidence ?? []).map((e) => `<p class="mt-1.5 text-[11px] leading-snug text-foreground/60">${ctx.icon("check", "inline size-3 text-emerald-600")} ${ctx.esc(e.text)} <span class="${ctx.PX} rounded bg-muted px-1 py-0.5 text-[5px] text-foreground/50">${ctx.esc(kindLabel[e.kind] ?? e.kind ?? "")}</span></p>`).join("")}
        <div class="mt-2.5 grid grid-cols-2 gap-1.5 text-[11px]">
          <div class="rounded-md bg-muted px-2 py-1.5"><p class="${ctx.LABEL}">From you</p><p class="mt-1 font-medium leading-tight">${ctx.esc(x.needsFromYou ?? "—")}</p></div>
          <div class="rounded-md bg-muted px-2 py-1.5"><p class="${ctx.LABEL}">Time</p><p class="mt-1 font-medium leading-tight">${ctx.esc(x.timePerResult ?? "—")}</p></div>
        </div>
        ${costBlock(ctx, x)}
        ${x.source === "research" ? `<p class="mt-2 text-[10px] text-amber-700">Researched now — not in the library yet</p>` : ""}
        ${x.author ? `<p class="mt-2 text-[10px] text-foreground/45">Approach by ${ctx.esc(x.author)}</p>` : ""}
      </div>`;
    }).join("")}
  </div>
  ${toChat(ctx, ob.picked ? "Making it yours…" : "Pick an approach in the chat")}`;
}

function viewArea(ctx, ob) {
  return `
  <div class="${ctx.CARD} mt-4 p-4">
    <p class="${ctx.LABEL}">Team</p>
    <p class="mt-1.5 text-[17px] font-semibold">${ctx.esc(ob.team?.name ?? "")}</p>
    <p class="mt-0.5 text-[12px] text-foreground/60">Area of responsibility: ${ctx.esc(ob.team?.area ?? "")}</p>
  </div>
  ${toChat(ctx, "Now the main goal of this team — in the chat")}`;
}

// The team opens straight into its office: the room, the process under it, buttons for goals, reports and tasks.
// Two views of the same floor: the Room (who sits where and what they're doing) and the Board (the work as cards).
function viewSwitch(ctx, t) {
  const v = ctx.local("floor").view ?? "office";
  const onYou = (t.tasks ?? []).some((x) => (x.status?.rows ?? []).some((r) => /^waiting for you/i.test(r.status ?? "")));
  const tab = (id, label, ic) => `<button data-floor-view="${id}" class="flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-[12.5px] ${v === id ? "bg-card font-semibold text-foreground shadow-sm" : "text-foreground/55 hover:text-foreground"}">${ctx.icon(ic, "size-3.5")}${label}${id === "board" && onYou ? '<span class="size-1.5 rounded-full bg-amber-400"></span>' : ""}</button>`;
  return `<div class="mt-3 flex gap-1 rounded-lg bg-muted p-1">${tab("office", "Room", "building")}${tab("board", "Board", "layoutGrid")}</div>`;
}

// A live floor: the room (the main thing), the process under it, and buttons for the rest — goals, reports, tasks.
const FLOOR_BUTTONS = [["goals", "Goals", "target"], ["reports", "Reports", "file"], ["tasks", "Tasks", "list"]];

function teamView(ctx, t) {
  if ((ctx.local("floor").view ?? "office") === "board") return `${viewSwitch(ctx, t)}${boardHTML(ctx, t)}`;
  const o = office.officeFromTeam(ctx, t, ctx.ui.officeTask);
  const buttons = FLOOR_BUTTONS.filter(([id]) => id !== "tasks" || (t.tasks ?? []).length > 1);
  return `
  ${viewSwitch(ctx, t)}
  ${office.officeHTML(ctx, o)}
  <div class="mt-4 grid gap-2.5" style="grid-template-columns:repeat(${buttons.length},minmax(0,1fr))">
    ${buttons.map(([id, label, ic]) => `<button data-floor-sheet="${id}" class="${ctx.PX} flex items-center justify-center gap-1.5 border-2 border-[#0a0a0a] bg-white px-2 py-2.5 text-[8px] shadow-[3px_3px_0_0_#0a0a0a] hover:bg-[#eef1f5] active:translate-x-[3px] active:translate-y-[3px] active:shadow-none">${ctx.icon(ic, "size-3.5")}${label}${id === "reports" && t.reports?.next && Date.parse(t.reports.next) <= Date.now() ? '<span class="size-1.5 rounded-full bg-amber-400"></span>' : ""}</button>`).join("")}
  </div>`;
}

function goalsSheet(ctx, t) {
  return `<p class="${ctx.LABEL}">Goals</p>${(t.goals ?? []).map((g) => {
    const total = Number(g.targetCount ?? 0);
    const p = total ? Math.min(100, Math.round((Number(g.progress ?? 0) / total) * 100)) : null;
    return `
    <div class="mt-2 border-2 border-[#4f5bd5]/25 bg-[#4f5bd5]/[0.03] px-3 py-2.5">
      <p class="text-[13px] font-semibold leading-snug">${ctx.esc(g.target ?? g.title ?? "")}</p>
      ${g.title && g.target ? `<p class="text-[11.5px] text-foreground/55">${ctx.esc(g.title)}</p>` : ""}
      ${g.deadline ? `<p class="text-[10.5px] text-foreground/50">by ${ctx.esc(g.deadline)}</p>` : ""}
      ${p !== null ? `<div class="mt-2 flex items-center gap-2"><div class="h-1 flex-1 bg-foreground/10"><div class="h-full bg-[#4f5bd5]" style="width:${p}%"></div></div><span class="text-[10px] text-foreground/50">${ctx.esc(g.progress ?? 0)}/${ctx.esc(total)}</span></div>` : ""}
    </div>`;
  }).join("") || `<p class="mt-2 text-[12.5px] text-foreground/55">No goal yet. Write “Teamly: new goal” in this team's chat.</p>`}`;
}

function tasksSheet(ctx, t) {
  const cur = office.officeFromTeam(ctx, t, ctx.ui.officeTask).folder;
  return `<p class="${ctx.LABEL}">Tasks</p><div class="mt-2 flex flex-col gap-1.5">${(t.tasks ?? []).map((x) => `
    <button data-task="${ctx.esc(x.folder)}" class="flex w-full items-center gap-2.5 border-2 px-3 py-2 text-left ${x.folder === cur ? "border-[#4f5bd5]/50 bg-[#4f5bd5]/[0.04]" : "border-foreground/10 hover:border-[#4f5bd5]/30"}">
      <span class="min-w-0 flex-1"><span class="block truncate text-[12.5px] font-semibold">${ctx.esc(String(x.title ?? "").replace(/^task:\s*/i, ""))}</span>
        <span class="mt-1 flex items-center gap-2"><span class="h-1 flex-1 bg-foreground/10"><span class="block h-full bg-[#4f5bd5]" style="width:${Math.round((x.done / Math.max(1, x.steps)) * 100)}%"></span></span><span class="text-[10px] text-foreground/50">${x.done}/${x.steps}</span></span></span>
      ${x.active ? '<span class="size-1.5 shrink-0 animate-pulse rounded-full bg-emerald-500"></span>' : ""}
    </button>`).join("")}</div>`;
}

function viewWaiting(ctx) {
  return `
  <div class="${ctx.CARD} mt-4 p-4 text-center animate-[fadeSlideUp_0.4s_ease-out_both]">
    <img src="./assets/agents/formal01.png" alt="" class="mx-auto size-20 object-contain animate-[pixelBob_3s_ease-in-out_infinite]" />
    <p class="mt-2 text-[16px] font-semibold">Key connected</p>
    <p class="mt-1 text-[13px] text-muted-foreground">The coordinator is picking up in the chat on the left…</p>
    <div class="mx-auto mt-3 size-6 animate-spin rounded-full border-[3px] border-[#4f5bd5]/20 border-t-[#4f5bd5]"></div>
  </div>`;
}

function viewAnalysis(ctx) {
  return `
  <div class="${ctx.CARD} mt-4 p-4 text-center">
    <div class="mx-auto size-8 animate-spin rounded-full border-[3px] border-[#4f5bd5]/20 border-t-[#4f5bd5]"></div>
    <p class="mt-3 text-[15px] font-semibold">Reading your sessions…</p>
    <p class="mt-1 text-[12px] text-muted-foreground">Claude Code and Codex, last 30 days, on this computer. Keys and passwords are cut out. Takes a few seconds.</p>
  </div>`;
}

function viewJobs(ctx, ob) {
  const max = Math.max(1, ...ob.jobs.map((j) => j.sessions ?? 1));
  const t = ob.totals;
  return `
  <p class="${ctx.LABEL} mt-5">What you do most${t?.sessions ? ` · ${ctx.esc(t.sessions)} sessions, ${ctx.esc(t.days)} days` : ""}</p>
  <div class="mt-2 flex flex-col gap-2">
    ${ob.jobs.map((j) => {
      const on = ob.chosen === j.id || j.kept === true;
      const off = j.kept === false;
      return `
      <div class="rounded-xl border-2 ${on ? "border-[#4f5bd5] shadow-[2px_2px_0_0_#4f5bd5]" : "border-foreground/10"} ${off ? "opacity-40" : ""} p-3">
        <div class="flex items-center gap-2">
          <p class="flex-1 text-[14px] font-semibold">${ctx.esc(j.title)}</p>
          ${on ? `<span class="${ctx.PX} rounded bg-[#4f5bd5] px-1.5 py-0.5 text-[6px] text-white">To agents</span>` : ""}
          ${j.source === "told" ? `<span class="${ctx.PX} rounded bg-muted px-1.5 py-0.5 text-[6px] text-foreground/60">Added by you</span>` : ""}
          ${j.sessions ? `<span class="text-[12px] text-foreground/55">${ctx.esc(j.sessions)} chats</span>` : ""}
        </div>
        ${j.sessions ? `<div class="mt-2 h-1.5 rounded-full bg-foreground/5"><div class="h-full rounded-full bg-[#4f5bd5]/60" style="width:${Math.round((j.sessions / max) * 100)}%"></div></div>` : ""}
        ${j.repeats ? `<p class="mt-2 text-[12px] text-foreground/70">${ctx.esc(j.repeats)}</p>` : ""}
        ${j.pain ? `<p class="mt-1 text-[11px] text-amber-700">Pain: ${ctx.esc(j.pain)}</p>` : ""}
      </div>`;
    }).join("")}
  </div>
  <div class="mt-2 flex items-start gap-2.5 rounded-xl border-2 border-dashed border-foreground/20 p-3">
    <span class="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-foreground/50">${ctx.icon("plus", "size-4")}</span>
    <div><p class="text-[13px] font-medium">Your own task or idea</p><p class="text-[11px] text-foreground/50">Pick “+ Add your own” in the chat and describe it: by voice, with a file, link or screenshot.</p></div>
  </div>
  ${toChat(ctx, ob.jobs.some((j) => j.kept !== undefined) ? "Picking agents from the library…" : "Is this right? Keep, remove or add tasks in the chat")}`;
}

function viewOntology(ctx, ob) {
  const o = ob.ontology;
  const src = (x) => /чат|chat/i.test(x ?? "") ? "from your chats" : /ремесл|craft|http/i.test(x ?? "") ? "craft" : x ? ctx.esc(String(x).slice(0, 24)) : "";
  return `
  <p class="${ctx.LABEL} mt-5">Ontology of your task</p>
  <div class="${ctx.CARD} mt-2 p-3.5">
    <p class="text-[15px] font-semibold">${ctx.esc(o.task ?? "")}</p>
    ${o.result ? `<p class="mt-1 text-[12px] text-foreground/70"><b>Result:</b> ${ctx.esc(o.result)}</p>` : ""}
    ${o.done ? `<p class="mt-0.5 text-[12px] text-foreground/70"><b>Done when:</b> ${ctx.esc(o.done)}</p>` : ""}
    ${o.steps?.length ? `<div class="mt-3 flex flex-wrap items-center gap-1">${o.steps.map((x, i) => `${i ? `<span class="text-foreground/25">${ctx.icon("chevronRight", "size-3")}</span>` : ""}<span class="rounded-md bg-muted px-2 py-1 text-[11px]">${ctx.esc(x)}</span>`).join("")}</div>` : ""}
  </div>
  ${o.rules?.length ? `
  <p class="${ctx.LABEL} mt-4">Rules the agents will follow</p>
  <div class="mt-2 flex flex-col gap-1.5">
    ${o.rules.map((r) => `<div class="flex items-start gap-2 rounded-lg border-2 border-foreground/10 px-3 py-2"><span class="mt-0.5 text-[#4f5bd5]">${ctx.icon("check", "size-3.5")}</span><p class="flex-1 text-[12px] leading-snug">${ctx.esc(r.text ?? r)}</p>${r.source ? `<span class="${ctx.PX} shrink-0 rounded bg-muted px-1 py-0.5 text-[5px] text-foreground/55">${src(r.source)}</span>` : ""}</div>`).join("")}
  </div>` : ""}
  ${o.quality?.length ? `<p class="${ctx.LABEL} mt-4">Quality bar</p><ul class="mt-1.5 list-disc pl-5 text-[12px] text-foreground/75">${o.quality.map((q) => `<li>${ctx.esc(q)}</li>`).join("")}</ul>` : ""}
  ${o.stops?.length ? `<p class="${ctx.LABEL} mt-4">Stops and asks you</p><ul class="mt-1.5 list-disc pl-5 text-[12px] text-foreground/75">${o.stops.map((q) => `<li>${ctx.esc(q)}</li>`).join("")}</ul>` : ""}
  ${toChat(ctx, "Is this right? Answer in the chat")}`;
}

function viewMatch(ctx, ob) {
  const picked = new Set(ob.picked ?? []);
  return `
  <p class="${ctx.LABEL} mt-5">From the Teamly library</p>
  ${ob.match.map((m) => `
  <div class="mt-3">
    <p class="text-[13px] font-semibold">${ctx.esc(m.role ?? m.job ?? "")}${m.step ? ` <span class="font-normal text-foreground/50">· ${ctx.esc(m.step)}</span>` : ""}</p>
    ${m.none || !(m.candidates ?? m.agents)?.length ? `
    <div class="mt-2 rounded-xl border-2 border-dashed border-amber-300 bg-amber-50/60 p-3">
      <p class="text-[13px] font-medium text-amber-900">Nothing in the library yet</p>
      <p class="mt-1 text-[12px] text-amber-800/80">The coordinator builds this one from scratch, on your ontology.</p>
    </div>` : `
    <div class="mt-2 flex flex-col gap-2">
      ${(m.candidates ?? m.agents).map((x) => {
        const a = agentView(ctx, x);
        const on = picked.has(x.slug);
        return `
        <div class="flex items-start gap-2.5 rounded-xl border-2 ${on ? "border-[#4f5bd5] shadow-[2px_2px_0_0_#4f5bd5]" : "border-foreground/10"} p-2.5">
          ${avatarOf(ctx, a, "size-9")}
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-1.5">
              <p class="text-[13px] font-semibold">${ctx.esc(a.name)}</p>
              <span class="${ctx.PX} rounded bg-[#4f5bd5]/10 px-1 py-0.5 text-[5px] text-[#4f5bd5]">by ${ctx.esc(x.author ?? ctx.A.agentBySlug[x.slug]?.author ?? "?")}</span>
              ${x.evalWin ? `<span class="${ctx.PX} rounded bg-emerald-50 px-1 py-0.5 text-[5px] text-emerald-700">beats Claude ${ctx.esc(x.evalWin)}</span>` : ""}
              ${on ? `<span class="${ctx.PX} rounded bg-[#4f5bd5] px-1 py-0.5 text-[5px] text-white">Base</span>` : ""}
            </div>
            <p class="mt-1 text-[12px] leading-snug text-foreground/70">${ctx.esc(x.outcome ?? ctx.A.agentBySlug[x.slug]?.outcome ?? x.why ?? "")}</p>
          </div>
        </div>`;
      }).join("")}
    </div>`}
  </div>`).join("")}
  ${toChat(ctx, ob.picked ? "Making them yours…" : "Pick the bases in the chat")}`;
}

function viewFork(ctx, ob) {
  return `
  <p class="${ctx.LABEL} mt-5">Your agents, based on the library</p>
  <div class="mt-2 flex flex-col gap-2.5">
    ${(ob.forks ?? []).map((f) => {
      const a = agentView(ctx, { slug: f.upstream ?? f.slug, name: f.name });
      return `
      <div class="${ctx.CARD} p-3">
        <div class="flex items-center gap-2.5">
          ${avatarOf(ctx, a, "size-9")}
          <div class="min-w-0 flex-1">
            <p class="text-[13px] font-semibold">${ctx.esc(f.name)}</p>
            <p class="text-[11px] text-foreground/50">${f.upstream ? `based on ${ctx.esc(ctx.A.agentBySlug[f.upstream]?.name ?? f.upstream)} by ${ctx.esc(f.upstreamAuthor ?? ctx.A.agentBySlug[f.upstream]?.author ?? "?")}` : "built from scratch on your ontology"}</p>
          </div>
        </div>
        ${arr(f.changes).length ? `<div class="mt-2.5 flex flex-col gap-1">${arr(f.changes).map((c) => `<p class="rounded-md bg-muted px-2 py-1.5 text-[11px] leading-snug">${ctx.esc(c)}</p>`).join("")}</div>` : ""}
      </div>`;
    }).join("")}
  </div>
  ${arr(ob.ontology?.rules).length ? `<p class="${ctx.LABEL} mt-4">Your rules they now follow</p><div class="mt-1.5 flex flex-col gap-1">${arr(ob.ontology?.rules).slice(0, 7).map((r) => `<p class="rounded-md border border-foreground/10 px-2 py-1.5 text-[11px] leading-snug">${ctx.esc(r.text ?? r)}</p>`).join("")}</div>` : ""}
  ${toChat(ctx, "Test it against plain Claude? Answer in the chat")}`;
}

function teamBlock(ctx, team) {
  const agents = (team.agents ?? []).map((x) => agentView(ctx, x));
  const chain = (team.chain ?? team.goals?.[0]?.chain ?? agents.map((a) => a.slug)).map((s, i) => {
    const a = s === "you" ? { name: "You", sprite: null, you: true }
      : s && typeof s === "object" ? (s.create ? { name: s.create, sprite: null, you: true }  // {"create": …}: built for you later
        : { name: "You", sprite: null, you: true })                                                  // {"who": "you", "mode": "veto"}
      : agents.find((x) => x.slug === s) ?? agentView(ctx, { slug: s });
    return `${i ? `<span class="pt-3 text-foreground/25">${ctx.icon("chevronRight", "size-3")}</span>` : ""}<span class="flex flex-col items-center gap-1">${a.you ? ctx.avatar(null, "size-8") : avatarOf(ctx, a, "size-8")}<span class="text-[10px] text-foreground/60">${ctx.esc(a.name)}</span></span>`;
  }).join("");
  return `
  <div class="mt-3 flex items-start gap-1.5 overflow-x-auto pb-1">${chain}</div>
  <div class="mt-3 flex flex-col gap-2">
    ${agents.map((a) => `
    <div class="flex items-start gap-2.5 rounded-xl border-2 border-foreground/10 p-2.5">
      ${avatarOf(ctx, a, "size-9")}
      <div class="min-w-0 flex-1">
        <div class="flex flex-wrap items-center gap-1.5"><p class="text-[13px] font-semibold">${ctx.esc(a.name)}</p><span class="text-[11px] text-foreground/50">${ctx.esc(a.role)}</span>${sourceBadge(ctx, a)}</div>
        <p class="mt-1 text-[12px] leading-snug text-foreground/70">${ctx.esc(a.why)}</p>
      </div>
    </div>`).join("")}
  </div>
  <div class="mt-3 grid grid-cols-2 gap-1.5 text-[11px]">
    <div class="rounded-md bg-muted px-2 py-1.5"><p class="${ctx.LABEL}">Result</p><p class="mt-1 font-medium leading-tight">${ctx.esc(team.result ?? "—")}</p></div>
    <div class="rounded-md bg-muted px-2 py-1.5"><p class="${ctx.LABEL}">How often</p><p class="mt-1 font-medium leading-tight">${ctx.esc(team.cadence ?? "—")}</p></div>
  </div>`;
}

function viewTeam(ctx, ob) {
  return `
  <p class="${ctx.LABEL} mt-5">Proposed team</p>
  ${teamBlock(ctx, ob.team)}
  ${toChat(ctx, "Confirm the team in the chat")}`;
}

function viewPacked(ctx, ob) {
  const team = ob.packTeam ?? ob.team;
  return `${goalHeader(ctx, team.goal ?? ob.goal)}
  <div class="mt-4 rounded-xl border-2 border-emerald-300 bg-emerald-50/60 p-3.5 animate-[fadeSlideUp_0.35s_ease-out_both]">
    <div class="flex items-center gap-2 text-emerald-700">${ctx.icon("check", "size-4")}<p class="${ctx.PX} text-[8px]">Team packed</p></div>
    <p class="mt-2 text-[16px] font-semibold">${ctx.esc(team.name)}</p>
    <p class="mt-1 break-all font-mono text-[11px] text-foreground/55">${ctx.icon("folder", "inline size-3")} ${ctx.esc(ob.pack ?? "")}</p>
    <div class="mt-3 grid grid-cols-2 gap-2">
      <button data-open-teammd class="${ctx.BTN2}">${ctx.icon("file", "size-3")} Open TEAM.md</button>
      <button data-copy-pack class="${ctx.BTN2}">${ctx.icon("copy", "size-3")} Copy folder path</button>
    </div>
    <p class="mt-2 text-[11px] text-foreground/50">A folder with the team card and its agents, for this computer. To give the team to someone, press Share on the floor: the coordinator packs it and checks it for private data first.</p>
  </div>
  ${teamBlock(ctx, team)}
  ${team.firstTask ? `<p class="${ctx.LABEL} mt-4">First task</p><p class="mt-1.5 rounded-lg border-2 border-foreground/10 p-2.5 text-[13px]">${ctx.esc(team.firstTask)}</p>` : ""}
  ${toChat(ctx, "Start the first task in the chat")}`;
}

// ---------------------------------------------------------------- hired team + work
function seat(ctx, a, status) {
  if (!a) {
    return `<button data-add-seat class="flex flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-foreground/15 px-2 py-4 text-foreground/35 hover:border-[#4f5bd5]/40 hover:text-[#4f5bd5]">
      ${ctx.icon("plus", "size-4")}<span class="${ctx.PX} text-[6px]">Empty seat</span></button>`;
  }
  const dot = status === "working" ? "bg-[#4f5bd5] animate-pulse" : status === "needs_you" || status === "failed" ? "bg-amber-400" : status === "done" ? "bg-emerald-400" : "bg-foreground/20";
  const img = a.sprite && /^[A-Za-z0-9_-]{1,64}$/.test(a.sprite) ? `<img src="./assets/agents/${a.sprite}.png" alt="" class="size-14 object-contain animate-[pixelBob_3s_ease-in-out_infinite]" />` : `<img src="./assets/agents/create-agent-silhouette.png" alt="" class="size-14 object-contain opacity-70" />`;
  return `
  <div class="relative flex flex-col items-center gap-1 rounded-xl border-2 border-foreground/10 px-2 py-3 text-center">
    <span class="absolute right-2 top-2 size-1.5 rounded-full ${dot}"></span>
    ${img}
    <p class="text-[12px] font-semibold leading-tight">${ctx.esc(a.name)}</p>
    <p class="text-[10px] leading-tight text-foreground/50">${ctx.esc(a.role)}</p>
  </div>`;
}

function statusOf(ctx, slug) {
  const run = ctx.ui.run;
  const s = run?.steps.find((x) => x.slug === slug);
  if (!s) return null;
  if (run.phase === "failed" && run.steps[run.cur].slug === slug) return "failed";
  return s.status;
}

function firstTaskOf(ctx) {
  const hired = members(ctx).map((a) => a.slug);
  const team = ctx.A.TEAMS.find((t) => t.chain.filter((s) => s !== "you").every((s) => hired.includes(s)));
  return team?.firstTask ?? ctx.A.agentBySlug[hired[0]]?.firstTask ?? "";
}

function hiredView(ctx, team) {
  const seats = team.map((a) => seat(ctx, a, statusOf(ctx, a.slug))).join("")
    + Array.from({ length: Math.max(0, SEATS - team.length) }, () => seat(ctx, null)).join("");
  return `
    <div class="mt-3 grid grid-cols-3 gap-2">${seats}</div>
    <div class="mt-5 border-t-2 border-dashed border-foreground/10 pt-4">
      <p class="${ctx.LABEL} mb-2">Now</p>
      ${now.hasWork(ctx) ? now.renderBody(ctx) : ctx.chatAsk("What's the first task?", [
        { id: "ob-task", label: firstTaskOf(ctx), sub: "Suggested for this team" },
        { id: "ob-task-own", label: "I'll write my own", sub: "You type it in the chat" },
      ], { note: "The first agent starts as soon as you answer." })}
    </div>`;
}

// ---------------------------------------------------------------- screen
// ---------------------------------------------------------------- the floor under construction
// While the coordinator sets the team up in the chat, its floor is built in front of you: bare concrete with
// scaffolding turns into the finished room of its area from left to right, step by step; the goal gets pinned
// to the wall, agents walk in as they are made yours. Below: the build log, one line per step.
function buildSite(ctx, ob) {
  const at = BUILD_AT[ob?.step ?? "start"] ?? 0;
  return `
  <div class="mx-auto mt-4 w-full max-w-[540px]">
    <div class="relative w-full" style="aspect-ratio:1024/186"><img src="./assets/building/roof.webp" alt="" class="absolute inset-0 size-full" /></div>
    ${siteFloor(ctx, ob)}
    <div class="relative w-full" style="aspect-ratio:1024/226"><img src="./assets/building/lobby.webp" alt="" class="absolute inset-0 size-full" /></div>
  </div>
  <p class="mt-2 text-center text-[11.5px] text-foreground/50">Now: <b class="text-foreground/75">${BUILD[Math.min(at, BUILD.length - 1)][1]}</b> — the coordinator asks in the chat, the floor gets built as you answer.</p>`;
}

function buildLog(ctx, ob) {
  const at = BUILD_AT[ob?.step ?? "start"] ?? 0;
  const picked = (ob?.approaches ?? []).find((x) => (ob.picked ?? []).includes(x.slug));
  const agents = chainAgents(ctx, ob ?? {});
  const pickWay = { auto: "picked by Teamly: best rated and tested", manual: "you picked them", build: "built from scratch for you" }[ob?.agentPick];
  const detail = [
    ob?.team?.area ?? ob?.team?.name,
    ob?.goal ? `${ob.goal.title ?? ""}${ob.goal.target ? ` — ${ob.goal.target}` : ""}` : null,
    ob?.skipped?.includes?.("now") ? "skipped" : arr(ob?.now?.blockers).length ? `Main blocker: ${arr(ob.now.blockers)[0]}` : ob?.now?.current,
    picked ? `${picked.title}${picked.author ? ` · by ${picked.author}` : ""}` : null,
    agents.length ? `${agents.map((a) => a.name).join(", ")}${pickWay ? ` · ${pickWay}` : ""}` : pickWay ?? null,
    ob?.firstTask ? `First task: ${ob.firstTask.title ?? ob.firstTask}` : null,
  ];
  return `
  <div class="mt-4 rounded-xl border-2 border-foreground/10 p-3">
    <p class="${ctx.LABEL}">Build log</p>
    <ol class="mt-2 flex flex-col gap-2">
      ${BUILD.map(([, label], i) => {
        const done = i < at, cur = i === at;
        return `
        <li class="flex gap-2.5">
          <span class="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${done ? "bg-[#4f5bd5] text-white" : cur ? "border-2 border-[#4f5bd5] text-[#4f5bd5] animate-pulse" : "border-2 border-foreground/15 text-foreground/35"}">${done ? ctx.icon("check", "size-3") : i + 1}</span>
          <span class="min-w-0 flex-1">
            <span class="block text-[13px] ${done || cur ? "font-semibold" : "text-foreground/45"}">${label}${cur ? `<span class="ml-1.5 text-[11px] font-normal text-[#4f5bd5]">in the chat now</span>` : ""}</span>
            ${(done || cur) && detail[i] ? `<span class="mt-0.5 block text-[12px] leading-snug text-foreground/60">${ctx.esc(String(detail[i]))}</span>` : ""}
          </span>
        </li>`;
      }).join("")}
    </ol>
  </div>`;
}

const answerInChat = (ctx) => `
  <button data-answer-chat class="mt-3 flex w-full items-center gap-2.5 rounded-xl border-2 border-amber-400 bg-amber-50 px-3 py-2.5 text-left shadow-[2px_2px_0_0_#f59e0b] hover:bg-amber-100">
    <span class="flex size-7 shrink-0 items-center justify-center rounded-full bg-amber-400 text-[15px] font-black text-white">!</span>
    <span class="min-w-0 flex-1"><span class="${ctx.PX} block text-[7px] text-amber-800">Needs you</span><span class="mt-0.5 block text-[12px] text-amber-950">The coordinator is asking you in the chat</span></span>
    <span class="${ctx.PX} shrink-0 text-[6px] text-amber-800">${liveTeamRec(ctx)?.coordinator_session === ctx.A.hostChat ? "Answer on the left" : "Open chat"}</span>${ctx.icon("chevronRight", "size-4 text-amber-700")}
  </button>`;

// Agents step: who was offered for each role of the approach, with stars and tests, and who got the job.
function viewCandidates(ctx, ob) {
  if (!ob.candidates?.length) return "";
  const stars = (r) => (r?.count ? `<span class="text-amber-500">★</span> ${Number(r.avg).toFixed(1)} <span class="text-foreground/40">(${ctx.esc(r.count)})</span>` : `<span class="text-foreground/40">no ratings yet</span>`);
  return `
  <p class="${ctx.LABEL} mt-4">${ob.agentPick === "auto" ? "Picked for you — best rated and tested" : "Candidates"}</p>
  <div class="mt-2 flex flex-col gap-2">
    ${ob.candidates.map((c) => `
    <div class="rounded-xl border-2 border-foreground/10 p-2.5">
      <p class="text-[11px] text-foreground/50">${ctx.esc(c.role ?? "")}</p>
      ${(c.options ?? []).map((o) => `
      <div class="mt-1.5 flex items-center gap-2 rounded-lg px-2 py-1.5 ${o.chosen ? "bg-[#4f5bd5]/[0.07] ring-2 ring-[#4f5bd5]/40" : ""}">
        <img src="./assets/agents/${ctx.A.agentBySlug[o.slug]?.sprite ?? ctx.A.spriteFor(o.slug)}.png" alt="" class="size-8 object-contain" />
        <span class="min-w-0 flex-1"><span class="block truncate text-[12.5px] font-semibold">${ctx.esc(o.name ?? o.slug)}</span><span class="block text-[11px]">${stars(o.rating)}${o.evalWin ? ` · <span class="text-emerald-700">✓ beats Claude ${ctx.esc(o.evalWin)}</span>` : ""}</span></span>
        ${o.chosen ? `<span class="flex size-5 items-center justify-center rounded-full bg-[#4f5bd5] text-white">${ctx.icon("check", "size-3")}</span>` : ""}
      </div>`).join("")}
    </div>`).join("")}
  </div>`;
}

export function render(ctx) {
  const ob = onboarding(ctx);
  const t = liveTeamRec(ctx);
  let body;
  if (inSetup(ctx)) {
    const step = ob?.step ?? "start";
    if (!ob) return `<div class="px-4 pb-24 pt-4">${header(ctx, 0)}${viewWaiting(ctx)}</div>`;
    // the floor being built, the log, then the detail of the step you're on (choices you make in the chat)
    body = buildSite(ctx, ob) + (liveTeamRec(ctx)?.coordinator_session ? answerInChat(ctx) : "") + buildLog(ctx, ob) + (
      step === "area" || step === "goal" || step === "now" ? ""
      : step === "agents" ? viewCandidates(ctx, ob)
      : step === "approaches" && ob.approaches?.length ? viewApproaches(ctx, ob)
      : step === "analysis" ? viewAnalysis(ctx)
      : step === "jobs" && ob.jobs?.length ? viewJobs(ctx, ob)
      : step === "ontology" && ob.ontology ? viewOntology(ctx, ob)
      : step === "match" && ob.match?.length ? viewMatch(ctx, ob)
      : step === "fork" && ob.forks?.length ? viewCandidates(ctx, ob) + viewFork(ctx, ob)
      : step === "forge" && ob.forge ? viewForge(ctx, ob)
      : step === "packaged" && (ob.packTeam || ob.team?.agents) ? viewPacked(ctx, ob)
      : ob ? viewStart(ctx) : viewWaiting(ctx));
    return `<div class="px-4 pb-24 pt-4">${header(ctx, 0)}${body}</div>`;
  }
  if (t) return `<div class="px-4 pb-24 pt-4">${header(ctx, (t.agents ?? []).length)}${teamView(ctx, t)}</div>`;
  // a floor that was removed (or moved to another record) is gone: never the prototype's made-up run in its place
  if (ctx.ui.teamSlug && (ctx.S.teams ?? []).length) {
    return `<div class="px-4 pb-24 pt-4"><p class="mt-6 text-center text-[13px] text-muted-foreground">This floor isn't in your office any more.</p>
      <button data-back-office class="${ctx.BTN2} mx-auto mt-3 block">Back to the office</button></div>`;
  }
  const team = members(ctx); // demo flows (prototype controls)
  if (team.length) return `<div class="px-4 pb-24 pt-4">${header(ctx, team.length)}${goalHeader(ctx, ob?.team?.goal ?? ob?.goal, ob?.team?.goal?.progress) + hiredView(ctx, team)}</div>`;
  return `<div class="px-4 pb-24 pt-4"><p class="text-[13px] text-muted-foreground">Pick a team on the Teams tab.</p></div>`;
}

export function mount(root, ctx) {
  root.querySelector("[data-back-office]")?.addEventListener("click", () => { ctx.ui.teamSlug = null; ctx.saveUI(); ctx.go("teams"); });
  // demo flows only: a real team (record in ~/.teamly/teams) has its own Office / Board below
  const cleanupNow = !liveTeamRec(ctx) && members(ctx).length && now.hasWork(ctx) ? now.mount(root, ctx) : null;
  const ob = onboarding(ctx);

  root.querySelector("[data-share-team]")?.addEventListener("click", () => ctx.sendToCoordinator(ctx, "Teamly: share team", {
    title: `Share ${liveTeamRec(ctx)?.name ?? "this team"}`,
    what: "Send this team to someone as a file or a link. <b>Goes in:</b> the agents, their setup questions, the team's chain, your goals as examples. <b>Stays here:</b> chats, task results, ratings, your files and keys. The coordinator packs it and checks it for private data first.",
  }));
  root.querySelector("[data-rename]")?.addEventListener("click", () => {
    ctx.openSheet(`
      <p class="${ctx.LABEL}">Team name</p>
      <input id="team-name" value="${ctx.esc(ctx.ui.teamName ?? "My team")}" class="mt-3 h-10 w-full rounded-md border-2 border-foreground/15 px-2.5 text-[14px] outline-none focus:border-[#4f5bd5]" />
      <button data-save-name class="${ctx.BTN} mt-3">Save</button>`, (sheet) => {
      sheet.querySelector("[data-save-name]").onclick = () => {
        ctx.ui.teamName = sheet.querySelector("#team-name").value.trim() || "My team";
        ctx.saveUI(); ctx.closeSheet(); ctx.refresh();
      };
    });
  });
  root.querySelectorAll("[data-add-seat], [data-gallery]").forEach((b) => { b.onclick = () => ctx.go("library"); });
  root.querySelector("[data-answer-chat]")?.addEventListener("click", () => {
    const sess = liveTeamRec(ctx)?.coordinator_session;
    if (sess) ctx.A.live.openChat(sess).then((r) => ctx.toast(r?.here ? "It's this chat — answer on the left" : "Opened the coordinator's chat")).catch(() => ctx.toast("Open the team's chat in the sidebar"));
  });
  const live = liveTeamRec(ctx);
  root.querySelectorAll("[data-agent]").forEach((b) => { b.onclick = () => { ctx.ui.agentRef = { team: live?.slug, slug: b.dataset.agent }; ctx.saveUI(); ctx.go("agent"); }; });
  root.querySelectorAll("[data-floor-sheet]").forEach((b) => {
    b.onclick = () => {
      const t = liveTeamRec(ctx);
      if (!t) return;
      const which = b.dataset.floorSheet;
      ctx.openSheet(which === "goals" ? goalsSheet(ctx, t) : which === "tasks" ? tasksSheet(ctx, t) : reportsBlock(ctx, t).replace(/ mt-5">Reports/, '">Reports'), (sheet) => {
        mountReports(sheet, ctx);
        sheet.querySelectorAll("[data-task]").forEach((x) => { x.onclick = () => { ctx.ui.officeTask = x.dataset.task; ctx.saveUI(); ctx.closeSheet(); ctx.rerender(); }; });
      });
    };
  });
  root.querySelectorAll("[data-floor-view]").forEach((b) => { b.onclick = () => { ctx.local("floor").view = b.dataset.floorView; ctx.rerender(); }; });
  const boardView = (ctx.local("floor").view ?? "office") === "board";
  if (live && !inSetup(ctx) && boardView) boardMount(root, ctx, live);
  const cleanupOffice = live && !inSetup(ctx) && !boardView ? office.officeMount(root, ctx, office.officeFromTeam(ctx, live, ctx.ui.officeTask)) : null;

  root.querySelector("[data-copy-pack]")?.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(ob?.pack ?? ""); ctx.toast("Folder path copied"); } catch { ctx.toast((ob?.pack ?? "")); }
  });
  root.querySelector("[data-open-teammd]")?.addEventListener("click", () => {
    const path = ob?.pack ? `${ob.pack}/TEAM.md` : null;
    const body = `<p class="${ctx.LABEL}">TEAM.md</p><div id="teammd" class="mt-3 whitespace-pre-wrap text-[12px] leading-relaxed text-foreground/85">Loading…</div>`;
    ctx.openSheet(body, (sheet) => {
      const el = sheet.querySelector("#teammd");
      if (path && ctx.S.onboarding) ctx.A.live.fileText(path).then((t) => { el.textContent = t; }).catch(() => { el.textContent = "TEAM.md is not written yet."; });
      else el.textContent = ctx.A.mockTeamMd(ob?.team);
    });
  });

  root.querySelectorAll("[data-sim='ob-task'], [data-sim='ob-task-own']").forEach((b) => {
    b.onclick = () => {
      const hired = members(ctx).map((a) => a.slug);
      const team = ctx.A.TEAMS.find((t) => t.chain.filter((s) => s !== "you").every((s) => hired.includes(s)));
      const task = b.dataset.sim === "ob-task" ? firstTaskOf(ctx) : "Make a reel about Claude Code skills for this week.";
      ctx.ui.run = ctx.A.newRun(team ? team.chain : hired.slice(0, 1), task);
      ctx.ui.liveView = false; ctx.saveUI();
      ctx.toast(b.dataset.sim === "ob-task" ? "Simulated: started" : "Simulated: you typed your own task");
      ctx.rerender();
    };
  });
  return () => { cleanupNow?.(); cleanupOffice?.(); };
}
