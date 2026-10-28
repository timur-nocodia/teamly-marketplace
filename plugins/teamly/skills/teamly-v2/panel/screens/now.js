// NOW: where the work is and what is needed from you, readable in 3 seconds.
// LIVE  = the real task of the department (STATUS.md + step files from the task folder, refreshed every 5 s).
// DEMO  = a simulated run that walks all 8 moments: started → working → step done → needs you → failure → result
//         → rating → what next, plus credits: estimate, spend per step, out of credits → top up → continue.

const STATUS_CHIP = {
  queued: ["Waiting", "border-foreground/15 text-foreground/40"],
  working: ["Working", "border-[#4f5bd5]/40 bg-[#4f5bd5]/10 text-[#4f5bd5]"],
  done: ["Done", "border-emerald-300/50 bg-emerald-50 text-emerald-600"],
  needs_you: ["Needs you", "border-amber-300 bg-amber-50 text-amber-700"],
  failed: ["Failed", "border-red-300 bg-red-50 text-red-600"],
  paused: ["Paused", "border-red-300 bg-red-50 text-red-600"],
};
export const chip = (ctx, s) => `<span class="${ctx.PX} shrink-0 rounded border px-1.5 py-1 text-[6px] ${STATUS_CHIP[s][1]}">${STATUS_CHIP[s][0]}</span>`;
export const who = (ctx, slug) => (slug === "you" ? ctx.A.YOU : ctx.A.agentBySlug[slug] ?? { name: slug, role: "", sprite: null });

// ---------------------------------------------------------------- live
export function liveTeam(ctx) {
  const want = ctx.ui.teamSlug ?? ctx.A.teamById[ctx.ui.dept]?.liveSlug;
  return want ? ctx.S.teams.find((t) => t.slug === want) ?? null : null;
}
// What a step's status says. Its first word decides ("failed: … still working on it" is a failure, "done 12:40" is done);
// with no status word first, words inside count ("step 2 · waiting for you: …"). null: it says nothing.
const ENDS = "(?=[^\\p{L}]|$)";
const LEAD = [["done", `^(готово|done|сделано|выполнено|completed?)${ENDS}`], ["failed", `^(failed|ошибка|не готово)${ENDS}`],
  ["paused", `^(paused|пауза)${ENDS}`], ["working", `^(working|в работе|работает)${ENDS}`], ["needs_you", "^(waiting for you|ждёт тебя|ждет тебя)"]]
  .map(([k, rx]) => [k, new RegExp(rx, "iu")]);
export function statusWord(text, isYou = false) {
  const t = String(text ?? "").trim();
  const lead = t.replace(/^[^\p{L}\p{N}]+/u, "");  // a leading ✅ or • is decoration
  const first = LEAD.find(([, rx]) => rx.test(lead))?.[0];
  if (first === "paused" && isYou) return "needs_you";
  if (first) return first;
  if (/waiting for you|ждёт тебя|ждет тебя/i.test(t) || (isYou && /пауза|ждём|ждем|waiting for/i.test(t))) return "needs_you";
  if (/ошибка|не готово|failed/i.test(t)) return "failed";
  if (/в работе|работает|working/i.test(t)) return "working";
  return null;
}

export function liveSteps(team) {
  const task = team.task;
  const has = (pattern) => {
    if (!pattern) return null;
    const base = pattern.replace("*", "");
    return task.files.find((f) => (pattern.includes("*") ? f.name.startsWith(base) : f.name === pattern)) ?? null;
  };
  // a chain link is an agent's slug, "you", a step still to build ({"create": role}) or the person's veto ({"who": "you"})
  const linkWho = (c) => (typeof c === "string" ? c : c?.create ? String(c.create) : c?.who === "you" ? "you" : "");
  const rows = (task.status?.rows?.length ? task.status.rows
    : (team.chain ?? team.goals?.[0]?.chain ?? []).map((c, i) => ({ step: i + 1, who: linkWho(c), file: "", status: "" })))
    .map((r) => ({ ...r, who: String(r?.who ?? "") })).filter((r) => r.who);
  return rows.map((r) => {
    const first = r.who.toLowerCase().split(/[\s(]/)[0];
    const full = r.who.toLowerCase().trim();
    const isYou = /^(ты|you|игорь|дубль|take)(?=[\s(:,.—-]|$)/i.test(r.who.trim());  // "Client Intake" is an agent
    // STATUS.md names agents in the person's words: match them to the team's agents by name.
    const map = { "марк": "mark", "рили": "riley", "james": "james", "джеймс": "james", ...(window.__liveMap ?? {}) };
    for (const a of team.agents ?? []) {
      const n = String(a.name ?? a.card?.name ?? "").toLowerCase();
      if (n) { map[n] = a.slug; map[n.split(/[\s(]/)[0]] = a.slug; }
    }
    const slug = isYou ? "you" : (map[full] ?? map[first] ?? first);
    const file = has(r.file);
    // what STATUS.md says wins; a step's file marks it done only while its status says nothing else (an agent that wrote
    // its file and then asked a question, or failed after an empty file, is not done)
    const status = statusWord(r.status, isYou) ?? (file ? "done" : "queued");
    return { slug, status, line: r.status, file, fileName: r.file, who: r.who, step: r.step };
  });
}

function liveView(ctx) {
  window.__liveMap = ctx.A.LIVE_NAME_TO_SLUG;
  const team = liveTeam(ctx);
  if (!team?.task) return empty(ctx, "No live task in this department yet.");
  const task = team.task;
  const steps = liveSteps(team);
  const needs = steps.find((s) => s.status === "needs_you");
  const cur = steps.find((s) => s.status === "working") ?? needs ?? steps.find((s) => s.status === "queued");
  const done = steps.filter((s) => s.status === "done").length;
  const l = ctx.local("now");
  return `
    <div class="flex items-center justify-between">
      <p class="${ctx.LABEL}">Live · ${ctx.esc(team.name)} · ${ctx.esc(task.name)}</p>
      <span class="flex items-center gap-1 text-[10px] text-emerald-600"><span class="size-1.5 animate-pulse rounded-full bg-emerald-500"></span>synced</span>
    </div>
    <p class="mt-2 text-[15px] font-semibold leading-snug">${ctx.esc(task.status?.title ?? task.name)}</p>
    <p class="mt-1 text-[12px] text-muted-foreground">Step ${Math.min(done + 1, steps.length)} of ${steps.length}${task.status?.started ? ` · started ${ctx.esc(task.status.started.split(" ")[1] ?? task.status.started)}` : ""}</p>
    ${needs ? needsYouLive(ctx, task, l) : cur ? `<div class="mt-3 rounded-xl border-2 border-[#4f5bd5]/25 bg-[#4f5bd5]/5 p-3 text-[13px]">${ctx.esc(task.status?.now || "Working…")}</div>` : ""}
    <div class="mt-4 flex flex-col gap-2">${steps.map((s, i) => stepRow(ctx, s, i, { live: true })).join("")}</div>
    ${task.status?.next ? `<p class="mt-3 text-[12px] text-muted-foreground"><b class="text-foreground/70">Next:</b> ${ctx.esc(task.status.next)}</p>` : ""}
    <p class="mt-4 break-all text-[10px] text-foreground/35">${ctx.icon("folder", "inline size-3")} ${ctx.esc(task.folder)}</p>`;
}

// Riley's file has several sections; on camera you only need the spoken lines.
function spoken(md) {
  const lines = md.split("\n");
  const i = lines.findIndex((x) => /^##\s*(Текст|Text|Script)/i.test(x));
  if (i < 0) return md.trim();
  const rest = lines.slice(i + 1);
  const j = rest.findIndex((x) => /^##\s/.test(x));
  return (j < 0 ? rest : rest.slice(0, j)).join("\n").trim();
}

function needsYouLive(ctx, task, l) {
  const script = task.files.find((f) => f.name.startsWith("2-script"));
  const edited = task.edits.find((f) => f.name.startsWith("2-script"));
  const takePath = `${task.folder}/3-take.mov`;
  if (script && l.scriptFor !== script.path + (edited?.path ?? "")) {
    l.scriptFor = script.path + (edited?.path ?? "");
    l.scriptText = null;
    ctx.A.live.fileText(edited?.path ?? script.path).then((t) => { l.scriptText = t; ctx.rerender(); }).catch(() => {});
  }
  return `
  <div class="mt-3 rounded-xl border-2 border-amber-300 bg-amber-50 p-3.5 animate-[fadeSlideUp_0.35s_ease-out_both]">
    <div class="flex items-center gap-2 text-amber-800">${ctx.icon("hand", "size-4")}<p class="${ctx.PX} text-[8px]">Needs you: film the take</p></div>
    <p class="mt-2 text-[13px] text-amber-900">Read the script below on camera (about a minute). James edits right after.${edited ? " Using your edited script." : ""}</p>
    ${script ? `<p class="${ctx.LABEL} mt-3">What to say</p>
      <div class="mt-1.5 max-h-52 overflow-y-auto whitespace-pre-wrap rounded-lg border border-amber-200 bg-white p-2.5 text-[13px] leading-relaxed text-foreground/85">${l.scriptText == null ? "Loading the script…" : ctx.esc(spoken(l.scriptText))}</div>
      <div class="mt-2 grid grid-cols-2 gap-2">
        <button data-edit-script class="${ctx.BTN2}">${ctx.icon("pencil", "size-3")} Edit</button>
        <button data-open-step="${ctx.esc(edited?.path ?? script.path)}" data-live="1" class="${ctx.BTN2}">${ctx.icon("file", "size-3")} Full script</button>
      </div>` : ""}
    <p class="${ctx.LABEL} mt-3">Put your take here</p>
    <button data-copy-path="${ctx.esc(takePath)}" class="mt-1.5 flex w-full items-center gap-2 rounded-lg border border-amber-200 bg-white px-2.5 py-2 text-left font-mono text-[11px] text-foreground/80">
      <span class="min-w-0 flex-1 break-all">${ctx.esc(takePath)}</span>${ctx.icon("copy", "size-3 shrink-0 text-foreground/40")}
    </button>
  </div>
  ${ctx.chatAsk("Your take for today's reel?", TAKE_OPTIONS(ctx), { demo: false })}`;
}

const TAKE_OPTIONS = (ctx) => [
  { id: "run-take", label: "It's in the folder", sub: "James starts editing right away" },
  { id: "run-old", label: "Use an old take", sub: "The coordinator offers 2–3 takes from past reels" },
  { id: "run-ai", label: `AI take (Seedance) · ${ctx.cr(2)}`, sub: "Generated from the script, no filming" },
];

// ---------------------------------------------------------------- demo run
function banner(ctx, run) {
  const step = run.steps[run.cur];
  const a = who(ctx, step.slug);
  if (run.phase === "running" && step.status === "queued" && run.cur === 0) {
    return `<div class="mt-3 rounded-xl border-2 border-[#4f5bd5]/25 bg-[#4f5bd5]/5 p-3 text-[13px]">${ctx.icon("clock", "inline size-3.5 text-[#4f5bd5]")} Task started. ${ctx.esc(a.name)} begins first, ${ctx.esc(a.time)}. Do something else: I'll call you when you're needed.</div>`;
  }
  if (run.phase === "running") {
    return `<div class="mt-3 rounded-xl border-2 border-[#4f5bd5]/25 bg-[#4f5bd5]/5 p-3 text-[13px]">${ctx.icon("clock", "inline size-3.5 text-[#4f5bd5]")} ${ctx.esc(a.name)} is working · ${ctx.esc(a.time)}. Nothing needed from you right now.</div>`;
  }
  if (run.phase === "needs_you") {
    return `
    <div class="mt-3 rounded-xl border-2 border-amber-300 bg-amber-50 p-3.5 animate-[fadeSlideUp_0.35s_ease-out_both]">
      <div class="flex items-center gap-2 text-amber-800">${ctx.icon("hand", "size-4")}<p class="${ctx.PX} text-[8px]">Needs you: film the take</p></div>
      <p class="mt-2 text-[13px] text-amber-900">Riley's script is ready. Film it (about a minute) and put the file in the task folder.</p>
      <button data-open-step="riley" class="${ctx.BTN2} mt-3">${ctx.icon("file", "size-3")} Open the script</button>
    </div>
    ${ctx.chatAsk("Your take for today's reel?", TAKE_OPTIONS(ctx))}`;
  }
  if (run.phase === "failed") {
    const f = ctx.A.FAILURE[step.slug] ?? { what: `${a.name}'s step stopped.`, fix: "Retry the step." };
    return `
    <div class="mt-3 rounded-xl border-2 border-red-300 bg-red-50 p-3.5 animate-[fadeSlideUp_0.35s_ease-out_both]">
      <div class="flex items-center gap-2 text-red-700">${ctx.icon("alert", "size-4")}<p class="${ctx.PX} text-[8px]">${ctx.esc(a.name)}'s step failed</p></div>
      <p class="mt-2 text-[13px] text-red-900">${ctx.esc(f.what)}</p>
      <p class="mt-1.5 text-[12px] text-red-800/80"><b>What to do:</b> ${ctx.esc(f.fix)}</p>
    </div>
    ${ctx.chatAsk(`Retry ${a.name}'s step?`, [
      { id: "run-retry", label: "Retry", sub: "Nothing is charged for the failed try" },
      { id: "run-stop", label: "Stop here", sub: "Keep what is done, finish later" },
    ])}`;
  }
  if (run.phase === "no_credits") {
    return `
    <div class="mt-3 rounded-xl border-2 border-red-300 bg-red-50 p-3.5 animate-[fadeSlideUp_0.35s_ease-out_both]">
      <div class="flex items-center gap-2 text-red-700">${ctx.icon("pause", "size-4")}<p class="${ctx.PX} text-[8px]">Paused: the balance is empty</p></div>
      <p class="mt-2 text-[13px] text-red-900">${ctx.esc(a.name)} needs <b>${ctx.cr(a.cost)}</b> for ${ctx.esc(a.costFor.toLowerCase())}. You have <b>${ctx.cr(ctx.A.wallet.balance)}</b>.</p>
      <p class="mt-1 text-[12px] text-red-800/80">Nothing is lost: after a top up the task continues from this step.</p>
      <button data-demo-topup class="${ctx.BTN} mt-3">Top up</button>
    </div>
    ${ctx.chatAsk("Top up in the panel, then continue?", [
      { id: "run-continue", label: "Topped up — continue", sub: ctx.A.wallet.canPay(a.cost) ? "Balance is enough now" : `Needs ${ctx.cr(a.cost)}, you have ${ctx.cr(ctx.A.wallet.balance)}` },
    ])}`;
  }
  return "";
}

function result(ctx, run) {
  const spent = ctx.A.runSpent(run);
  const last = run.steps[run.steps.length - 1].slug;
  const isVideo = last === "james";
  const l = ctx.local("now");
  const reelEntry = ctx.ui.entry?.kind === "reel";
  const firstAgent = ctx.A.agentBySlug[run.steps[0].slug];
  const mates = reelEntry ? ctx.A.TEAMS.find((t) => t.chain.includes(firstAgent.slug) && t.chain.length > 1) : null;
  return `
  <div class="mt-3 rounded-xl border-2 border-emerald-300 bg-emerald-50/60 p-3.5 animate-[fadeSlideUp_0.35s_ease-out_both]">
    <div class="flex items-center gap-2 text-emerald-700">${ctx.icon("check", "size-4")}<p class="${ctx.PX} text-[8px]">Result ready</p></div>
    ${isVideo && ctx.S.demoReel
      ? `<video src="${ctx.A.live.fileUrl(ctx.S.demoReel)}" controls playsinline class="mt-3 aspect-[9/16] max-h-[420px] w-full rounded-lg bg-black object-contain"></video>`
      : `<button data-open-step="${last}" class="${ctx.BTN2} mt-3">${ctx.icon("file", "size-3")} Open ${ctx.esc(who(ctx, last).name)}'s result</button>`}
    <div class="mt-3 flex items-center justify-between text-[12px]">
      <span class="text-foreground/70">This result cost <b class="text-foreground">${ctx.cr(spent)}</b></span>
      <span class="text-foreground/50">${Math.max(1, Math.round(((run.finishedAt ?? Date.now()) - run.startedAt) / 60000))} min</span>
    </div>
    ${isVideo ? `<button data-copy-path="${ctx.esc(ctx.S.demoReel ?? "")}" class="${ctx.BTN2} mt-2">${ctx.icon("folder", "size-3")} Copy the file path (open in Finder)</button>` : ""}
  </div>

  <div class="${ctx.CARD} mt-3 p-3.5">
    ${run.rated
      ? `<p class="flex items-center gap-2 text-[13px] text-emerald-700">${ctx.icon("check", "size-4")} Thanks — your rating is saved.</p>`
      : `<p class="${ctx.LABEL}">Did you get a result?</p>
      <div class="mt-2 flex gap-1.5">${[1, 2, 3, 4, 5].map((n) => `<button data-star="${n}" aria-label="${n} of 5" class="flex size-10 items-center justify-center rounded-lg border-2 ${l.star >= n ? "border-amber-300 bg-amber-50 text-amber-500" : "border-foreground/10 text-foreground/25"}">${ctx.icon("star", "size-4")}</button>`).join("")}</div>
      <textarea id="blocker" rows="2" placeholder="What got in the way? (optional)" class="mt-2 w-full resize-none rounded-lg border-2 border-foreground/15 p-2.5 text-[13px] outline-none focus:border-[#4f5bd5]">${ctx.esc(l.blocker ?? "")}</textarea>
      <button data-rate class="${ctx.BTN} mt-2" ${l.star ? "" : "disabled"}>Send</button>`}
  </div>

  ${mates && !ctx.ui.dept ? `
  <div class="mt-3 rounded-xl border-2 border-[#4f5bd5]/30 bg-[#4f5bd5]/5 p-3.5">
    <p class="text-[14px] font-semibold">${ctx.esc(firstAgent.name)} has teammates</p>
    <p class="mt-1 text-[12px] text-foreground/70">${mates.chain.filter((s) => s !== firstAgent.slug && s !== "you").map((s) => `${ctx.A.agentBySlug[s].name} — ${ctx.A.agentBySlug[s].role.toLowerCase()}`).join(" · ")}. Together: ${ctx.esc(mates.outcome.toLowerCase())}</p>
    <div class="mt-3 flex -space-x-1.5">${mates.chain.map((s) => ctx.avatar(who(ctx, s).sprite, "size-7")).join("")}</div>
    <button data-go-library class="${ctx.PX} mt-2 w-full py-1.5 text-[7px] text-[#4f5bd5] hover:underline">See them in the gallery</button>
  </div>
  ${ctx.chatAsk(`Build the team with ${firstAgent.name}?`, [
    { id: "run-team-yes", label: "Yes, hire the team", sub: `~${ctx.cr(ctx.A.teamCost(mates))} per ${mates.name.toLowerCase()}` },
    { id: "run-team-no", label: "Not now" },
  ])}` : ""}

  ${ctx.chatAsk("What next?", [
    { id: "run-again", label: "One more of the same", sub: "The agents keep your fixes" },
    { id: "run-fix", label: "Fix something", sub: "You write what to change in the chat" },
  ])}
  <button data-own-team class="${ctx.BTN2} mt-3">${ctx.icon("users", "size-3")} Add agents from the gallery</button>`;
}

function stepRow(ctx, s, i, { live = false, run = null } = {}) {
  const a = who(ctx, s.slug);
  const status = run && run.phase === "failed" && run.cur === i ? "failed" : run && run.phase === "no_credits" && run.cur === i ? "paused" : s.status;
  const working = status === "working" && !live ? a.working?.[s.lineIdx] : null;
  const canOpen = live ? !!s.file : status === "done" && s.slug !== "you";
  return `
  <div class="${ctx.CARD} flex items-start gap-2.5 p-2.5 ${status === "working" ? "border-[#4f5bd5]/40" : ""}">
    ${ctx.avatar(a.sprite, "size-9")}
    <div class="min-w-0 flex-1">
      <div class="flex items-center gap-2"><p class="min-w-0 flex-1 truncate text-[13px] font-semibold">${ctx.esc(a.name)} <span class="font-normal text-foreground/45">· ${ctx.esc(a.role)}</span></p>${chip(ctx, status)}</div>
      ${working ? `<p class="mt-1 text-[12px] text-[#4f5bd5]"><span class="mr-1 inline-block size-1.5 animate-pulse rounded-full bg-[#4f5bd5] align-middle"></span>${ctx.esc(working)}</p>` : ""}
      ${live && s.line ? `<p class="mt-1 text-[12px] leading-snug text-foreground/60">${ctx.esc(s.line)}</p>` : ""}
      <div class="mt-1.5 flex items-center gap-3">
        ${canOpen ? `<button data-open-step="${live ? ctx.esc(s.file.path) : s.slug}" data-live="${live ? 1 : 0}" class="${ctx.PX} inline-flex items-center gap-1 text-[7px] text-[#4f5bd5] hover:underline">${ctx.icon("file", "size-3")} Open ${live ? ctx.esc(s.file.name) : "result"}</button>` : ""}
        ${!live && a.cost !== undefined && s.slug !== "you" ? `<span class="text-[11px] text-foreground/45">${s.spent ? `spent ${ctx.cr(s.spent)}` : a.cost ? `~${ctx.cr(a.cost)}` : "free"}</span>` : ""}
      </div>
    </div>
  </div>`;
}

function demoView(ctx) {
  const run = ctx.ui.run;
  const est = ctx.A.runEstimate(run);
  const spent = ctx.A.runSpent(run);
  return `
    <p class="${ctx.LABEL}">Demo run · simulated progress</p>
    <p class="mt-2 text-[15px] font-semibold leading-snug">${ctx.esc(run.task)}</p>
    <div class="mt-2 flex items-center gap-3 text-[12px] text-muted-foreground">
      <span>${ctx.icon("clock", "inline size-3")} started ${ctx.minsAgo(run.startedAt)}</span>
      <span>${ctx.icon("coins", "inline size-3")} spent ${ctx.cr(spent)} of ~${ctx.cr(est)}</span>
    </div>
    ${run.phase === "done" ? result(ctx, run) : banner(ctx, run)}
    <div class="mt-4 flex flex-col gap-2">${run.steps.map((s, i) => stepRow(ctx, s, i, { run })).join("")}</div>
    ${run.phase === "running" ? `<button data-advance class="${ctx.BTN2} mt-3 border-dashed">${ctx.icon("flask", "size-3")} Simulate progress</button>` : ""}`;
}

function empty(ctx, text) {
  return `
  <div class="flex flex-col items-center px-4 py-14 text-center">
    <img src="./assets/agents/formal01.png" alt="" class="size-16 object-contain opacity-80" />
    <p class="mt-3 text-[14px] font-semibold">${ctx.esc(text)}</p>
    <p class="mt-1 text-[12px] text-muted-foreground">Hire an agent or a team and give the first task.</p>
    <button data-go-library class="${ctx.BTN} mt-4 max-w-56">Open the gallery</button>
  </div>`;
}

// ---------------------------------------------------------------- screen
export function hasWork(ctx) { return !!ctx.ui.run || !!liveTeam(ctx)?.task; }

export function render(ctx) { return `<div class="px-4 pb-24 pt-4">${renderBody(ctx)}</div>`; }

export function renderBody(ctx) {
  const hasRun = !!ctx.ui.run;
  const hasLive = !!liveTeam(ctx)?.task;
  const showLive = hasLive && (ctx.ui.liveView || !hasRun);
  const toggle = hasRun && hasLive ? `
    <div class="mb-3 grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
      <button data-view="live" class="${ctx.PX} rounded-md py-1.5 text-[7px] ${showLive ? "bg-card text-foreground shadow-sm" : "text-foreground/45"}">Live task</button>
      <button data-view="demo" class="${ctx.PX} rounded-md py-1.5 text-[7px] ${!showLive ? "bg-card text-foreground shadow-sm" : "text-foreground/45"}">Demo run</button>
    </div>` : "";
  const body = showLive ? liveView(ctx) : hasRun ? demoView(ctx) : empty(ctx, "No task yet");
  return `${toggle}${body}`;
}

export function openStep(ctx, key, isLive) {
  const run = ctx.ui.run;
  const team = liveTeam(ctx);
  const files = team?.task?.files ?? [];
  let path = null;
  if (isLive) path = key;
  else if (key === "mark") path = files.find((f) => f.name.startsWith("1-"))?.path;
  else if (key === "riley") path = team?.task?.edits.find((f) => f.name.startsWith("2-"))?.path ?? files.find((f) => f.name.startsWith("2-"))?.path;
  else if (key === "james") path = ctx.S.demoReel;
  if (!path) {
    const a = ctx.A.agentBySlug[key];
    return ctx.openSheet(`<p class="${ctx.LABEL}">${ctx.esc(a?.name ?? "")}'s result</p><div class="mt-3 flex flex-col gap-1 text-[13px]">${(a?.example ?? []).map((x) => `<p>${ctx.esc(x)}</p>`).join("")}</div>`);
  }
  const name = path.split("/").pop();
  if (/\.(mp4|mov|webm)$/i.test(name)) {
    return ctx.openSheet(`<p class="${ctx.LABEL}">${ctx.esc(name)}</p><video src="${ctx.A.live.fileUrl(path)}" controls autoplay playsinline class="mt-3 aspect-[9/16] max-h-[70dvh] w-full rounded-lg bg-black object-contain"></video>`);
  }
  ctx.openSheet(`<p class="${ctx.LABEL}">${ctx.esc(name)}</p><div id="file-body" class="mt-3 whitespace-pre-wrap text-[12px] leading-relaxed text-foreground/85">Loading…</div>`, (root) => {
    ctx.A.live.fileText(path).then((t) => { root.querySelector("#file-body").textContent = t; }).catch(() => { root.querySelector("#file-body").textContent = "Could not open the file."; });
  });
  void run;
}

export function mount(root, ctx) {
  const l = ctx.local("now");
  const run = ctx.ui.run;
  const save = () => { ctx.saveUI(); ctx.refresh(); };
  const task = liveTeam(ctx)?.task;

  root.querySelectorAll("[data-view]").forEach((b) => { b.onclick = () => { ctx.ui.liveView = b.dataset.view === "live"; save(); }; });
  root.querySelectorAll("[data-go-library]").forEach((b) => { b.onclick = () => ctx.go("library"); });
  root.querySelectorAll("[data-open-step]").forEach((b) => { b.onclick = () => openStep(ctx, b.dataset.openStep, b.dataset.live === "1"); });
  root.querySelectorAll("[data-copy-path]").forEach((b) => {
    b.onclick = async () => { try { await navigator.clipboard.writeText(b.dataset.copyPath); ctx.toast("Path copied"); } catch { ctx.toast((b.dataset.copyPath)); } };
  });

  // live: needs you
  root.querySelector("[data-edit-script]")?.addEventListener("click", () => {
    ctx.openSheet(`
      <p class="${ctx.LABEL}">Edit Riley's script</p>
      <textarea id="script-edit" rows="14" class="mt-3 w-full rounded-lg border-2 border-foreground/15 p-2.5 font-mono text-[12px] leading-relaxed outline-none focus:border-[#4f5bd5]">${ctx.esc(l.scriptText ?? "")}</textarea>
      <p class="mt-1.5 text-[11px] text-foreground/45">Saved as a copy next to the task. The coordinator checks for your version before the take and before James.</p>
      <button data-save-script class="${ctx.BTN} mt-3">Save</button>`, (sheet) => {
      sheet.querySelector("[data-save-script]").onclick = async () => {
        const text = sheet.querySelector("#script-edit").value;
        try {
          const r = await ctx.A.live.saveEdit(task.name, "2-script.md", text);
          l.scriptText = text;
          await ctx.refreshLive();
          ctx.closeSheet(); ctx.refresh();
          ctx.toast("Saved — the coordinator uses your version for the take and for James");
          void r;
        } catch (e) { ctx.toast((e.message)); }
      };
    });
  });
  if (!run) return;
  // demo run
  root.querySelector("[data-advance]")?.addEventListener("click", () => { ctx.A.advance(run); save(); });
  root.querySelector("[data-demo-topup]")?.addEventListener("click", () => ctx.topUpSheet(ctx));
  const sim = {
    "run-take": () => { ctx.A.resolveYou(run); ctx.toast("Simulated: you put the take in the folder"); },
    "run-old": () => { ctx.A.resolveYou(run); ctx.toast("Simulated: an old take was picked"); },
    "run-ai": () => {
      if (!ctx.A.wallet.canPay(2)) { ctx.topUpSheet(ctx); return false; }
      ctx.A.wallet.spend("AI take (Seedance)", 2); ctx.A.resolveYou(run); ctx.toast("Simulated: AI take generated · −2 cr");
    },
    "run-retry": () => { ctx.A.retry(run); ctx.toast("Simulated: retry"); },
    "run-stop": () => { ctx.toast("Simulated: stopped — the task waits in the chat"); return false; },
    "run-continue": () => {
      const a = ctx.A.agentBySlug[run.steps[run.cur].slug];
      if (!ctx.A.wallet.canPay(a.cost)) { ctx.toast("Not enough on your balance yet — top up first"); return false; }
      ctx.A.resume(run); ctx.toast("Simulated: continued from the same step");
    },
    "run-again": () => { ctx.ui.run = ctx.A.newRun(run.steps.map((s) => s.slug), run.task, { failOnce: null }); ctx.toast("Simulated: one more started"); },
    "run-fix": () => { ctx.toast("In the chat you write what to change; the agent remembers it"); return false; },
    "run-team-yes": () => {
      const t = ctx.A.TEAMS.find((x) => x.chain.includes(run.steps[0].slug) && x.chain.length > 1);
      ctx.simulateHire(ctx, t.chain.filter((x) => x !== "you"), { teamId: t.id, task: t.firstTask });
      return false;
    },
    "run-team-no": () => { ctx.ui.entry = null; },
  };
  root.querySelectorAll("[data-sim^='run-']").forEach((b) => {
    b.onclick = () => { if (sim[b.dataset.sim]?.() !== false) save(); };
  });
  // result: rating + what next
  root.querySelectorAll("[data-star]").forEach((b) => { b.onclick = () => { l.blocker = root.querySelector("#blocker")?.value ?? ""; l.star = Number(b.dataset.star); ctx.rerender(); }; });
  root.querySelector("[data-rate]")?.addEventListener("click", async () => {
    try {
      await ctx.A.live.rate({ task: run.task, rating: l.star, blocker: root.querySelector("#blocker").value, agents: run.steps.map((s) => s.slug).filter((s) => s !== "you") });
      run.rated = true; l.star = 0; l.blocker = ""; save();
      ctx.toast("Rating saved to .data/ratings.jsonl");
    } catch (e) { ctx.toast((e.message)); }
  });
  root.querySelector("[data-own-team]")?.addEventListener("click", () => { ctx.local("library").goal = "all"; ctx.go("library"); });
}
