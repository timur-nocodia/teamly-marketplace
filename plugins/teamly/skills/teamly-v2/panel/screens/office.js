// OFFICE: the team in the original Teamly isometric room, made informative.
// - Working agents play the chroma-keyed "working" clip; the bubble says WHAT they do (concrete line from STATUS.md).
// - Done agents carry a file badge. Agents that can't go on because they wait for the person get a yellow "!".
// - The person is NOT in the room: a "Needs you" button above the room says what is needed and who is blocked.
// - Below: Now / Next and the step timeline (who, status, action, file).
// Used inside the Team screen (team opens straight into its office) and on its own for the demo run.
import { liveSteps, who, openStep } from "./now.js";

const POSITIONS = [{ x: 28, y: 58 }, { x: 50, y: 44 }, { x: 72, y: 58 }, { x: 50, y: 76 }]; // platform slots: 4 a room (Igor 17.11)
const AGENT_SIZE = "clamp(64px, 20cqw, 132px)";
const PALETTE = ["#4f5bd5", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#0ea5e9", "#14b8a6", "#f97316"];
const colorOf = (s) => PALETTE[[...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % PALETTE.length];
const STATUS = {
  working: { label: "Working", box: "border-emerald-300/50 bg-emerald-50", dot: "bg-emerald-400 animate-pulse", text: "text-emerald-600" },
  done: { label: "Done", box: "border-[#4f5bd5]/30 bg-[#4f5bd5]/5", dot: "bg-[#4f5bd5]", text: "text-[#4f5bd5]" },
  needs_you: { label: "Needs you", box: "border-amber-300 bg-amber-50", dot: "bg-amber-400 animate-pulse", text: "text-amber-700" },
  blocked: { label: "Blocked", box: "border-amber-300 bg-amber-50", dot: "bg-amber-400", text: "text-amber-700" },
  failed: { label: "Failed", box: "border-red-300/50 bg-red-50", dot: "bg-red-400", text: "text-red-500" },
  paused: { label: "Paused", box: "border-red-300/50 bg-red-50", dot: "bg-red-400", text: "text-red-500" },
  queued: { label: "Waiting", box: "border-border bg-muted/60", dot: "bg-foreground/25", text: "text-foreground/45" },
  idle: { label: "Idle", box: "border-border bg-muted/60", dot: "bg-foreground/25", text: "text-foreground/45" },
};
const badge = (ctx, s) => {
  const st = STATUS[s] ?? STATUS.queued;
  return `<span class="flex shrink-0 items-center gap-1 rounded-sm border px-1.5 py-0.5 ${st.box}"><span class="size-1 rounded-full ${st.dot}"></span><span class="${ctx.PX} text-[6px] ${st.text}">${st.label}</span></span>`;
};
// Same areas as the building floors (teams.js), so a team's floor and its room match.
const officeFor = (area = "") =>
  /content|контент|reel|рилс|video|видео|соцсет|social/i.test(area) ? "Content_Marketing_Team.webp"
  : /legal|юр|law|o-1|visa|виза|кейс|contract/i.test(area) ? "Legal_Team.webp"
  : /fund|raise|invest|раунд|инвест|деньг/i.test(area) ? "Fundraising_Team.webp"
  : /sales|продаж|deal|сделк/i.test(area) ? "Sales_Team.webp"
  : /hr|people|кадр|hiring|найм/i.test(area) ? "HR_Team.webp"
  : "Generic_Team_01.webp";
// The panel speaks English: a Cyrillic name from an old team record yields to the library card's English one.
const pick = (own, card) => (own && !(/[а-яё]/i.test(own) && card) ? own : card ?? own);
const shorten = (t, n) => { const s = String(t ?? "").trim(); return s.length <= n ? s : `${s.slice(0, n - 1)}…`; };
// STATUS.md lines start with the status word; bubbles and timeline show only the action.
function cleanLine(line = "") {
  return String(line).replace(/^(готово|в работе|пауза( с [\d:]+)?|ждём|ждем|ждёт|ждет|ошибка|done|working|waiting for you|waiting|failed|paused)\s*[\d:]*\s*[:—-]?\s*/i, "").trim() || line;
}

// Agents after a step that waits for the person can't go on: mark them blocked (yellow "!").
function markBlocked(items) {
  const i = items.findIndex((d) => d.status === "needs_you");
  if (i < 0) return items;
  return items.map((d, k) => (k > i && d.status === "queued" ? { ...d, status: "blocked", line: "Can't start until you do your step" } : d));
}

// ---------------------------------------------------------------- data
// The clean "!" of every "needs you" mark (the pixel font's one looks crooked at these sizes).
export const BANG = (cls = "size-3.5") => `<svg viewBox="0 0 24 24" class="${cls}" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5.5v8"/><circle cx="12" cy="18.6" r="1.8" fill="currentColor" stroke="none"/></svg>`;

const say = (m, v) => (m.labels && m.labels[String(v)]) || shortNum(v);  // answered with buttons: the button's words
const shortNum = (n) => (Math.abs(n) >= 1e4 ? `${Math.round(n / 1e3)}K` : Math.abs(n) >= 1e3 ? `${+(n / 1e3).toFixed(1)}K` : `${+Number(n).toFixed(1)}`);

export function officeFromTeam(ctx, team, taskFolder) {
  const tasks = team.tasks ?? [];
  const task = tasks.find((x) => x.folder === taskFolder) ?? tasks.find((x) => x.active) ?? team.task ?? tasks[0] ?? null;
  const agentInfo = (slug) => {
    const ta = (team.agents ?? []).find((x) => x.slug === slug);
    const lib = ctx.A.agentBySlug[slug] ?? ctx.A.agentBySlug[ta?.upstream ?? ta?.card?.upstream];
    // its own number under its name (Builder, forge/scripts/metrics.py): start without it → now
    const m = ta?.metrics?.agent;
    const number = m && m.count > 1 && m.baselineWithout && Number.isFinite(m.baseline) && Number.isFinite(m.now)
      ? { text: `${say(m, m.baseline)} → ${say(m, m.now)}${m.unit && !(m.labels && m.labels[String(m.now)]) ? ` ${m.unit}` : ""} · ${m.short || m.name}`, name: m.name ?? "", up: Number(m.change) >= 0 } : null;  // a cut name, never a cut number
    return { name: pick(ta?.name, ta?.card?.name ?? lib?.name), role: pick(ta?.role, ta?.card?.role ?? lib?.role), sprite: ta?.card?.sprite ?? lib?.sprite ?? ctx.A.spriteFor(slug), number,
      dash: !!ta?.canvas };  // {name, port, dir, up} from the panel server (canvas_of)  // it has its own page: a click opens it (screens/dashboard.js)
  };
  if (!task) {
    return { title: null, live: true, area: `${team.area ?? ""} ${team.name ?? ""}`, team: team.slug, rooms: team.rooms ?? null,
      items: (team.agents ?? []).map((a) => ({ slug: a.slug, member: true, status: "idle", line: "", team: team.slug, session: a.session ?? null, where: a.where ?? "local", shareReady: !!a.share?.ready, ...agentInfo(a.slug) })) };
  }
  const marked = markBlocked(liveSteps({ ...team, task }));
  // a question that waits in another open task counts too: three days of waiting must not read as nothing to do
  const otherAsk = taskFolder ? null : tasks.filter((x) => x !== task && !x.complete && x.status?.rows?.length)
    .map((x) => liveSteps({ ...team, task: x }).find((st) => st.status === "needs_you")).find(Boolean);
  const ask = marked.find((s) => s.status === "needs_you") ?? otherAsk;
  const items = marked.filter((s) => s.slug !== "you").map((s) => ({
    slug: s.slug, status: s.status, line: s.status === "blocked" ? s.line : cleanLine(s.line), file: s.file?.path ?? null, fileName: s.file?.name ?? s.fileName, team: team.slug, ...agentInfo(s.slug),
    session: (team.agents ?? []).find((a) => a.slug === s.slug)?.session ?? null,
    where: (team.agents ?? []).find((a) => a.slug === s.slug)?.where ?? "local",
    shareReady: !!(team.agents ?? []).find((a) => a.slug === s.slug)?.share?.ready,
    member: (team.agents ?? []).some((a) => a.slug === s.slug),
  }));
  // agents of the floor who aren't in this task sit in the room too (a hired or received one has to be reachable)
  for (const a of team.agents ?? []) {
    if (a?.slug && !items.some((x) => x.slug === a.slug)) {
      items.push({ slug: a.slug, member: true, status: "idle", line: "", team: team.slug, session: a.session ?? null, where: a.where ?? "local",
        shareReady: !!a.share?.ready, ...agentInfo(a.slug) });
    }
  }
  return {
    title: task.status?.title ?? task.name, live: true, started: task.status?.started, area: `${team.area ?? ""} ${team.name ?? ""}`, team: team.slug,
    rooms: team.rooms ?? null,
    now: task.status?.now, next: task.status?.next, folder: task.folder,
    // every step in order, the person's own included: the process at a glance
    steps: marked.map((s) => ({ slug: s.slug, status: s.status, name: s.slug === "you" ? "You" : agentInfo(s.slug).name ?? s.who ?? s.slug })),
    needs: ask ? {
      what: cleanLine(ask.line) || "Your step",
      from: ask.slug === "you" ? null : agentInfo(ask.slug).name,
      blocked: items.filter((d) => d.status === "blocked").map((d) => d.name ?? d.slug),
      // questions are asked in the coordinator's chat (agents pass them up); only a status that says
      // "(in its chat)" / "(in its cloud chat)" means the question waits in the agent's own chat
      session: /\(in its (cloud )?chat\)/i.test(ask.line ?? "")
        ? ((team.agents ?? []).find((a) => a.slug === ask.slug)?.session ?? team.coordinator_session ?? null)
        : (team.coordinator_session ?? (team.agents ?? []).find((a) => a.slug === ask.slug)?.session ?? null),
    } : null,
    items,
  };
}

export function officeFromRun(ctx) {
  const run = ctx.ui.run;
  if (!run) return null;
  const steps = run.steps.map((s, i) => {
    const a = ctx.A.agentBySlug[s.slug];
    const failed = run.phase === "failed" && run.cur === i;
    const paused = run.phase === "no_credits" && run.cur === i;
    const status = failed ? "failed" : paused ? "paused" : s.status;
    const line = status === "working" ? a?.working?.[s.lineIdx] : status === "done" ? "Result is on the desk" : status === "needs_you" ? "Your take for the script" : failed ? "Stopped — see the chat" : paused ? "Paused: out of credits" : "Waits for the previous step";
    return { slug: s.slug, status, line, file: status === "done" && s.slug !== "you" ? s.slug : null, fileName: "result", spent: s.spent };
  });
  const marked = markBlocked(steps);
  const human = steps.find((s) => s.slug === "you" && s.status === "needs_you");
  return {
    title: run.task, live: false, area: "content", started: new Date(run.startedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    needs: human ? { what: human.line, blocked: marked.filter((d) => d.status === "blocked").map((d) => who(ctx, d.slug).name) } : null,
    items: marked.filter((s) => s.slug !== "you"),
  };
}

// ---------------------------------------------------------------- room
function agentInRoom(ctx, d, i, selected) {
  const base = who(ctx, d.slug);
  const a = { ...base, name: d.name ?? base.name, role: d.role ?? base.role, sprite: d.sprite ?? base.sprite };
  const pos = POSITIONS[i % POSITIONS.length];
  const working = d.status === "working";
  const dim = d.status === "queued" || d.status === "idle";
  const warn = d.status === "blocked" || d.status === "needs_you";
  return `
  <button type="button" data-room-agent="${ctx.esc(d.slug)}" ${working ? "data-working" : ""}
    class="absolute w-max rounded-xl outline-none transition-all duration-300 ${selected === d.slug ? "z-10 scale-110" : "z-0 hover:scale-105"}"
    style="left:${pos.x}%;top:${pos.y}%;transform:translate(-50%,-50%);filter:${dim ? "brightness(0.8) saturate(0.5)" : "none"}">
    <div class="flex flex-col items-center">
      <div class="relative">
        <div class="pointer-events-none absolute" style="bottom:-4px;left:50%;transform:translateX(-50%);width:calc(var(--as) * 0.6);height:calc(var(--as) * 0.12);border-radius:50%;background:radial-gradient(ellipse, ${colorOf(d.slug)}40 0%, transparent 70%)"></div>
        <div class="relative ${working ? "" : "animate-[pixelBob_3s_ease-in-out_infinite]"}" style="width:var(--as);height:var(--as);filter:drop-shadow(0 4px 8px rgba(0,0,0,0.15))">
          <img data-idle src="./assets/agents/${a.sprite ?? "create-agent-silhouette"}.png" alt="" draggable="false" class="pointer-events-none size-full select-none transition-opacity duration-200" />
          ${working && a.sprite ? `<video data-work-video src="./assets/agents/${a.sprite}-working.webm" muted loop playsinline preload="auto" class="pointer-events-none absolute inset-0 size-full opacity-0"></video>
          <canvas data-work-canvas width="192" height="192" class="pointer-events-none absolute inset-0 size-full opacity-0"></canvas>` : ""}
        </div>
        ${d.status === "done" ? `<span class="absolute -right-1 top-1 flex size-6 items-center justify-center rounded-md border-2 border-white bg-[#4f5bd5] text-white shadow">${ctx.icon("file", "size-3.5")}</span>` : ""}
        ${warn ? `<span class="absolute left-1/2 -top-2 flex size-7 -translate-x-1/2 items-center justify-center rounded-full border-2 border-white bg-amber-400 text-[15px] font-black text-white shadow animate-bounce">!</span>` : ""}
        ${d.where === "cloud" ? `<span title="Works in the cloud" class="absolute -left-1 bottom-2 flex size-6 items-center justify-center rounded-full border-2 border-white bg-sky-500 text-white shadow">${ctx.icon("cloud", "size-3.5")}</span>` : ""}
        ${d.status === "failed" || d.status === "paused" ? `<span class="absolute -right-1 top-1 flex size-6 items-center justify-center rounded-md border-2 border-white bg-red-500 text-white shadow">${ctx.icon("alert", "size-3.5")}</span>` : ""}
      </div>
      <div class="-mt-1 flex max-w-[26cqw] flex-col items-center rounded-md bg-background/80 px-2 py-0.5 backdrop-blur-sm">
        <span class="block max-w-full truncate text-[12px] font-bold">${ctx.esc(a.name)}${d.shareReady ? ' <span class="rounded bg-[#4f5bd5]/10 px-1 text-[8px] font-semibold text-[#4f5bd5] align-middle">★ ready to share</span>' : ""}</span>
        <span class="block max-w-full truncate text-[8px] font-medium uppercase tracking-wider text-muted-foreground">${ctx.esc(shorten(a.role ?? "", 26))}</span>
        ${d.dash ? `<span class="${ctx.PX} mt-0.5 flex items-center gap-0.5 rounded bg-[#4f5bd5] px-1.5 py-[3px] text-[6px] text-white">Dashboard ${ctx.icon("chevronRight", "size-2.5")}</span>` : ""}
        ${d.number ? `<span title="${ctx.esc(d.number.name)}: from the start without it to now" class="block max-w-full truncate text-[9px] font-semibold ${d.number.up ? "text-[#4f5bd5]" : "text-muted-foreground"}">${ctx.esc(d.number.text)}</span>` : ""}
      </div>
    </div>
  </button>`;
}

function bubble(ctx, d, i) {
  if (!["working", "failed", "paused"].includes(d.status) || !d.line) return "";
  const pos = POSITIONS[i % POSITIONS.length];
  const raw = pos.x < 50 ? `${pos.x}cqw + 20px - var(--bw)` : pos.x > 50 ? `${pos.x}cqw - 20px` : `${pos.x}cqw - var(--bw) / 2`;
  const tone = d.status === "working" ? "border-border bg-card" : "border-red-300 bg-red-50";
  return `
  <div class="pointer-events-none absolute z-20" style="--bw:min(160px, 42cqw);--bl:clamp(4px, calc(${raw}), calc(100cqw - var(--bw) - 4px));left:var(--bl);width:var(--bw);top:calc(${pos.y}% - var(--as) / 2 - 22px);transform:translateY(-100%)">
    <div class="animate-[bubbleIn_0.3s_ease-out_both]">
      <div class="rounded-xl border-2 ${tone} px-2.5 py-1.5" style="box-shadow:0 8px 24px rgba(0,0,0,0.08)">
        <p class="line-clamp-3 text-[10.5px] font-medium leading-snug">${d.status === "working" ? '<span class="mr-1 inline-block size-1.5 animate-pulse rounded-full bg-emerald-500 align-middle"></span>' : ""}${ctx.esc(shorten(d.line, 90))}</p>
      </div>
      <div class="-mt-[6px] size-3 rotate-45 border-b-2 border-r-2 ${tone}" style="margin-left:clamp(12px, calc(${pos.x}cqw - var(--bl) - 6px), calc(var(--bw) - 24px))"></div>
    </div>
  </div>`;
}


// ---------------------------------------------------------------- the office block
// How a step stands in the process: the ring around its avatar, a badge, one word.
const KIND = { done: "done", working: "working", needs_you: "you", failed: "failed" };
const RING = { done: "ring-emerald-400", working: "ring-[#4f5bd5]", you: "ring-amber-400", failed: "ring-red-400", waiting: "ring-foreground/15" };
const WORD = { done: ["Done", "text-emerald-700"], working: ["Working", "text-[#4f5bd5]"], you: ["Your turn", "text-amber-700"],
  failed: ["Stopped", "text-red-600"], waiting: ["Waiting", "text-foreground/40"] };
const BADGE = {
  done: (ctx) => `<span class="absolute -right-1.5 -top-1.5 grid size-[18px] place-items-center rounded-full bg-emerald-500 text-white ring-2 ring-white">${ctx.icon("check", "size-2.5")}</span>`,
  working: () => '<span class="absolute -right-0.5 -top-0.5 size-3.5 animate-pulse rounded-full bg-[#4f5bd5] ring-2 ring-white"></span>',
  you: () => `<span class="absolute -right-1.5 -top-1.5 grid size-[18px] place-items-center rounded-full bg-amber-400 text-white ring-2 ring-white">${BANG("size-2.5")}</span>`,
  failed: (ctx) => `<span class="absolute -right-1.5 -top-1.5 grid size-[18px] place-items-center rounded-full bg-red-500 text-white ring-2 ring-white">${ctx.icon("alert", "size-2.5")}</span>`,
};

// Under the room: the task as a loop — the steps in even columns on one line, each an avatar with how it stands,
// and the way back to the start for the next run. A finished step opens its result; on the person's turn, one line.
function processTrack(ctx, o) {
  const steps = o.steps?.length ? o.steps : o.items;
  const done = steps.filter((s) => s.status === "done").length;
  const here = !!o.needs?.session && o.needs.session === ctx.A.hostChat;
  const line = (status, side) => `<span class="absolute top-[26px] h-[3px] -translate-y-1/2 ${side === "left" ? "left-0 right-1/2" : "left-1/2 right-0"} ${status === "done" ? "bg-emerald-300" : "bg-foreground/10"}"></span>`;
  const cell = (s, i) => {
    const kind = KIND[s.status] ?? "waiting";
    const d = o.items.find((x) => x.slug === s.slug);
    const face = s.slug === "you"
      ? `<span class="grid size-full place-items-center rounded-full bg-amber-50 text-amber-600">${ctx.icon("hand", "size-6")}</span>`
      : `<img src="./assets/profiles/${ctx.esc(d?.sprite ?? who(ctx, s.slug).sprite ?? "formal01")}.png" alt="" class="size-full rounded-full object-cover object-[50%_30%]" />`;
    const [word, tone] = WORD[kind];
    const inner = `
      ${i ? line(steps[i - 1].status, "left") : ""}${i < steps.length - 1 ? line(s.status, "right") : ""}
      <span class="relative z-10 block size-[52px] rounded-full bg-white ring-[3px] ring-offset-2 ring-offset-white ${RING[kind]}">${face}${BADGE[kind]?.(ctx) ?? ""}</span>
      <span class="mt-2.5 line-clamp-2 px-1 text-[11.5px] font-medium leading-[15px]">${ctx.esc(s.name ?? s.slug)}</span>
      <span class="${ctx.PX} mt-1 text-[6px] ${tone}">${word}</span>`;
    return d?.file
      ? `<button data-desk-file="${ctx.esc(d.file)}" data-live="${o.live ? 1 : 0}" title="Open ${ctx.esc(d.fileName ?? "the result")}" class="relative row-span-3 grid grid-rows-subgrid justify-items-center text-center hover:opacity-80">${inner}</button>`
      : `<div class="relative row-span-3 grid grid-rows-subgrid justify-items-center text-center">${inner}</div>`;
  };
  return `
  <div class="mt-4 border-2 border-foreground/10 bg-card px-3.5 pb-3.5 pt-3">
    <div class="flex items-baseline gap-2">
      <p class="min-w-0 flex-1 truncate text-[13.5px] font-semibold">${ctx.esc(String(o.title).replace(/^task:\s*/i, ""))}</p>
      ${o.live ? '<span class="flex shrink-0 items-center gap-1 text-[10px] text-emerald-600"><span class="size-1.5 animate-pulse rounded-full bg-emerald-500"></span>live</span>' : ""}
      <span class="shrink-0 text-[11px] text-foreground/50">${done}/${steps.length}</span>
    </div>
    <div class="mt-5 grid" style="grid-template-columns:repeat(${steps.length},minmax(0,1fr));grid-template-rows:auto auto auto">${steps.map(cell).join("")}</div>
    <div class="mt-2 flex items-center gap-2 px-[8%] text-foreground/35">
      <span class="h-0 flex-1 border-t-2 border-dashed border-foreground/15"></span>
      ${ctx.icon("refresh", "size-3")}<span class="${ctx.PX} text-[6px]">Then again, for the next one</span>
      <span class="h-0 flex-1 border-t-2 border-dashed border-foreground/15"></span>
    </div>
    ${o.needs ? `
    <button data-needs-you title="${ctx.esc(o.needs.what)}" class="mt-3.5 flex w-full items-center gap-2.5 border-2 border-amber-400 bg-amber-50 px-3 py-2 text-left shadow-[3px_3px_0_0_#f59e0b] hover:bg-amber-100 active:translate-x-[3px] active:translate-y-[3px] active:shadow-none">
      <span class="grid size-6 shrink-0 place-items-center rounded-full bg-amber-400 text-white">${BANG("size-3.5")}</span>
      <span class="${ctx.PX} min-w-0 flex-1 truncate text-[8px] leading-relaxed text-amber-900">Needs you${o.needs.from ? ` · ${ctx.esc(o.needs.from)}` : ""}</span>
      <span class="${ctx.PX} flex shrink-0 items-center gap-1 text-[7px] text-amber-800">${here ? "Answer on the left" : "Answer"}${ctx.icon("chevronRight", "size-3.5")}</span>
    </button>` : ""}
  </div>`;
}

// ---------------------------------------------------------------- rooms of a floor
// Igor 17.11: a floor holds up to 3 rooms of up to 4 agents (server.py «rooms of a floor»: who sits where).
// Tabs above the picture switch rooms; "+ Room" adds one; "+ Agent" in a room sends the next hired or built agent there.
const ROOMS_MAX = 3, ROOM_SEATS = 4;
export function roomView(ctx, o) {
  const rooms = Array.isArray(o.rooms) && o.rooms.length ? o.rooms : null;
  if (!rooms || !o.team) return { rooms: null, at: 0, items: o.items, waiting: 0 };
  const pickd = (ctx.ui.room ??= {})[o.team];
  const at = Number.isInteger(pickd) && pickd >= 0 && pickd < rooms.length ? pickd : 0;
  const seated = new Set(rooms.flatMap((r) => r.agents));
  const floor = new Set(o.items.filter((d) => d.member).map((d) => d.slug));
  // an agent in a room sits there; one only in this task (not on the floor) sits in the first room
  const inRoom = (d, i) => (rooms[i].agents.includes(d.slug) || (i === 0 && !seated.has(d.slug) && !floor.has(d.slug)));
  const items = o.items.filter((d) => inRoom(d, at)).sort((a, b) => rooms[at].agents.indexOf(a.slug) - rooms[at].agents.indexOf(b.slug));
  const waiting = [...floor].filter((x) => !seated.has(x)).length;
  return { rooms, at, items, waiting, inRoom };
}

function roomTabs(ctx, o, v) {
  if (!v.rooms) return "";
  const busy = (i) => o.items.filter((d) => v.inRoom(d, i));
  const tab = (r, i) => {
    const ds = busy(i);
    const mark = ds.some((d) => d.status === "needs_you" || d.status === "blocked") ? '<span class="size-1.5 rounded-full bg-amber-400"></span>'
      : ds.some((d) => d.status === "working") ? '<span class="size-1.5 animate-pulse rounded-full bg-emerald-400"></span>' : "";
    return `<button data-room-tab="${i}" class="flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] ${i === v.at ? "bg-card font-semibold shadow-sm" : "text-foreground/55 hover:text-foreground"}">${ctx.esc(r.name)}<span class="text-[10px] text-foreground/40">${r.agents.length}/${ROOM_SEATS}</span>${mark}</button>`;
  };
  return `
  <div class="mx-auto mt-3 flex w-full max-w-[640px] items-center gap-1 overflow-x-auto rounded-lg bg-muted p-1">
    ${v.rooms.map(tab).join("")}
    ${v.rooms.length < ROOMS_MAX ? `<button data-room-add class="flex shrink-0 items-center gap-1 rounded-md px-2.5 py-1 text-[12px] text-[#4f5bd5] hover:bg-card">${ctx.icon("plus", "size-3")} Room</button>` : ""}
    <span class="flex-1"></span>
    ${o.items.length > 1 || v.rooms.length > 1 ? `<button data-room-arrange class="shrink-0 rounded-md px-2 py-1 text-[11px] text-foreground/50 hover:text-foreground">Arrange</button>` : ""}
  </div>`;
}

export function officeHTML(ctx, o) {
  const l = ctx.local("office");
  const v = roomView(ctx, o);
  const items = v.items;
  const room = v.rooms?.[v.at];
  const free = room && room.agents.length < ROOM_SEATS;
  return `
  ${roomTabs(ctx, o, v)}
  <section class="mx-auto ${v.rooms ? "mt-2" : "mt-3"} w-full max-w-[640px] overflow-hidden rounded-xl bg-muted py-2" aria-label="Office">
    <div class="relative mx-auto aspect-square w-full select-none" style="container-type:inline-size;--as:${AGENT_SIZE}">
      <img src="./assets/offices/${officeFor(o.area)}" alt="" draggable="false" class="pointer-events-none absolute inset-0 size-full object-contain animate-[fadeIn_500ms_ease-out]" />
      ${items.map((d, i) => agentInRoom(ctx, d, i, l.selected)).join("")}
      ${items.map((d, i) => bubble(ctx, d, i)).join("")}
      ${items.length ? `<p class="pointer-events-none absolute bottom-2 left-3 ${ctx.PX} text-[7px] text-foreground/30">Tap an agent</p>` : `<p class="absolute inset-x-0 top-1/2 text-center ${ctx.PX} text-[8px] text-foreground/35">${room ? "Empty room" : "No agents yet"}</p>`}
      ${free && o.live ? `<button data-room-hire class="absolute bottom-2 right-3 flex items-center gap-1 rounded-md border-2 border-dashed border-[#4f5bd5]/40 bg-card/80 px-2 py-1 text-[11px] font-medium text-[#4f5bd5] backdrop-blur-sm hover:border-[#4f5bd5]">${ctx.icon("plus", "size-3")} Agent</button>` : ""}
      ${!o.title && items.length ? `<p class="absolute inset-x-0 bottom-8 text-center text-[11px] text-foreground/50">No task running — ask the coordinator in this team's chat</p>` : ""}
    </div>
  </section>
  ${v.waiting ? `<p class="mx-auto mt-1.5 max-w-[640px] text-center text-[11px] text-amber-700">${v.waiting} more ${v.waiting === 1 ? "agent waits" : "agents wait"} for a place: ${ROOMS_MAX} rooms of ${ROOM_SEATS} are full. Start a new floor for them.</p>` : ""}
  ${o.title ? processTrack(ctx, o) : ""}`;
}

// Who sits where: every agent of the floor with a button per room. A full room takes no one; an empty extra room goes.
function arrangeSheet(ctx, o, v) {
  const names = Object.fromEntries(o.items.map((d) => [d.slug, d.name ?? who(ctx, d.slug).name ?? d.slug]));
  const rows = v.rooms.flatMap((r, i) => r.agents.map((slug) => ({ slug, i })));
  ctx.openSheet(`
    <p class="pt-3 text-[15px] font-semibold">Rooms of this floor</p>
    <p class="mt-1 text-[12px] text-foreground/55">Up to ${ROOMS_MAX} rooms, ${ROOM_SEATS} agents in each. Every agent works the same in any room.</p>
    <div class="mt-3 flex flex-col gap-1.5">
      ${rows.map((x) => `<div class="flex items-center gap-2 rounded-lg bg-muted px-2.5 py-1.5">
        <span class="min-w-0 flex-1 truncate text-[13px]">${ctx.esc(names[x.slug] ?? x.slug)}</span>
        ${v.rooms.map((r, i) => `<button data-move="${ctx.esc(x.slug)}" data-to="${i}" ${i !== x.i && r.agents.length >= ROOM_SEATS ? "disabled" : ""} class="rounded px-2 py-0.5 text-[11px] ${i === x.i ? "bg-[#4f5bd5] text-white" : "bg-card text-foreground/60 hover:text-foreground disabled:opacity-30"}">${ctx.esc(r.name)}</button>`).join("")}
      </div>`).join("") || `<p class="text-[12px] text-foreground/50">No agents on this floor yet.</p>`}
    </div>
    ${v.rooms.map((r, i) => (i > 0 && !r.agents.length ? `<button data-remove-room="${i}" class="mt-3 text-[11px] text-red-500">Remove ${ctx.esc(r.name)} (empty)</button>` : "")).join("")}`, (sheet) => {
    const change = (body) => ctx.A.live.rooms({ team: o.team, ...body })
      .then(async () => { await ctx.refreshLive(); ctx.closeSheet(); ctx.rerender(); })
      .catch((e) => ctx.toast(e.message));
    sheet.querySelectorAll("[data-move]").forEach((b) => { b.onclick = () => change({ do: "move", agent: b.dataset.move, room: Number(b.dataset.to) }); });
    sheet.querySelectorAll("[data-remove-room]").forEach((b) => { b.onclick = () => { (ctx.ui.room ??= {})[o.team] = 0; ctx.saveUI(); change({ do: "remove", room: Number(b.dataset.removeRoom) }); }; });
  });
}

// "Needs you" jumps into the chat that holds the open question (the server asks Claude desktop to show it);
// without a known chat, or if that fails, a sheet says what is needed.
export function openNeeds(ctx, o) {
  const needsSheet = (note) => ctx.openSheet(`
      <div class="flex items-center gap-2.5 pt-3"><span class="flex size-8 items-center justify-center rounded-full bg-amber-400 text-[17px] font-black text-white">!</span><p class="text-[15px] font-semibold">Needs you</p></div>
      ${o.needs.from ? `<p class="mt-3 text-[12px] text-foreground/55">${ctx.esc(o.needs.from)} asks:</p>` : ""}
      <p class="${o.needs.from ? "mt-1" : "mt-3"} text-[14px] leading-snug">${ctx.esc(o.needs.what)}</p>
      ${o.needs.blocked?.length ? `<p class="mt-2 text-[12px] text-foreground/60">Waiting for you: ${ctx.esc(o.needs.blocked.join(", "))}</p>` : ""}
      <div class="mt-4 flex items-center gap-2 rounded-lg bg-[#4f5bd5] px-3 py-2.5 text-[13px] font-medium text-white">${ctx.icon("arrowLeft", "size-4")} The coordinator asks you in the chat</div>
      ${note ? `<p class="mt-2 text-[11px] text-foreground/45">${ctx.esc(note)}</p>` : ""}`);
  if (!o.needs.session || !o.live) return needsSheet();
  ctx.A.live.openChat(o.needs.session)
    .then((r) => ctx.toast(r?.here ? "It's this chat — answer on the left" : `Opened ${o.needs.from ?? "the coordinator"}'s chat`))
    .catch((e) => needsSheet(`Couldn't open the chat: ${e.message}`));
}

export function officeMount(root, ctx, o) {
  const l = ctx.local("office");
  root.querySelectorAll("[data-desk-file]").forEach((b) => { b.onclick = () => openStep(ctx, b.dataset.deskFile, b.dataset.live === "1"); });
  root.querySelector("[data-needs-you]")?.addEventListener("click", () => openNeeds(ctx, o));
  const v = roomView(ctx, o);
  root.querySelectorAll("[data-room-tab]").forEach((b) => { b.onclick = () => { (ctx.ui.room ??= {})[o.team] = Number(b.dataset.roomTab); ctx.saveUI(); ctx.rerender(); }; });
  root.querySelector("[data-room-add]")?.addEventListener("click", () => {
    ctx.A.live.rooms({ team: o.team, do: "add" })
      .then(async (r) => { (ctx.ui.room ??= {})[o.team] = r.rooms.length - 1; ctx.saveUI(); await ctx.refreshLive(); ctx.rerender(); })
      .catch((e) => ctx.toast(e.message));
  });
  root.querySelector("[data-room-arrange]")?.addEventListener("click", () => arrangeSheet(ctx, o, v));
  // "+ Agent": the next agent hired or built for this floor sits in this room; then the Library, where both start
  root.querySelector("[data-room-hire]")?.addEventListener("click", () => {
    ctx.A.live.rooms({ team: o.team, do: "target", room: v.at })
      .then(() => { ctx.ui.teamSlug = o.team; ctx.saveUI(); ctx.go("library"); })
      .catch((e) => ctx.toast(e.message));
  });
  root.querySelectorAll("[data-room-agent]").forEach((b) => {
    b.onclick = () => {
      const d = o.items.find((x) => x.slug === b.dataset.roomAgent);
      if (!d) return;
      l.selected = d.slug;
      // Igor 17.11: an agent with its own page opens it straight away, under the top bar, with "← Room" back
      if (d.dash && d.team) { ctx.ui.dashRef = { team: d.team, slug: d.slug }; ctx.saveUI(); ctx.go("dash"); return; }
      const base = who(ctx, d.slug);
      const name = d.name ?? base.name;
      ctx.openSheet(`
        <div class="flex items-center gap-3 pt-3">
          <img src="./assets/agents/${d.sprite ?? base.sprite ?? "create-agent-silhouette"}.png" alt="" class="size-14 object-contain" />
          <div class="min-w-0 flex-1"><p class="text-[15px] font-semibold">${ctx.esc(name)}</p><p class="line-clamp-2 text-[11px] text-foreground/55">${ctx.esc(d.role ?? base.role ?? "")}</p></div>
          ${badge(ctx, d.status)}
        </div>
        ${d.shareReady ? `<button data-sheet-share class="mt-3 flex w-full items-center gap-2 rounded-lg border-2 border-[#4f5bd5]/30 bg-[#4f5bd5]/[0.05] px-2.5 py-2 text-left text-[12.5px] hover:bg-[#4f5bd5]/10"><span>★</span><span class="flex-1"><b>${ctx.esc(name)} is ready for the library.</b> It did well on your tasks — package it so others can use it — you stay its author.</span>${ctx.icon("chevronRight", "size-4 text-[#4f5bd5]")}</button>` : ""}
        <p class="mt-3 flex items-center gap-1.5 text-[12px] text-foreground/60">${d.where === "cloud" ? `${ctx.icon("cloud", "size-3.5 text-sky-500")} Works in the cloud — keeps going while your computer sleeps` : `${ctx.icon("laptop", "size-3.5")} Works on this computer — while Claude is open`}</p>
        ${d.line ? `<p class="${ctx.LABEL} mt-4">Right now</p><p class="mt-1.5 text-[13px] leading-snug">${ctx.esc(d.line)}</p>` : ""}
        <div class="mt-4 flex flex-col gap-2">
          ${d.file ? `<button data-sheet-file class="${ctx.BTN}">${ctx.icon("file", "size-3")} Open ${ctx.esc(o.live ? d.fileName ?? "result" : "result")}</button>` : ""}
          ${d.session && o.live ? `<button data-sheet-chat class="${ctx.BTN2}">Open ${ctx.esc(name)}'s chat</button>` : ""}
          ${d.team && ctx.S?.teams?.find((t) => t.slug === d.team)?.agents?.find((x) => x?.slug === d.slug)?.canvas ? `<button data-sheet-canvas class="${ctx.BTN}">${ctx.icon("external", "size-3")} Work on ${ctx.esc(name)}'s canvas</button>` : ""}
          ${d.team ? `<button data-sheet-agent class="${ctx.BTN2}">What ${ctx.esc(name)} knows</button>` : ""}
        </div>
        ${d.session && o.live ? "" : `<p class="mt-3 text-[11px] text-foreground/45">${ctx.esc(name)} works in its own ${d.where === "cloud" ? "cloud chat (Claude Code on the web)" : "chat in the sidebar on the left"}.</p>`}`, (sheet) => {
        sheet.querySelector("[data-sheet-chat]")?.addEventListener("click", () => {
          ctx.A.live.openChat(d.session).then((r) => { ctx.closeSheet(); if (r?.here) ctx.toast("It's this chat — it's on the left"); }).catch((e) => ctx.toast(`Couldn't open the chat: ${(e.message)}`));
        });
        sheet.querySelector("[data-sheet-file]")?.addEventListener("click", () => { ctx.closeSheet(); openStep(ctx, d.file, o.live); });
        sheet.querySelector("[data-sheet-agent]")?.addEventListener("click", () => { ctx.closeSheet(); ctx.ui.agentRef = { team: d.team, slug: d.slug }; ctx.saveUI(); ctx.go("agent"); });
        // the canvas lives on the agent's page, framed (agent.js): the floor only leads there
        sheet.querySelector("[data-sheet-canvas]")?.addEventListener("click", () => { ctx.closeSheet(); ctx.ui.agentRef = { team: d.team, slug: d.slug }; ctx.saveUI(); ctx.go("agent"); });
        sheet.querySelector("[data-sheet-share]")?.addEventListener("click", () => { ctx.closeSheet(); ctx.ui.agentRef = { team: d.team, slug: d.slug }; ctx.saveUI(); ctx.go("agent"); });
      });
    };
  });
  const disposers = [];
  if (!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
    root.querySelectorAll("[data-room-agent][data-working]").forEach((el) => disposers.push(startWorking(el)));
  }
  return () => disposers.forEach((fn) => { try { fn(); } catch { /* gone */ } });
}

// ---------------------------------------------------------------- standalone route (demo run)
export function render(ctx) {
  const team = (ctx.S.teams ?? []).find((t) => t.slug === ctx.ui.teamSlug);
  const o = ctx.ui.run && !ctx.ui.liveView ? officeFromRun(ctx) : team ? officeFromTeam(ctx, team, ctx.ui.officeTask) : officeFromRun(ctx);
  if (!o) return `<div class="px-4 pb-24 pt-4"><button data-back class="${ctx.PX} text-[7px] text-[#4f5bd5]">← Team</button><p class="mt-6 text-center text-[13px] text-muted-foreground">No task running yet.</p></div>`;
  return `<div class="px-4 pb-24 pt-4"><button data-back class="${ctx.PX} inline-flex items-center gap-1 text-[7px] text-[#4f5bd5]">${ctx.icon("arrowLeft", "size-3")} Team</button>${officeHTML(ctx, o)}</div>`;
}
export function mount(root, ctx) {
  const team = (ctx.S.teams ?? []).find((t) => t.slug === ctx.ui.teamSlug);
  const o = ctx.ui.run && !ctx.ui.liveView ? officeFromRun(ctx) : team ? officeFromTeam(ctx, team, ctx.ui.officeTask) : officeFromRun(ctx);
  root.querySelector("[data-back]")?.addEventListener("click", () => ctx.go("team"));
  return o ? officeMount(root, ctx, o) : undefined;
}

// Platform working clip: <video> drawn into <canvas> with the green key removed (g > 60 && g > r*1.3 && g > b*1.3).
// also the Builder's agent view (build.js): a sprite at work, its green background keyed out frame by frame
export function startWorking(el) {
  const video = el.querySelector("[data-work-video]");
  const canvas = el.querySelector("[data-work-canvas]");
  const idle = el.querySelector("[data-idle]");
  if (!video || !canvas || !idle) return () => {};
  const cssW = canvas.getBoundingClientRect().width;
  const res = Math.min(320, Math.max(96, Math.round((cssW || 96) * Math.min(window.devicePixelRatio || 1, 2))));
  canvas.width = res; canvas.height = res;
  const g = canvas.getContext("2d", { willReadFrequently: true });
  let stopped = false, frames = 0, rafId = 0, vfcId = 0;
  const useVfc = typeof video.requestVideoFrameCallback === "function";
  const stop = () => { stopped = true; cancelAnimationFrame(rafId); if (useVfc && vfcId) video.cancelVideoFrameCallback?.(vfcId); video.pause(); };
  const fail = () => { stop(); canvas.classList.add("opacity-0"); idle.classList.remove("opacity-0"); };
  const schedule = () => { if (stopped) return; if (useVfc) vfcId = video.requestVideoFrameCallback(draw); else rafId = requestAnimationFrame(draw); };
  function draw() {
    if (stopped || !g) return;
    if (!video.paused && !video.ended && video.readyState >= 2) {
      try {
        g.drawImage(video, 0, 0, canvas.width, canvas.height);
        const frame = g.getImageData(0, 0, canvas.width, canvas.height);
        const d = frame.data;
        for (let i = 0; i < d.length; i += 4) { const r = d[i], gr = d[i + 1], b = d[i + 2]; if (gr > 60 && gr > r * 1.3 && gr > b * 1.3) d[i + 3] = 0; }
        g.putImageData(frame, 0, 0);
        frames += 1;
        if (frames === 3) { canvas.classList.remove("opacity-0"); idle.classList.add("opacity-0"); }
      } catch { fail(); return; }
    }
    schedule();
  }
  const onSeeked = () => { if (!stopped) video.play().then(schedule, fail); };
  const begin = () => { if (stopped) return; video.addEventListener("seeked", onSeeked, { once: true }); video.currentTime = 0.8; };
  video.addEventListener("error", fail, { once: true });
  if (video.readyState >= 1) begin(); else video.addEventListener("loadedmetadata", begin, { once: true });
  return () => { stop(); video.removeEventListener("loadedmetadata", begin); video.removeEventListener("seeked", onSeeked); video.removeEventListener("error", fail); video.removeAttribute("src"); video.load(); };
}
