// OFFICE (home): your Teamly building. One floor = one team = one area of responsibility ("Content", "Legal").
// A building has up to 5 floors. Another person's teams or another business get an office of their own (another
// building): the tabs above the roof switch between offices, "New office" opens one.
// It grows like Tiny Tower: the lobby at the bottom, floors stacked on top in the order teams were made,
// a floor under construction on top to start the next team. Floors show their agents and what each is doing;
// A floor that waits for the person lights up (pulsing yellow outline, a big "!" over the agent who waits), and one
// short line above the building names it and opens the chat. Which office a team is in comes from the server
// (~/.teamly/offices.json): a floor being set up goes to the office it was opened for.
import { BANG, officeFromTeam, openNeeds } from "./office.js";
import { MODES } from "./overview.js";

const B = "./assets/building";
const MAX_FLOORS = 5;
// Each floor picture is drawn inside the same shell (design/gen_floors.py), so any floor stacks on any other.
const FLOOR_ART = [
  [/content|контент|reel|рилс|video|видео|соцсет|social|blog|блог/i, "floor-content"],
  [/legal|юр|law|o-1|visa|виза|кейс|contract|договор/i, "floor-legal"],
  [/fund|raise|invest|раунд|инвест/i, "floor-fundraising"],
  [/sales|продаж|deal|сделк|crm|lead|лид/i, "floor-sales"],
  [/hiring|найм|рекрут|recruit|hr\b|people|кадр/i, "floor-hiring"],
  [/product|продукт|dev|engineer|разработ|code|код|design|дизайн/i, "floor-product"],
  [/financ|финанс|account|бухгалт|money|деньг|tax|налог|budget|бюджет/i, "floor-finance"],
  [/support|поддерж|customer|клиент|help|ticket/i, "floor-support"],
];
export const floorFor = (text = "") => FLOOR_ART.find(([re]) => re.test(text))?.[1] ?? "floor-office";
// The library's area key for a team (content, legal, …), from the same rules as its floor; null for a general office.
export const areaOfTeam = (t) => { const f = floorFor(`${t.area ?? ""} ${t.name ?? ""}`); return f === "floor-office" ? null : f.replace("floor-", ""); };
// Floor art keeps its own aspect ratio, so floors stack without seams at any width.
const H = { roof: 186, "floor-content": 227, "floor-legal": 221, "floor-fundraising": 220, "floor-office": 219, "floor-build": 173, lobby: 226 };
const piece = (name, inner = "", cls = "") => `
  <div class="relative w-full ${cls}" style="aspect-ratio:1024/${H[name] ?? 219}">
    <img src="${B}/${name}.webp" alt="" draggable="false" class="pointer-events-none absolute inset-0 size-full select-none" />
    ${inner}
  </div>`;
const plate = (ctx, text, chip = "") => `
  <div class="pointer-events-none absolute flex items-center gap-1.5" style="left:54%;top:5%;transform:translateX(-50%)">
    <span class="${ctx.PX} whitespace-nowrap rounded border-2 border-black/80 bg-white px-1.5 py-1 text-[7px] shadow-[2px_2px_0_0_rgba(0,0,0,.8)]">${ctx.esc(text)}</span>${chip}
  </div>`;

const MARK = {
  working: () => `<span class="absolute -top-1 left-1/2 size-2.5 -translate-x-1/2 rounded-full border-2 border-white bg-emerald-500 shadow animate-pulse"></span>`,
  done: (ctx) => `<span class="absolute -right-0.5 top-0 flex size-4 items-center justify-center rounded border-2 border-white bg-[#4f5bd5] text-white">${ctx.icon("file", "size-2.5")}</span>`,
  hiring: () => `<span class="absolute -top-1.5 left-1/2 size-3.5 -translate-x-1/2 animate-spin rounded-full border-2 border-[#4f5bd5]/25 border-t-[#4f5bd5]"></span>`,
  // a badge beside the head (above it would hit the floor's name plate)
  needs: () => `
      <span class="absolute z-10 grid size-6 animate-bounce place-items-center rounded-full border-2 border-white bg-amber-400 text-white shadow-[0_2px_6px_rgba(180,120,0,.45)] min-[480px]:size-7" style="left:70%;bottom:58%">${BANG("size-3.5 min-[480px]:size-4")}</span>`,
  failed: (ctx) => `<span class="absolute -right-0.5 top-0 flex size-4 items-center justify-center rounded border-2 border-white bg-red-500 text-white">${ctx.icon("alert", "size-2.5")}</span>`,
};

// An agent being hired (team.hiring, written by the coordinator) stands on the floor greyed out until it's ready.
const HIRE_STAGE = { fork: "making it yours", config: "making it yours", install: "installing", desk: "getting a desk" };
const hiringOf = (t) => (Array.isArray(t.hiring) ? t.hiring : []).filter((h) => h.stage !== "ready" && !(t.agents ?? []).some((a) => a.slug === h.slug));

function floorAgents(ctx, t, o) {
  const people = [...(t.agents ?? []).map((a) => {
    const it = o?.items.find((x) => x.slug === a.slug);
    return { sprite: a.card?.sprite ?? ctx.A.agentBySlug[a.slug]?.sprite ?? it?.sprite ?? ctx.A.spriteFor(a.slug), status: it?.status ?? "idle", cloud: a.where === "cloud" };
  }), ...hiringOf(t).map((h) => ({ sprite: ctx.A.agentBySlug[h.upstream ?? h.slug]?.sprite ?? ctx.A.spriteFor(h.slug), status: "hiring" }))];
  const shown = people.slice(0, 3);
  const xs = shown.length === 1 ? [54] : shown.length === 2 ? [48, 60] : [43, 54, 65];
  return shown.map((p, i) => {
    const st = p.status === "blocked" || p.status === "needs_you" ? "needs" : p.status === "paused" ? "failed" : p.status;
    return `
    <div class="absolute" style="left:${xs[i]}%;bottom:13%;height:50%;aspect-ratio:1;transform:translateX(-50%)">
      ${st === "needs" ? `<span class="absolute left-1/2 h-[16%] w-[100%] -translate-x-1/2 rounded-[50%] bg-amber-300/40 animate-pulse" style="bottom:-3%"></span>` : ""}
      <img src="./assets/agents/${p.sprite}.png" alt="" class="size-full object-contain ${st === "working" || st === "needs" || st === "hiring" ? "" : "animate-[pixelBob_3s_ease-in-out_infinite]"}" style="${st === "idle" || st === "queued" ? "filter:saturate(.75)" : st === "hiring" ? "opacity:.45;filter:grayscale(1)" : ""}" />
      ${MARK[st]?.(ctx) ?? ""}
      ${p.cloud ? `<span title="Works in the cloud" class="absolute -left-0.5 bottom-1 flex size-4 items-center justify-center rounded-full border-2 border-white bg-sky-500 text-white">${ctx.icon("cloud", "size-2.5")}</span>` : ""}
    </div>`;
  }).join("") + (people.length > 3 ? `<span class="absolute rounded-full bg-white/90 px-1.5 py-0.5 text-[10px] font-semibold text-foreground/60" style="left:71%;bottom:16%">+${people.length - 3}</span>` : "");
}

function teamFloor(ctx, t) {
  const o = officeFromTeam(ctx, t, null);
  const done = o.items.filter((d) => d.status === "done").length;
  const working = o.items.some((d) => d.status === "working");
  const hire = hiringOf(t)[0];
  const chip = t.folderMissing ? `<span title="This floor's folder is not where it was. Open a chat in its new place and write Teamly v2: the coordinator moves the floor there." class="rounded-full border border-red-300 bg-red-50 px-1.5 py-0.5 text-[9.5px] font-semibold text-red-700">folder moved or deleted</span>`
    : t.setupPending ? `<span class="rounded-full border border-dashed border-[#4f5bd5]/60 bg-white px-1.5 py-0.5 text-[9.5px] font-semibold text-[#4f5bd5]">from ${ctx.esc(t.installedFrom?.author ?? "a file")} · setting up</span>`
    : o.needs ? `<span class="${ctx.PX} whitespace-nowrap border-2 border-amber-400 bg-amber-50 px-1.5 py-1 text-[7px] text-amber-800 shadow-[2px_2px_0_0_rgba(245,158,11,.55)]">Needs you</span>`
    : hire ? `<span class="rounded-full border border-dashed border-[#4f5bd5]/60 bg-white px-1.5 py-0.5 text-[9.5px] font-semibold text-[#4f5bd5]">hiring ${ctx.esc(hire.name ?? hire.slug)} · ${HIRE_STAGE[hire.stage] ?? "in the chat"}</span>`
    : working ? `<span class="flex items-center gap-1 rounded-full border border-emerald-300 bg-emerald-50 px-1.5 py-0.5 text-[9.5px] font-semibold text-emerald-700"><span class="size-1.5 animate-pulse rounded-full bg-emerald-500"></span>working · ${done}/${o.items.length}</span>`
    : o.title ? `<span class="rounded-full border border-black/10 bg-white px-1.5 py-0.5 text-[9.5px] text-foreground/55">${done}/${o.items.length} done</span>`
    : `<span class="rounded-full border border-black/10 bg-white px-1.5 py-0.5 text-[9.5px] text-foreground/50">no task yet</span>`;
  return `
  <button data-team="${ctx.esc(t.slug)}" class="group relative block w-full text-left" aria-label="Open ${ctx.esc(t.name)}">
    ${piece(floorFor(`${t.area ?? ""} ${t.name ?? ""}`), `
      ${floorAgents(ctx, t, o)}
      ${plate(ctx, t.name, chip)}
      ${o.needs ? `<div class="pointer-events-none absolute inset-[3%_2%_10%_2%] border-2 border-amber-400 animate-[needsGlow_1.8s_ease-in-out_infinite]"></div>` : ""}
      <div class="pointer-events-none absolute inset-[3%_2%_10%_2%] rounded-md ring-2 ring-[#4f5bd5]/0 transition group-hover:ring-[#4f5bd5]/50"></div>`)}
  </button>`;
}

// One short line above the building for a floor that waits for the person: which floor, and the way to answer.
// What exactly is asked stays in the chat (and in the tooltip): no step text here.
export function needsBar(ctx, t, o, office = "") {
  const here = !!o.needs.session && o.needs.session === ctx.A.hostChat;
  return `
    <button data-needs="${ctx.esc(t.slug)}" title="${ctx.esc(o.needs.what)}" class="mt-3 flex w-full items-center gap-2.5 border-2 border-amber-400 bg-amber-50 px-3 py-2 text-left shadow-[3px_3px_0_0_#f59e0b] hover:bg-amber-100 active:translate-x-[3px] active:translate-y-[3px] active:shadow-none">
      <span class="grid size-6 shrink-0 place-items-center rounded-full bg-amber-400 text-white">${BANG("size-3.5")}</span>
      <span class="${ctx.PX} min-w-0 flex-1 truncate text-[8px] leading-relaxed tracking-[0.06em] text-amber-900">${ctx.esc(t.name)} needs you${office ? ` · ${ctx.esc(office)}` : ""}</span>
      <span class="${ctx.PX} flex shrink-0 items-center gap-1 text-[7px] text-amber-800">${here ? "Answer on the left" : "Answer"}${ctx.icon("chevronRight", "size-3.5")}</span>
    </button>`;
}

export const BUILD = [["area", "Area"], ["goal", "Goal"], ["now", "How you work now"], ["approach", "Approach"], ["agents", "Agents"], ["open", "Open"]];
export const BUILD_AT = { start: 0, area: 0, goal: 1, now: 2, analysis: 2, jobs: 2, approaches: 3, match: 3, ontology: 4, fork: 4, forge: 4, team: 4, agents: 4, reports: 5, packaged: 5, started: 6 };
const BUILT = [0.12, 0.3, 0.45, 0.6, 0.78, 0.93, 1]; // share of the floor finished at each step

export function chainAgents(ctx, ob) {
  const picked = (ob.approaches ?? []).find((x) => (ob.picked ?? []).includes(x.slug));
  const made = (ob.forks ?? []).map((f) => ({ slug: f.slug, upstream: f.upstream, name: f.name, ready: true }));
  const planned = (picked?.chain ?? []).filter((s) => s !== "you" && !made.some((m) => m.upstream === s || m.slug === s))
    .map((s) => (s && typeof s === "object" ? { slug: `new-${s.create ?? "agent"}`, upstream: null, name: s.create ?? "New agent", ready: false }
      : { slug: s, upstream: s, name: ctx.A.agentBySlug[s]?.name ?? s, ready: false }));
  return [...made, ...planned];
}

// A floor under construction: bare concrete with scaffolding turns into the finished room of its area from left to
// right as the setup moves on; the goal gets pinned to the wall, agents walk in as they are made yours.
export function siteFloor(ctx, ob) {
  const at = BUILD_AT[ob?.step ?? "start"] ?? 0;
  const pct = Math.round(BUILT[at] * 100);
  const art = floorFor(`${ob?.team?.area ?? ""} ${ob?.team?.name ?? ""}`);
  const goal = ob?.goal && at >= 1 ? (ob.goal.target ?? ob.goal.title) : null;
  const agents = at >= 4 ? chainAgents(ctx, ob) : [];
  const xs = agents.length === 1 ? [54] : agents.length === 2 ? [48, 60] : [43, 54, 65];
  const mask = `linear-gradient(to right,#000 ${Math.max(0, pct - 4)}%,transparent ${Math.min(100, pct + 4)}%)`;
  return `
    <div class="relative w-full overflow-hidden" style="aspect-ratio:1024/219">
      <img src="${B}/floor-site.webp" alt="" class="absolute inset-0 size-full" />
      <img src="${B}/${art}.webp" alt="" class="absolute inset-0 size-full" style="-webkit-mask-image:${mask};mask-image:${mask}" />
      ${pct < 100 ? `<div class="pointer-events-none absolute inset-y-[6%] w-[3px] rounded bg-amber-400/80 shadow-[0_0_12px_4px_rgba(251,191,36,.45)] animate-pulse" style="left:${pct}%"></div>` : ""}
      ${goal ? `<div class="pointer-events-none absolute left-[6%] top-[14%] max-w-[30%] rotate-[-2deg] rounded-sm border-2 border-black/70 bg-amber-100 px-1.5 py-1 shadow-[2px_2px_0_0_rgba(0,0,0,.6)]"><span class="${ctx.PX} block text-[6px] text-amber-900">Goal</span><span class="mt-0.5 block truncate text-[10px] font-semibold leading-tight">${ctx.esc(goal)}</span></div>` : ""}
      ${agents.slice(0, 3).map((a, i) => `
        <div class="absolute" style="left:${xs[i]}%;bottom:13%;height:50%;aspect-ratio:1;transform:translateX(-50%)">
          <img src="./assets/agents/${ctx.A.agentBySlug[a.upstream]?.sprite ?? ctx.A.spriteFor(a.slug)}.png" alt="" class="size-full object-contain ${a.ready ? "animate-[pixelBob_3s_ease-in-out_infinite]" : ""}" style="${a.ready ? "" : "opacity:.4;filter:grayscale(1) brightness(1.3)"}" />
          ${a.ready ? "" : `<span class="absolute -top-1.5 left-1/2 size-3.5 -translate-x-1/2 animate-spin rounded-full border-2 border-[#4f5bd5]/25 border-t-[#4f5bd5]"></span>`}
        </div>`).join("")}
      ${plate(ctx, ob?.team?.name ?? "New floor", `<span class="whitespace-nowrap rounded-full border border-dashed border-amber-400 bg-white px-1.5 py-0.5 text-[9.5px] font-semibold text-amber-700">${pct >= 100 ? "open" : `building · ${pct}%`}</span>`)}
    </div>`;
}

const setupFloor = (ctx, ob, slug) => `
  <button data-team="${ctx.esc(slug ?? "__setup")}" class="relative block w-full text-left">${siteFloor(ctx, ob)}</button>`;

const newFloor = (ctx, n) => `
  <button data-new-team class="group relative block w-full">
    ${piece("floor-build", `
      <span class="absolute inset-x-[24%] top-[12%] bottom-[18%] flex items-center justify-center gap-2 rounded-lg border-2 border-dashed border-[#4f5bd5]/70 bg-white/95 text-[#4f5bd5] shadow-sm transition group-hover:bg-white">
        ${ctx.icon("plus", "size-4")}<span class="text-left"><span class="${ctx.PX} block text-[8px]">${n ? "New floor" : "Build your first floor"}</span><span class="mt-0.5 block text-[10.5px] text-foreground/55">${n ? "a new team for a new area" : "your first team, in the chat"}</span></span>
      </span>`)}
  </button>`;

// the coordinator writes the team record early, so a team can already be a floor while its setup goes on
const inBuild = (ctx, t) => { const ob = ctx.S.onboarding; return !!ob && ob.step !== "started" && typeof ob.team?.slug === "string" && ob.team.slug === t.slug; };

function officesOf(ctx) {
  const offices = ctx.S.offices?.length ? ctx.S.offices : [{ id: 1, name: "My office", floors: 0 }];
  const ob = ctx.S.onboarding;
  const teams = ctx.S.teams ?? [];
  const setup = ob?.step && ob.step !== "started" && !teams.some((t) => t.slug === ob.team?.slug) ? { name: ob.team?.name ?? "New team", step: ob.step, office: ctx.S.setupOffice ?? offices.at(-1).id } : null;
  const l = ctx.local("building");
  const pick = (id) => offices.find((o) => o.id === id);
  // An office picked in this panel stays. Until then: in a team's chat its office, else the office of the floor
  // being set up, else the last one picked.
  const host = teams.find((t) => t.coordinator_session && t.coordinator_session === ctx.A.hostChat);
  const site = setup?.office ?? teams.find((t) => inBuild(ctx, t))?.office;
  const cur = (l.picked && pick(l.office)) || pick(host?.office) || pick(site) || pick(l.office) || offices[0];
  return { offices, teams, setup, site, cur, allFull: offices.every((o) => o.floors >= MAX_FLOORS) };
}

const officeTab = (ctx, o, on, waits) => `
  <button data-office-id="${o.id}" aria-pressed="${on}" class="${ctx.PX} relative flex items-center gap-1.5 border-2 border-[#0a0a0a] px-2.5 py-2 text-[7.5px] ${on ? "bg-[#0a0a0a] text-white" : "bg-white text-[#0a0a0a] shadow-[2px_2px_0_0_#0a0a0a] hover:bg-[#eef1f5] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none"}">
    ${ctx.icon("building", "size-3 shrink-0")}<span class="max-w-[14ch] truncate">${ctx.esc(o.name)}</span>
    ${waits ? `<span title="Someone here needs you" class="absolute -right-2 -top-2 grid size-4 place-items-center rounded-full border-2 border-white bg-amber-400 text-white">${BANG("size-2.5")}</span>` : ""}
  </button>`;

export function render(ctx) {
  const { offices, teams, setup, cur, allFull } = officesOf(ctx);
  const here = teams.filter((t) => (t.office ?? 1) === cur.id).sort((a, b) => (b.created ?? 0) - (a.created ?? 0)); // newest on top
  const needs = teams.map((t) => ({ t, o: officeFromTeam(ctx, t, null) })).filter((x) => x.o.needs);
  const agents = here.reduce((n, t) => n + (t.agents ?? []).length, 0);
  const many = offices.length > 1;
  const building = setup?.office === cur.id;
  const floors = cur.floors ?? here.length + (building ? 1 : 0);
  const waits = new Set(needs.map(({ t }) => t.office).filter((id) => id !== cur.id));
  // the screen is a column: header on top, the building centred in the space left (a short office sits in the middle)
  return `
  <div class="flex min-h-full flex-col px-4 pb-8 pt-4">
    ${teams.length || setup ? "" : `<p class="text-[12px] text-muted-foreground">Your office starts with the lobby. Each team you make gets its own floor — up to 5.</p>`}
    ${needs.map(({ t, o }) => needsBar(ctx, t, o, many ? offices.find((x) => x.id === t.office)?.name ?? "" : "")).join("")}
    <div class="my-auto w-full py-6">
    <div class="mx-auto mb-4 flex w-full max-w-[540px] flex-wrap items-center gap-2.5">
      ${offices.map((o) => officeTab(ctx, o, o.id === cur.id, waits.has(o.id))).join("")}
      <button data-new-office class="${ctx.PX} flex items-center gap-1 border-2 border-dashed border-[#0a0a0a]/35 px-2.5 py-2 text-[7.5px] text-foreground/55 hover:border-[#0a0a0a] hover:text-foreground">${ctx.icon("plus", "size-3")}New office</button>
    </div>
    <div class="mx-auto w-full max-w-[540px]">
      ${piece("roof", `
        <span class="${ctx.PX} pointer-events-none absolute left-1/2 -translate-x-1/2 whitespace-nowrap border border-[#2b3042] bg-[#3a4054] px-1.5 py-[3px] text-[6px] tracking-[0.12em] text-white/90 shadow-[1px_1px_0_0_rgba(0,0,0,.35)]" style="bottom:7%">${floors}/${MAX_FLOORS} floors · ${agents} agents</span>`)}
      ${floors < MAX_FLOORS && !building ? newFloor(ctx, floors) : ""}
      ${building ? setupFloor(ctx, ctx.S.onboarding) : ""}
      ${here.map((t) => (inBuild(ctx, t) ? setupFloor(ctx, ctx.S.onboarding, t.slug) : teamFloor(ctx, t))).join("")}
      ${piece("lobby", `<img src="./assets/agents/formal01.png" alt="" class="pointer-events-none absolute animate-[pixelBob_3s_ease-in-out_infinite]" style="left:56%;bottom:13%;height:50%;transform:translateX(-50%)" />`)}
    </div>
    ${floors ? `
    <div class="mx-auto mt-5 grid w-full max-w-[540px] grid-cols-3 gap-2.5">
      ${MODES.map(([id, label, ic]) => `<button data-overview="${id}" class="${ctx.PX} flex items-center justify-center gap-1.5 border-2 border-[#0a0a0a] bg-white px-2 py-2.5 text-[8px] shadow-[3px_3px_0_0_#0a0a0a] hover:bg-[#eef1f5] active:translate-x-[3px] active:translate-y-[3px] active:shadow-none">${ctx.icon(ic, "size-3.5")}${label}</button>`).join("")}
    </div>
` : ""}
    ${floors >= MAX_FLOORS ? `<p class="mt-3 text-center text-[11.5px] text-foreground/50">${ctx.esc(cur.name)} is full — ${MAX_FLOORS} of ${MAX_FLOORS} floors.${allFull ? " Open a new office for the next team." : ""}</p>` : ""}
    </div>
  </div>`;
}

// A new office: a name, and (when a floor is being set up right now) whether that floor gets built there — ticked when
// it stands in the office you are looking at, since that's the one you'd move out.
function newOfficeSheet(ctx, l, building) {
  ctx.openSheet(`
    <p class="${ctx.LABEL}">New office</p>
    <h2 class="mt-2 text-[15px] font-semibold">A building of its own</h2>
    <p class="mt-1 text-[12.5px] leading-snug text-foreground/60">For another person or another business: its floors, plan and reports stay apart.</p>
    <input data-office-name maxlength="40" placeholder="Name, e.g. Anna or Bakery" class="mt-3 w-full border-2 border-[#0a0a0a] bg-white px-3 py-2 text-[13px] outline-none focus:border-[#4f5bd5]" />
    ${building ? `<label class="mt-3 flex items-start gap-2 text-[12.5px] leading-snug"><input data-office-move type="checkbox" ${building.here ? "checked" : ""} class="mt-0.5 accent-[#0a0a0a]" /><span>${building.name ? `Build <b>${ctx.esc(building.name)}</b> there: the floor being set up now` : "Build the floor being set up now there"}</span></label>` : ""}
    <button data-office-create class="${ctx.BTN} mt-4">Open the office</button>`, (sheet) => {
    const input = sheet.querySelector("[data-office-name]");
    input.focus();
    let busy = false;
    const create = async () => {
      if (busy) return;  // Enter twice or a double click opens one office, not two
      busy = true;
      try {
        const o = await ctx.A.live.newOffice(input.value, !!sheet.querySelector("[data-office-move]")?.checked);
        await ctx.refreshLive();
        Object.assign(l, { office: o.id, picked: true });
        ctx.closeSheet();
        ctx.toast(`${o.name} is open`);
        ctx.rerender();
      } catch (e) { busy = false; ctx.toast(`Couldn't open a new office: ${e.message}`); }
    };
    sheet.querySelector("[data-office-create]").onclick = create;
    input.onkeydown = (e) => { if (e.key === "Enter") create(); };
  });
}

export function mount(root, ctx) {
  const l = ctx.local("building");
  const { offices, teams, setup, cur } = officesOf(ctx);
  root.querySelectorAll("[data-team]").forEach((b) => {
    b.onclick = () => { ctx.ui.teamSlug = b.dataset.team === "__setup" ? null : b.dataset.team; ctx.saveUI(); ctx.go("team"); };
  });
  root.querySelectorAll("[data-overview]").forEach((b) => { b.onclick = () => { Object.assign(ctx.ui, { overview: b.dataset.overview, overviewOffice: cur.id }); ctx.saveUI(); ctx.go("overview"); }; });
  root.querySelectorAll("[data-office-id]").forEach((b) => { b.onclick = () => { Object.assign(l, { office: Number(b.dataset.officeId), picked: true }); ctx.rerender(); }; });
  const built = teams.find((t) => inBuild(ctx, t));
  const buildingNow = setup ? { name: ctx.S.onboarding?.team?.name ?? "", here: setup.office === cur.id } : built ? { name: built.name ?? "", here: built.office === cur.id } : null;
  root.querySelector("[data-new-office]")?.addEventListener("click", () => newOfficeSheet(ctx, l, buildingNow));
  root.querySelectorAll("[data-needs]").forEach((b) => {
    b.onclick = () => {
      const t = (ctx.S.teams ?? []).find((x) => x.slug === b.dataset.needs);
      const o = t ? officeFromTeam(ctx, t, null) : null;
      if (o?.needs) openNeeds(ctx, o);
    };
  });
  root.querySelector("[data-new-team]")?.addEventListener("click", () => {
    if (!teams.length && !setup) {  // the very first floor: the coordinator in this chat is starting it, no new chat needed
      return ctx.openSheet(`
      <p class="${ctx.LABEL}">Your first floor</p>
      <h2 class="mt-2 text-[15px] font-semibold">It is being built in the chat on the left</h2>
      <p class="mt-2 text-[13px] text-foreground/80">Answer the coordinator there: which area this team takes, then the goal. The floor appears here while you answer. A new chat in a new folder is only for another floor, later.</p>
      <button data-close class="${ctx.BTN} mt-4">Got it</button>`, (sheet) => { sheet.querySelector("[data-close]").onclick = () => ctx.closeSheet(); });
    }
    // with several offices the floor goes where you pressed "New floor" (not while another floor is being set up)
    if (offices.length > 1 && !buildingNow) ctx.A.live.nextOffice(cur.id).catch(() => { /* the floor takes the first free office */ });
    ctx.openSheet(`
      <p class="${ctx.LABEL}">New floor</p>
      <h2 class="mt-2 text-[15px] font-semibold">Each floor is a team with its own chat and folder</h2>
      <ol class="mt-3 list-decimal space-y-1.5 pl-5 text-[13px] text-foreground/80">
        <li>In the sidebar on the left: <b>New chat</b> → pick a <b>new empty folder</b> (e.g. “Legal”).</li>
        <li>Write <b>Teamly v2</b>.</li>
        <li>The coordinator asks which area this team takes, then the goal — and shows how others reach it. The floor gets built while you answer.</li>
      </ol>
      <p class="mt-3 text-[11px] text-foreground/45">The panel can't open chats by itself — Claude Code creates a chat only when you start it.</p>
      <button data-close class="${ctx.BTN} mt-4">Got it</button>`, (sheet) => { sheet.querySelector("[data-close]").onclick = () => ctx.closeSheet(); });
  });
}
