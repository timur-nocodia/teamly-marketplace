// BUILDER: an agent being built, step by step, as the forge writes ~/.teamly/builds/<slug>.json (/api/state → builds).
// The agent walks a track of 7 stations: the job, its number, research (your chats, the craft, GitHub and skill
// catalogs, the Teamly library), the rules, integrations with their price, a test drive against plain Claude, launch.
// One bar says where to act now: the chat on the left, here (buttons reach the chat, SKILL.md «Кнопки панели»), or
// nowhere (it is working). Below: the step, then the agent as it will be at work. Done: Keep it or Redo a step.
// A library agent you hire takes the short path: number, integrations, launch. ui.buildRef = slug; none → the newest.

export const STEPS = [
  ["job", "The job"],
  ["metric", "Its number"],
  ["research", "Research"],
  ["ontology", "The plan"],
  ["integrations", "Integrations"],
  ["test", "Test drive"],
  ["launch", "Launch"],
];
const FAST = ["metric", "integrations", "launch"];
const SHORT = { job: "Job", metric: "Number", research: "Research", ontology: "Plan", integrations: "Tools", test: "Test", launch: "Launch" };

export const stepsOf = (b) => (b?.path === "fast" ? STEPS.filter(([id]) => FAST.includes(id)) : STEPS);
export const activeBuilds = (S) => (S?.builds ?? []).filter((b) => b.step !== "done");
export function buildOf(ctx) {
  const all = ctx.S.builds ?? [];
  return all.find((b) => b.slug === ctx.ui.buildRef) ?? all[0] ?? null;
}
// where it is: index of the current step among this path's steps (done = past the last)
export function progress(b) {
  const steps = stepsOf(b);
  if (b?.step === "money") b = { ...b, step: "integrations" };  // the old name of the step
  if (b?.step === "done") return { at: steps.length, of: steps.length, label: "Ready" };
  const i = Math.max(0, steps.findIndex(([id]) => id === b?.step));
  return { at: i, of: steps.length, label: steps[i]?.[1] ?? "" };
}

const arr = (x) => (Array.isArray(x) ? x : x ? [x] : []);
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
// 2100 → 2.1K, 12 → 12, 0.4 → 0.4
export function short(v) {
  const n = num(v);
  if (n === null) return "n/a";
  const a = Math.abs(n);
  if (a >= 1e6) return `${+(n / 1e6).toFixed(1)}M`;
  if (a >= 1e4) return `${Math.round(n / 1e3)}K`;
  if (a >= 1e3) return `${+(n / 1e3).toFixed(1)}K`;
  return `${+n.toFixed(a < 10 ? 1 : 0)}`;
}
const plural = (unit) => { const u = String(unit || "run").replace(/^(a|an|one|per)\s+/i, ""); return /s$/.test(u) ? u : `${u}s`; };
const money$ = (v) => { const n = num(v); return n === null ? null : `$${n < 1 ? n.toFixed(2) : +n.toFixed(2)}`; };
const dateShort = (s) => { const d = s ? new Date(`${String(s).slice(0, 10)}T12:00:00`) : null; return d && !isNaN(d) ? d.toLocaleDateString([], { day: "numeric", month: "short" }) : ""; };

// ---------------------------------------------------------------- shared pieces (also used by the agent and library screens)

// A number answered with buttons is said in the button's words ("over 30"), and then without the unit ("under a third",
// not "under a third %"). Labels come as a dictionary from metrics.py or as lists (scale + labels) from a build file.
export function labelOf(m, v) {
  if (!m || v === null || v === undefined) return null;
  if (m.labels && !Array.isArray(m.labels)) return m.labels[String(v)] ?? null;
  const i = Array.isArray(m.scale) && Array.isArray(m.labels) ? m.scale.findIndex((x) => Number(x) === Number(v)) : -1;
  return i >= 0 ? String(m.labels[i]) : null;
}
export const sayNumber = (m, v, { unit = true } = {}) => labelOf(m, v) ?? `${short(v)}${unit && m?.unit ? ` ${m.unit}` : ""}`;

// A thin line of the last values: the panel's own SVG, no library.
export function sparkline(series, better = "higher") {
  const v = arr(series).map(num).filter((x) => x !== null);
  if (v.length < 2) return "";
  const lo = Math.min(...v), hi = Math.max(...v), w = 72, h = 22;
  const pts = v.map((x, i) => `${((i / (v.length - 1)) * w).toFixed(1)},${(h - 2 - ((x - lo) / (hi - lo || 1)) * (h - 4)).toFixed(1)}`).join(" ");
  const up = better === "lower" ? v[v.length - 1] <= v[0] : v[v.length - 1] >= v[0];
  return `<svg viewBox="0 0 ${w} ${h}" class="h-[22px] w-[72px]" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="${up ? "#4f5bd5" : "#a3a3a3"}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
}

// One number: what it is now, where it started, the goal, how it is counted. kind = "agent" (proves the agent) | "result"
export function metricTile(ctx, m, kind) {
  if (!m?.name) return "";
  const now = num(m.now), base = num(m.baseline);
  const say = (v) => labelOf(m, v) ?? short(v);  // answered with buttons: the button's words
  const labeled = labelOf(m, now) !== null;
  // "start → now" only against a start counted without the agent; otherwise the number now, and nothing to compare
  const moved = base !== null && now !== null && m.count > 1 && m.baselineWithout !== false;
  const change = num(m.change);
  const pct = change !== null && moved && !labeled ? `${change >= 0 ? "+" : "−"}${Math.round(Math.abs(change) * 100)}%` : "";  // no % from buttons
  const before = m.count === 1 && m.baselineWithout;  // only the start so far: the number without the agent
  const how = m.how === "auto"
    ? [m.where, m.every ? `counted ${m.every}` : "counted by a tool", num(m.cost) ? `~${money$(m.cost)} a check` : "free"].filter(Boolean).join(" · ")
    : m.ask ? `you tell me ${m.ask}` : "you tell me";
  return `
  <div class="min-w-0 flex-1 rounded-lg ${kind === "agent" ? "border-2 border-[#4f5bd5]/25 bg-[#4f5bd5]/[0.04]" : "border-2 border-foreground/10"} px-3 py-2.5">
    <p class="${ctx.PX} text-[6px] ${kind === "agent" ? "text-[#4f5bd5]" : "text-foreground/40"}">${kind === "agent" ? "The agent" : "Your result"}</p>
    <div class="mt-1.5 flex items-end justify-between gap-2">
      <p class="text-[22px] font-semibold leading-none tracking-tight">${moved ? `<span class="text-[13px] font-normal text-foreground/40">${ctx.esc(say(base))} → </span>` : ""}${ctx.esc(say(now))}${m.unit && !labeled ? `<span class="ml-1 text-[11px] font-normal text-foreground/50">${ctx.esc(m.unit)}</span>` : ""}</p>
      ${sparkline(m.series, m.better)}
    </div>
    <p class="mt-1 text-[12px] leading-snug">${ctx.esc(m.name)}${before ? ' <span class="text-foreground/45">before it</span>' : ""}${pct ? ` <span class="font-semibold ${change >= 0 ? "text-[#4f5bd5]" : "text-foreground/45"}">${pct}</span>` : ""}</p>
    ${num(m.target) !== null ? `<p class="text-[11px] text-foreground/50">goal ${ctx.esc(sayNumber(m, m.target))}${m.by ? ` by ${dateShort(m.by)}` : ""}</p>` : ""}
    <p class="mt-1 text-[10.5px] leading-snug text-foreground/45">${ctx.esc(how)}</p>
  </div>`;
}
export function metricTiles(ctx, metrics) {
  if (!metrics?.agent && !metrics?.result) return "";
  return `<div class="flex flex-col gap-2 min-[420px]:flex-row">${metricTile(ctx, metrics.agent, "agent")}${metricTile(ctx, metrics.result, "result")}</div>`;
}

// What the agent does without a Teamly key and what the key adds. From the card's withoutKey / withKey, or read off
// its costFor and costBreakdown (cards written before these fields). null when it has no paid tools at all.
export function moneyOfCard(card) {
  if (!card) return null;
  const wk = card.withKey && typeof card.withKey === "object" ? card.withKey : null;
  const free = arr(card.withoutKey).filter((x) => typeof x === "string");
  if (wk && arr(wk.adds).length) {
    return { free: free.length ? free : [String(card.costFor ?? "").replace(/^free:\s*/i, "")].filter(Boolean), key: arr(wk.adds).filter((x) => typeof x === "string"), cost: num(wk.cost), unit: wk.unit ?? "", note: wk.note ?? "" };
  }
  const paid = arr(card.costBreakdown).filter((c) => c && typeof c === "object" && c.tool);
  if (!paid.length) return free.length ? { free, key: [], cost: null, unit: "" } : null;  // a free agent says so
  return { free: [String(card.costFor ?? "").replace(/^free:\s*/i, "")].filter(Boolean), key: paid.map((c) => String(c.tool).replace(/\s*\(only with your ok\)/i, "")),
    cost: num(paid[0].credits), unit: paid[0].unit ? String(paid[0].unit).replace(/^(one|1|per)\s+(?=(\w))/i, (_, __, c) => (/[aeiou]/i.test(c) ? "an " : "a ")) : "" };
}
// Two columns side by side. The price is the card's (the exact one is asked before every paid run); with a real
// balance, how far it goes.
export function moneyColumns(ctx, m, { compact = false } = {}) {
  if (!m) return "";
  const list = (items) => items.map((x) => `<li class="flex gap-1.5"><span class="mt-[7px] size-1 shrink-0 rounded-full bg-current opacity-50"></span><span>${ctx.esc(x)}</span></li>`).join("");
  const w = ctx.money?.() ?? {};
  // the server holds ~$0.30 before a paid call, so the balance covers runs only above that
  const free = w.state === "real" && num(w.balance) !== null ? w.balance - (num(w.held) ?? 0) : null;
  const runs = free !== null && num(m.cost) ? (free < 0.3 ? 0 : Math.floor((free - 0.3 + m.cost) / m.cost)) : null;
  const price = num(m.cost) !== null ? `~${money$(m.cost)}${m.unit ? ` ${ctx.esc(m.unit)}` : ""}` : "price shown before each run";
  if (!m.key.length) {
    return `<div class="rounded-lg bg-muted px-3 py-2.5 ${compact ? "text-[11.5px]" : "text-[12.5px]"} leading-snug">
      <p class="${ctx.PX} text-[6px] text-foreground/45">Free</p>
      <ul class="mt-1.5 flex flex-col gap-1 text-foreground/75">${list(m.free)}</ul>
      <p class="mt-2 text-[11px] text-foreground/50">No paid tools: it all runs on your Claude plan, no Teamly key needed.</p></div>`;
  }
  return `
  <div class="grid grid-cols-2 gap-2 ${compact ? "text-[11.5px]" : "text-[12.5px]"} leading-snug">
    <div class="rounded-lg bg-muted px-3 py-2.5">
      <p class="${ctx.PX} text-[6px] text-foreground/45">Free</p>
      <ul class="mt-1.5 flex flex-col gap-1 text-foreground/75">${list(m.free.length ? m.free : ["Its own work, on your Claude plan"])}</ul>
    </div>
    <div class="rounded-lg border-2 border-[#4f5bd5]/30 bg-[#4f5bd5]/[0.05] px-3 py-2.5">
      <p class="${ctx.PX} flex items-center gap-1 text-[6px] text-[#4f5bd5]">${ctx.icon("key", "size-2.5")} With your key</p>
      <ul class="mt-1.5 flex flex-col gap-1">${list(m.key)}</ul>
      <p class="mt-2 font-semibold">${price}</p>
      ${num(m.cost) ? `<p class="text-[10.5px] text-foreground/55">${SOLO.name}, $${SOLO.usd} a month: ~${Math.floor(SOLO.td / m.cost)} ${plural(m.unit)} · or top up from $5</p>` : ""}
      ${m.note ? `<p class="text-[10.5px] text-foreground/50">${ctx.esc(m.note)}</p>` : ""}
      ${runs !== null ? `<p class="text-[10.5px] text-foreground/50">your ${money$(w.balance)} covers ~${runs}</p>` : ""}
      <button data-open-plans class="mt-1 text-[10.5px] font-medium text-[#4f5bd5] hover:underline">Plans ▸</button>
    </div>
  </div>`;
}

// The number that proved the agent, as its card carries it after sharing (package-format.md "proof"):
// {"agent": {"name", "from", "to", "unit", "weeks"}, "result": {...}, "people": N}. Nothing to show → "".
export const proofText = (a) => `${a.fromLabel ?? short(a.from)} → ${a.toLabel ?? short(a.to)}${a.unit && !a.toLabel ? ` ${a.unit}` : ""}`;
export function proofLine(ctx, proof) {
  const a = proof?.agent;
  if (!a?.name || num(a.from) === null || num(a.to) === null) return "";
  const over = num(a.weeks) ? ` in ${a.weeks} ${a.weeks === 1 ? "week" : "weeks"}` : num(a.days) ? ` in ${a.days} days` : "";
  return `<p class="mt-2 flex items-start gap-1.5 text-[12px] leading-snug">${ctx.icon("chart", "mt-0.5 size-3.5 shrink-0 text-[#4f5bd5]")}<span><b>${ctx.esc(a.name)}: ${ctx.esc(proofText(a))}</b>${over}<span class="text-foreground/50"> · its author's own count</span></span></p>`;
}

// A compact card for the floor and the library: name, step, a bar, open.
export function buildCard(ctx, b) {
  const p = progress(b);
  return `
  <button data-open-build="${ctx.esc(b.slug)}" class="${ctx.CARD} flex w-full items-center gap-3 p-3 text-left transition-colors hover:border-[#4f5bd5]/40">
    <img src="./assets/agents/${sprite(b) ?? "create-agent-silhouette"}.png" alt="" class="size-10 shrink-0 object-contain ${b.step === "done" ? "" : "animate-[pixelBob_2s_ease-in-out_infinite]"}" />
    <div class="min-w-0 flex-1">
      <p class="${ctx.LABEL}">${b.step === "done" ? "Agent ready" : `Building · ${p.at + 1} of ${p.of}`}</p>
      <p class="mt-1 truncate text-[13.5px] font-semibold">${ctx.esc(b.name ?? b.slug)}</p>
      <div class="mt-1.5 h-1 rounded-full bg-foreground/10"><div class="h-full rounded-full bg-[#4f5bd5]" style="width:${Math.round((Math.min(p.at, p.of) / p.of) * 100)}%"></div></div>
    </div>
    ${ctx.icon("chevronRight", "size-4 shrink-0 text-foreground/35")}
  </button>`;
}
const sprite = (b) => { const x = b?.preview?.sprite ?? b?.sprite; return typeof x === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(x) ? x : null; };
import { startWorking } from "./office.js";
import { SOLO } from "../money.js";
// the sprites that have a "working" loop in assets/agents (the office plays the same ones)
const WORKING = new Set(["creative01", "creative05", "creative06", "creative11", "formal01", "formal03", "formal05", "formal12", "hoodie03", "hoodie07", "smartcasual01", "smartcasual21", "streetwear01", "streetwear13"]);

// ---------------------------------------------------------------- the steps

function summary(ctx, b, id) {
  const r = b.research ?? {};
  const m = b.metric ?? {};
  const t = b.test ?? {};
  switch (id) {
    case "job": return b.job?.outcome ?? [b.job?.from, b.job?.gets].filter(Boolean).join(" → ");
    case "metric": return m.agent?.name ? `${m.agent.name}${num(m.agent.now) !== null ? `: ${sayNumber(m.agent, m.agent.now)} without it` : ""}` : "";  // views are context, never the agent's line
    case "research": return [num(r.chats?.sessions) !== null && `${r.chats.sessions} chats`, num(r.craft?.sources) !== null && `${r.craft.sources} sources`, num(r.social?.sources) !== null && `${r.social.sources} posts`,
      r.github && `${arr(r.github.found).length} on GitHub`, r.library && `${arr(r.library.found).length} in the library`].filter(Boolean).join(" · ");
    case "ontology": return arr(b.preview?.steps).length ? `${arr(b.preview.steps).length} steps · ${arr(b.ontology?.rules).length} rules` : arr(b.ontology?.rules).length ? `${arr(b.ontology.rules).length} rules` : "";
    case "money":
    case "integrations": { const g = integrationsOf(b); if (!g) return ""; const run = num(g.perRun?.exp);
      return `${g.items.length} ${g.items.length === 1 ? "tool" : "tools"} · ${run ? `~${money$(run)} a run` : "free"}`; }
    case "test": { const runs = arr(t.runs); const checks = runs.flatMap((r) => arr(r?.checks));
      return checks.length && checks.some((c) => c?.pass != null) ? `${checks.filter((c) => c?.pass === true).length} of ${checks.length} checks passed`
        : runs.length ? `${runs.length} ${runs.length === 1 ? "run" : "runs"} done` : num(t.tasks) !== null ? `${t.win ?? 0} won · ${t.tie ?? 0} same · ${t.loss ?? 0} lost of ${t.tasks}` : ""; }
    case "launch": return [b.launch?.floor && `On ${b.launch.floor}`, b.launch?.measure && `counted ${b.launch.measure}`].filter(Boolean).join(" · ");
    default: return "";
  }
}

const spin = '<span class="size-3 animate-spin rounded-full border-2 border-[#4f5bd5]/25 border-t-[#4f5bd5]"></span>';
function stateIcon(ctx, st) {
  return st === "done" ? ctx.icon("check", "size-4 text-[#4f5bd5]") : st === "running" || st === "active" ? spin
    : st === "skipped" ? '<span class="h-0.5 w-2.5 rounded-full bg-foreground/25"></span>' : '<span class="size-2 rounded-full bg-foreground/15"></span>';
}

function researchTile(ctx, b) {
  const r = b.research ?? {};
  const src = [
    ["chats", "Your chats", r.chats, (x) => x.top ? String(x.top) : num(x.sessions) !== null ? `${x.sessions} chats${num(x.edits) ? ` · ${x.edits} of your edits` : ""}` : ""],
    ["craft", "How pros do it", r.craft, (x) => arr(x.highlights)[0] ? String(arr(x.highlights)[0]) : num(x.sources) !== null ? `${x.sources} sources` : ""],
    ["social", "What people write", r.social, (x) => arr(x.highlights)[0] ? String(arr(x.highlights)[0]) : num(x.sources) !== null ? `${x.sources} posts` : ""],
    ["github", "Ready-made tools", r.github, (x) => { const used = arr(x.found).find((g) => g && (g.use === "tool" || g.use === "idea"));
      return used ? `${String(used.name).split("/").pop()}: ${used.why ?? (used.use === "tool" ? "uses it" : "takes ideas")}` : x.found ? `${arr(x.found).length} checked, none fit` : ""; }],
    ["library", "Teamly library", r.library, (x) => x.found ? (arr(x.found).length ? `${arr(x.found).length} close to it` : "nothing close yet") : ""],
  ];
  const gh = arr(r.github?.found).filter((g) => g && typeof g === "object" && g.name).slice(0, 6);
  const KIND = { plugin: "Plugin", skill: "Skill", mcp: "Connector", repo: "Code", ontology: "Know-how", case: "Case", post: "Post" };
  const lib = arr(r.library?.found).filter((x) => x && typeof x === "object" && x.name);
  const base = lib.find((x) => x.pick) ?? null;
  const useChip = (u) => ({ tool: ["Uses it", "bg-[#4f5bd5]/10 text-[#4f5bd5]"], idea: ["Takes ideas", "bg-muted text-foreground/60"], skip: ["Skipped", "text-foreground/40"], check: ["Reading", "text-foreground/45"] }[u] ?? null);
  const highlights = [...arr(r.craft?.highlights).slice(0, 3), ...arr(r.social?.highlights).slice(0, 2)];
  const open = ctx.local("build").finds;
  return `
  <div class="grid grid-cols-2 gap-1.5">
    ${src.map(([id, label, x, line]) => `
    <div class="rounded-lg border-2 ${x?.state === "running" ? "border-[#4f5bd5]/30" : "border-foreground/10"} px-2.5 py-2">
      <div class="flex items-center gap-1.5"><span class="flex size-4 items-center justify-center">${stateIcon(ctx, x?.state ?? (x ? "done" : "next"))}</span><p class="text-[12px] font-medium">${label}</p></div>
      <p class="mt-0.5 line-clamp-2 pl-[22px] text-[11px] leading-snug text-foreground/55">${ctx.esc((x && x.state !== "running" && line(x)) || (x?.state === "skipped" ? "skipped" : x ? "looking…" : "next"))}</p>
    </div>`).join("")}
  </div>
  ${base ? `<p class="mt-2 text-[12px]"><span class="${ctx.PX} mr-1 text-[6px] text-foreground/45">Base</span>${ctx.esc(base.name)}${base.author ? ` by ${ctx.esc(base.author)}` : ""}</p>` : ""}
  ${gh.length || highlights.length ? `<button data-finds class="mt-2 text-[11.5px] font-medium text-[#4f5bd5]">${open ? "Hide what it found" : `See what it found${gh.length ? ` · ${gh.length}` : ""} +`}</button>` : ""}
  ${open && gh.length ? `
  <div class="mt-1.5 flex flex-col divide-y divide-foreground/5 rounded-lg border-2 border-foreground/10">
    ${gh.map((g) => { const c = useChip(g.use); const used = [num(g.trust) !== null ? `trust ${g.trust}` : "",
        num(g.installs) !== null ? `${short(g.installs)} installs` : num(g.stars) !== null ? `★ ${short(g.stars)}` : num(g.points) !== null ? `${short(g.points)} points` : "",
        g.audit === "warn" || g.audit === "fail" ? `audit ${g.audit}` : ""].filter(Boolean).join(" · "); return `
    <div class="flex items-start gap-2 px-2.5 py-1.5" title="${ctx.esc([g.license && `license ${g.license}`, g.updated && `updated ${g.updated}`].filter(Boolean).join(", "))}">
      <div class="min-w-0 flex-1">
        <p class="truncate text-[12px] font-medium">${KIND[g.kind] ? `<span class="mr-1 text-[10px] font-normal text-foreground/45">${KIND[g.kind]}</span>` : ""}${ctx.esc(String(g.name).split("/").pop())}</p>
        <p class="text-[10.5px] text-foreground/50">${[used, g.why].filter(Boolean).map(ctx.esc).join(" · ")}</p>
      </div>
      ${c ? `<span class="${ctx.PX} shrink-0 rounded px-1.5 py-0.5 text-[6px] ${c[1]}">${c[0]}</span>` : ""}
    </div>`; }).join("")}
  </div>
  ${arr(r.github?.found).length > gh.length ? `<p class="mt-1 text-[10.5px] text-foreground/45">+${arr(r.github.found).length - gh.length} more, skipped or read in the chat</p>` : ""}
  <p class="mt-1 text-[10.5px] text-foreground/40">Read, not run: nothing from GitHub is installed without your yes.</p>` : ""}
  ${open && highlights.length ? `<div class="mt-2 flex flex-col gap-1">${highlights.map((h) => `<p class="rounded-md bg-muted px-2 py-1.5 text-[11px] leading-snug">${ctx.esc(h)}</p>`).join("")}</div>` : ""}`;
}

function ontologyTile(ctx, b) {
  const rules = arr(b.ontology?.rules).slice(0, 7);
  if (!rules.length) return "";
  return `<div class="flex flex-col gap-1">${rules.map((r) => `<p class="rounded-md border border-foreground/10 px-2 py-1.5 text-[11.5px] leading-snug">${ctx.esc(r?.text ?? r)}${r?.source ? ` <span class="text-foreground/40">· ${ctx.esc(String(r.source).slice(0, 30))}</span>` : ""}</p>`).join("")}</div>`;
}

// THE JOB: what runs without you. The result first, then when it acts, what it touches, what it does on its own and
// what only after your yes, where you see it work, and the checks that say it is done (the test drive uses them).
const MODE = { auto: ["On its own", "bg-[#4f5bd5]/10 text-[#4f5bd5]"], ask: ["Asks you first", "bg-amber-100 text-amber-800"], never: ["Never", "bg-muted text-foreground/50"] };
const CANVAS = { page: "Its own page", dashboard: "Its own page", report: "A report", messages: "Messages", files: "Files in your folder", board: "Your board" };
function jobTile(ctx, b) {
  const j = b.job ?? {};
  const l = ctx.local("build");
  const systems = arr(j.systems).filter((x) => x && (x.name || typeof x === "string"));
  const actions = arr(j.actions).filter((x) => x && x.text);
  const checks = arr(j.checks).filter(Boolean);
  const canvas = j.canvas && typeof j.canvas === "object" ? j.canvas : null;
  const parts = [];
  if (j.outcome || j.does) parts.push(`<p class="text-[14px] font-semibold leading-snug">${ctx.esc(j.outcome ?? j.does)}</p>`);
  // what it is, in chips: when it runs, what it touches (amber when it writes), where you see it
  const chip = (ic, text, tone = "border-foreground/12 text-foreground/70") => `<span class="inline-flex items-center gap-1 rounded-md border ${tone} px-1.5 py-0.5 text-[11.5px]">${ctx.icon(ic, "size-3")}${text}</span>`;
  const chips = [
    j.when && chip("clock", ctx.esc(j.when)),
    ...systems.map((x) => { const w = x.access === "write" || x.access === "read-write"; return chip(w ? "pencil" : "link", `${ctx.esc(x.name ?? x)}${w ? " · writes" : ""}`, w ? "border-amber-300 text-amber-800" : undefined); }),
    canvas && chip("layoutGrid", ctx.esc(CANVAS[canvas.kind] ?? canvas.kind ?? "")),
  ].filter(Boolean);
  if (chips.length) parts.push(`<div class="flex flex-wrap gap-1">${chips.join("")}</div>`);
  // what it does, one line per mode
  const byMode = ["auto", "ask", "never"].map((m) => [m, actions.filter((x) => (x.mode ?? "ask") === m)]).filter(([, xs]) => xs.length);
  if (byMode.length) parts.push(`<div class="flex flex-col gap-1">${byMode.map(([m, xs]) => `<p class="flex items-start gap-2 text-[12.5px] leading-snug"><span class="mt-[1px] w-[86px] shrink-0 rounded px-1.5 py-0.5 text-center text-[10px] font-medium ${MODE[m][1]}">${MODE[m][0]}</span><span>${xs.slice(0, 3).map((x) => ctx.esc(x.text)).join(" · ")}</span></p>`).join("")}</div>`);
  // the checks come back in the test drive: folded here
  if (checks.length) parts.push(`<div><button data-checks class="text-[11.5px] font-medium text-[#4f5bd5]">${l.checks ? "Hide" : `Done when · ${checks.length} checks +`}</button>
    ${l.checks ? `<ul class="mt-1 flex flex-col gap-1">${checks.slice(0, 5).map((c) => `<li class="flex items-start gap-1.5 text-[12.5px] leading-snug">${ctx.icon("check", "mt-0.5 size-3.5 shrink-0 text-[#4f5bd5]")}${ctx.esc(c.text ?? c)}</li>`).join("")}</ul>` : ""}</div>`);
  if (!parts.length && (j.from || j.gets)) parts.push(`<p class="text-[12.5px]">${ctx.esc([j.from, j.gets].filter(Boolean).join(" → "))}</p>`);
  return parts.length ? `<div class="flex flex-col gap-2.5">${parts.join("")}</div>` : "";
}

// THE PLAN: how it works, from what it takes to what it does, and the rules it decides by (each with its source).
function planTile(ctx, b) {
  const steps = arr(b.preview?.steps);
  const rules = arr(b.ontology?.rules).slice(0, 7);
  const l = ctx.local("build");
  if (!steps.length && !rules.length) return "";
  return `
  ${steps.length ? `<ol class="flex flex-col gap-1.5">${steps.slice(0, 6).map((x, i) => `<li class="flex gap-2 text-[12.5px] leading-snug"><span class="mt-[1px] flex size-4 shrink-0 items-center justify-center rounded bg-[#4f5bd5]/15 text-[9px] font-bold text-[#4f5bd5]">${i + 1}</span>${ctx.esc(x)}</li>`).join("")}</ol>` : ""}
  ${arr(b.preview?.asks).length ? `<p class="mt-2 text-[12px] leading-snug"><span class="mr-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">Asks you</span>${arr(b.preview.asks).map(ctx.esc).join(" · ")}</p>` : ""}
  ${arr(b.preview?.never).length ? `<p class="mt-1 text-[12px] leading-snug"><span class="mr-1 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-foreground/50">Never</span>${arr(b.preview.never).map(ctx.esc).join(" · ")}</p>` : ""}
  ${rules.length ? `<button data-rules class="mt-2 text-[11.5px] font-medium text-[#4f5bd5]">${l.rules ? "Hide the rules" : `The rules it decides by · ${rules.length} +`}</button>
    ${l.rules ? `<div class="mt-1.5 flex flex-col gap-1">${rules.map((r) => `<p class="rounded-md border border-foreground/10 px-2 py-1.5 text-[11.5px] leading-snug">${ctx.esc(r?.text ?? r)}${r?.source ? ` <span class="text-foreground/40">· ${ctx.esc(String(r.source).slice(0, 30))}</span>` : ""}</p>`).join("")}</div>` : ""}` : ""}`;
}

// INTEGRATIONS: each tool the agent uses, what it gives and what it costs, the forecast a run and a month, your balance.
// Older build files carry "money" (free / with your key): read the same way so nothing built before disappears.
export function integrationsOf(b) {
  const g = b?.integrations && typeof b.integrations === "object" ? b.integrations : null;
  if (g && arr(g.items).length) return { ...g, items: arr(g.items).filter((x) => x && typeof x === "object" && x.name) };
  const m = b?.money;
  if (!m || (!arr(m.free).length && !arr(m.key).length)) return null;
  const items = [...arr(m.free).map((x) => ({ name: String(x), kind: "free" })), ...arr(m.key).map((x) => ({ name: String(x), kind: "teamly" }))];
  return { items, perRun: num(m.cost) !== null ? { exp: m.cost } : null };
}
const KIND = {
  app: { group: "Your apps", icon: "link" },
  builtin: { group: "Built in", icon: "check" },
  free: { group: "Built in", icon: "check" },
  paid: { group: "Through Teamly", icon: "key" },
  teamly: { group: "Through Teamly", icon: "key" },
  ownkey: { group: "Your keys", icon: "key" },
  yours: { group: "Your apps", icon: "link" },
};
const BASIS = (g) => g.basis === "test" ? "From your test run" : g.basis === "yours" ? `From your ${num(g.runs) ?? ""} runs`.replace("  ", " ")
  : g.basis === "everyone" ? `From ${num(g.runs) ?? "many"} runs of ${num(g.people) ?? "many"} people` : g.basis === "author" ? "From its author's runs" : "From prices today";
// Runs the balance covers: the server holds a little before a paid call, so a run needs the hold, not just its price.
export function runsLeft(g, available) {
  const run = g?.perRun ?? {}, hold = num(g?.holdUsd) ?? 0, last = g?.lastCall ?? run;
  if (available === null || !(num(run.exp) > 0)) return null;
  if (available < hold) return { low: 0, high: 0 };
  const lo = Math.floor((available - hold + (num(last.max) ?? num(run.max) ?? 0)) / (num(run.max) || run.exp));
  const hi = Math.floor((available - hold + (num(last.exp) ?? 0)) / run.exp);
  return { low: Math.max(0, lo), high: Math.max(lo, hi) };
}
function integrationsTile(ctx, b) {
  const g = integrationsOf(b);
  if (!g) return "";
  const chip = (x) => {
    const k = x.kind;
    if (x.status === "connect" || x.status === "signin") return [x.status === "signin" ? "Sign in" : "Connect", "border border-amber-400 text-amber-700"];
    if (x.status === "failed" || x.status === "blocked") return ["Not working", "border border-amber-400 text-amber-700"];
    if (k === "paid" || k === "teamly") return [num(x.perRun?.exp) ? `~${money$(x.perRun.exp)} a run` : x.price && typeof x.price === "string" ? x.price : "Paid", "bg-[#4f5bd5]/10 text-[#4f5bd5]"];
    if (k === "ownkey") return ["Your key", "bg-muted text-foreground/60"];
    if (k === "app" || k === "yours") return ["Connected", "bg-muted text-foreground/60"];
    return ["Free", "bg-muted text-foreground/60"];
  };
  const row = (x) => { const [label, tone] = chip(x); const paid = x.kind === "paid" || x.kind === "teamly"; return `
    <div class="flex items-start gap-2.5 py-2">
      <span class="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md ${paid ? "bg-[#4f5bd5]/10 text-[#4f5bd5]" : "bg-muted text-foreground/55"}">${ctx.icon(KIND[x.kind]?.icon ?? "link", "size-3.5")}</span>
      <div class="min-w-0 flex-1">
        <p class="text-[13px] font-medium leading-tight">${ctx.esc(x.name)}${x.optional ? ' <span class="text-[11px] font-normal text-foreground/40">optional</span>' : ""}</p>
        ${x.gives ? `<p class="mt-0.5 text-[11.5px] leading-snug text-foreground/55">${ctx.esc(x.gives)}</p>` : ""}
      </div>
      ${x.status === "connect" && x.id ? (x.optional
          ? `<button data-say="connect ${ctx.esc(String(x.id).replace(/[^\w-]/g, ""))}" class="shrink-0 text-[11.5px] font-medium text-foreground/55 underline hover:text-[#4f5bd5]">+ Add</button>`
          : `<button data-say="connect ${ctx.esc(String(x.id).replace(/[^\w-]/g, ""))}" class="shrink-0 rounded-md bg-[#4f5bd5] px-2.5 py-1 text-[11px] font-semibold text-white">Connect</button>`)
        : x.status === "signin" ? `<button data-sign-in class="shrink-0 rounded-md bg-[#4f5bd5] px-2.5 py-1 text-[11px] font-semibold text-white">Sign in</button>`
        : label === "Free" ? "" : `<span class="shrink-0 rounded px-1.5 py-0.5 text-[10.5px] font-medium ${tone}">${ctx.esc(label)}</span>`}
    </div>`; };
  const groups = {};
  for (const x of g.items.slice(0, 10)) (groups[KIND[x.kind]?.group ?? "Built in"] ??= []).push(x);
  const nPaid = g.items.filter((x) => x.kind === "paid" || x.kind === "teamly").length;
  const list = Object.entries(groups).map(([name, xs]) => `<p class="${ctx.PX} mt-2 text-[6px] text-foreground/40">${name}</p><div class="divide-y divide-foreground/5">${xs.map(row).join("")}</div>`).join("");
  const head = `<p class="text-[12px] text-foreground/60">${g.items.length} ${g.items.length === 1 ? "integration" : "integrations"} · ${g.items.length - nPaid} free${nPaid ? ` · ${nPaid} paid` : ""}</p>`;
  const run = g.perRun ?? {}, month = g.perMonth ?? {};
  const paid = num(run.exp) > 0;
  if (!paid) return `${list}<p class="mt-2 text-[12px] text-foreground/55">Free: it all runs on your Claude plan.</p>`;
  const w = ctx.money?.() ?? {};
  const avail = w.state === "real" && num(w.balance) !== null ? Math.max(0, w.balance - (num(w.held) ?? 0)) : null;
  const left = runsLeft(g, avail);
  const needMonth = num(month.max) ?? num(month.exp);
  const short = left && left.low === 0;
  const low = avail !== null && needMonth !== null && avail < needMonth + (num(g.holdUsd) ?? 0);
  const covers = left ? (left.low === left.high ? `${left.low}` : `${left.low} to ${left.high}`) : "";
  const range = num(run.min) !== null && num(run.max) !== null && run.max > run.min ? `from ${money$(run.min)} to ${money$(run.max)}` : "";
  const l = ctx.local("build");
  return `
  ${head}${list}
  <div class="mt-2 rounded-lg border-2 border-[#4f5bd5]/25 bg-[#4f5bd5]/[0.04] px-3 py-2.5">
    <div class="flex items-baseline justify-between gap-2"><p class="text-[20px] font-semibold leading-none">~${money$(run.exp)} <span class="text-[12px] font-normal text-foreground/55">a run</span></p>
      <span class="rounded bg-card px-1.5 py-0.5 text-[10px] text-foreground/55">${ctx.esc(BASIS(g))}</span></div>
    <p class="mt-1 text-[11.5px] text-foreground/60">${[range, num(month.exp) !== null && num(g.runsPerWeek) ? `${g.runsPerWeek === 1 ? "weekly" : `${g.runsPerWeek} a week`} ~${money$(month.exp)} a month` : ""].filter(Boolean).join(" · ")}</p>
    ${num(g.test?.exp) ? `<p class="text-[11px] text-foreground/50">The test drive: ~${money$(g.test.exp)}</p>` : ""}
    <button data-how class="mt-1 text-[11px] font-medium text-[#4f5bd5]">${l.how ? "Hide how it's counted" : "How it's counted +"}</button>
    ${l.how ? `<div class="mt-1 flex flex-col gap-0.5 text-[11px] leading-snug text-foreground/60">${g.items.filter((x) => num(x.perRun?.exp)).map((x) => {
      const v = x.volume ?? {}; const units = num(v.queries) && num(v.perQuery) ? `${v.queries * v.perQuery} results` : num(v.calls) ? `${v.calls} calls` : "";
      return `<p>${ctx.esc(x.name)}: ${units ? `${units}, ` : ""}${money$(x.perRun.min)} to ${money$(x.perRun.max)}${num(v.fill) ? ` · usually ${Math.round(v.fill * 100)}% come back` : ""}</p>`; }).join("")}
      <p>The price is checked again before every run. Paid runs ask you first.</p></div>` : ""}
  </div>
  <div class="mt-2 flex items-center gap-2 rounded-lg ${short || low ? "border-2 border-amber-400 bg-amber-50" : "bg-muted"} px-3 py-2">
    ${ctx.icon("coins", `size-4 shrink-0 ${short || low ? "text-amber-700" : "text-foreground/50"}`)}
    <p class="min-w-0 flex-1 text-[12px] leading-snug">${avail === null ? "Sign in to Teamly to use the paid tools"
      : short ? `Your ${money$(avail)} is not enough for one run` : `Your ${money$(avail)} covers ${covers} ${left?.high === 1 ? "run" : "runs"}${low ? `. A month needs ~${money$(needMonth)}` : ""}`}</p>
    ${avail === null ? `<button data-sign-in class="shrink-0 rounded-md bg-[#4f5bd5] px-2.5 py-1.5 text-[11.5px] font-semibold text-white">Sign in</button>`
      : short || low ? `<button data-top-up class="shrink-0 rounded-md bg-[#4f5bd5] px-2.5 py-1.5 text-[11.5px] font-semibold text-white">Top up</button>` : ""}
  </div>
  ${g.budget?.consent === "yes" ? `<p class="mt-1 text-[11px] text-foreground/55">Allowed: up to ${money$(g.budget.perRunUsd)} a run, ${money$(g.budget.perMonthUsd)} a month</p>`
    : `<p class="mt-1 text-[10.5px] text-foreground/45">${g.items.find((x) => x.lose) ? `${ctx.esc(g.items.find((x) => x.lose).lose)}. ` : ""}Paid runs ask you first.</p>`}`;
}

// TEST DRIVE: the agent does a real task in its own chat (sends and changes only tried) and brings back what it made:
// a picture of its canvas, the page to open, what it did and would do, and the checks from the job. You tick each
// check. For text work you can also compare it blind with plain Claude (test.mode "compare": A and B, picked here).
const pickOf = (ctx, b) => { const l = ctx.local("build"); l.picks ??= {}; return (l.picks[b.slug] ??= {}); };
const tickOf = (ctx, b) => { const l = ctx.local("build"); l.ticks ??= {}; return (l.ticks[b.slug] ??= {}); };
function testTile(ctx, b) {
  const t = b.test ?? {};
  if (t.mode === "compare" || (arr(t.pairs).length && !arr(t.runs).length)) return compareTile(ctx, b);
  const runs = arr(t.runs).filter((r) => r && typeof r === "object");
  const chatLink = t.session ? `<button data-test-chat class="mt-2 inline-flex items-center gap-1 text-[11.5px] font-medium text-[#4f5bd5] hover:underline">${ctx.icon("chat", "size-3")} Open the test chat</button>` : "";
  if (!runs.length) return `
    <div class="flex items-center gap-2.5 rounded-lg border-2 border-foreground/10 px-3 py-2.5">
      <span class="flex size-6 shrink-0 items-center justify-center">${t.session ? spin : ctx.icon("play", "size-4 text-foreground/40")}</span>
      <div class="min-w-0 flex-1"><p class="text-[12.5px] font-medium">${t.session ? "Doing a real task in its own chat" : "Runs a real task in its own chat after your yes"}</p>
        <p class="text-[11px] text-foreground/50">Sends and changes are only tried: nothing goes out.</p></div>
    </div>${chatLink}`;
  const ticks = tickOf(ctx, b);
  const art = (r) => arr(r.artifacts).filter((a) => a && typeof a === "object").slice(0, 4).map((a, i) => {
    if (a.kind === "image" && a.path) return `<button data-shot="${ctx.esc(a.path)}" class="block w-full overflow-hidden rounded-lg border-2 border-foreground/10"><img src="${ctx.A.live.fileUrl(a.path)}" alt="${ctx.esc(a.title ?? "Result")}" loading="lazy" class="max-h-72 w-full object-cover object-top" /></button>`;
    if (a.kind === "page") return `<button data-say="open result ${r.n}${i ? ` ${i + 1}` : ""}" class="flex w-full items-center gap-2 rounded-lg border-2 border-[#4f5bd5]/30 bg-[#4f5bd5]/[0.04] px-3 py-2 text-left"><span class="flex size-7 items-center justify-center rounded-md bg-[#4f5bd5] text-white">${ctx.icon("external", "size-3.5")}</span><span class="min-w-0 flex-1"><span class="block text-[12.5px] font-semibold">${ctx.esc(a.title ?? "Open the result")}</span><span class="block text-[11px] text-foreground/50">Opens next to this panel</span></span></button>`;
    return a.path ? `<a href="${ctx.A.live.fileUrl(a.path)}" target="_blank" rel="noopener" class="inline-flex items-center gap-1 text-[12px] font-medium text-[#4f5bd5] hover:underline">${ctx.icon("file", "size-3.5")} ${ctx.esc(a.title ?? String(a.path).split("/").pop())}</a>` : "";
  }).join("");
  const did = (r) => { const xs = arr(r.actions).filter((x) => x && x.text).slice(0, 6); return xs.length ? `<div class="flex flex-col gap-1">${xs.map((x) => `<p class="flex items-start gap-2 text-[12px] leading-snug"><span class="mt-[1px] shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${x.done ? "bg-[#4f5bd5]/10 text-[#4f5bd5]" : "border border-dashed border-foreground/25 text-foreground/55"}">${x.done ? "Did" : "Would do"}</span><span>${ctx.esc(x.text)}</span></p>`).join("")}</div>` : ""; };
  const checkRow = (r, c, i) => {
    const sent = c.pass === true || c.pass === false, v = sent ? c.pass : ticks[`${r.n}:${i}`];
    const btn = (val, ic, tone) => `<button ${sent ? "disabled" : `data-tick="${r.n}:${i}:${val ? "y" : "n"}"`} class="inline-flex h-7 items-center gap-1 rounded-md border-2 px-2 text-[11.5px] font-medium ${v === val ? tone : "border-foreground/12 text-foreground/55 hover:border-foreground/30"}">${ctx.icon(ic, "size-3")}${val ? "Yes" : "No"}</button>`;
    return `<div class="flex items-center gap-2 py-1.5"><p class="min-w-0 flex-1 text-[12.5px] leading-snug">${ctx.esc(c.text ?? c)}</p>${btn(true, "check", "border-[#4f5bd5] bg-[#4f5bd5] text-white")}${btn(false, "x", "border-amber-500 bg-amber-500 text-white")}</div>`;
  };
  return runs.map((r) => {
    const checks = arr(r.checks).map((c) => (typeof c === "string" ? { text: c, pass: null } : c)).filter((c) => c && c.text);
    const open = checks.filter((c) => c.pass !== true && c.pass !== false);
    const ready = open.length && checks.every((c, i) => c.pass === true || c.pass === false || ticks[`${r.n}:${i}`] !== undefined);
    return `
    <div class="mb-2.5 rounded-lg border-2 border-foreground/10 p-2.5">
      <div class="flex items-center gap-2">${r.state === "running" ? spin : ctx.icon("check", "size-4 text-[#4f5bd5]")}<p class="min-w-0 flex-1 text-[12.5px] font-semibold leading-snug">${runs.length > 1 ? `Run ${r.n} · ` : ""}${ctx.esc(r.title ?? "The task")}</p>${num(r.cost) ? `<span class="text-[11px] text-foreground/45">${money$(r.cost)}</span>` : ""}</div>
      ${r.summary ? `<p class="mt-1 text-[12px] leading-snug text-foreground/70">${ctx.esc(r.summary)}</p>` : ""}
      ${art(r) ? `<div class="mt-2 flex flex-col gap-1.5">${art(r)}</div>` : ""}
      ${did(r) ? `<div class="mt-2">${did(r)}</div>` : ""}
      ${checks.length ? `<p class="${ctx.PX} mt-2.5 text-[6px] text-foreground/45">Does it do this?</p><div class="divide-y divide-foreground/5">${checks.map((c, i) => checkRow(r, c, i)).join("")}</div>` : ""}
      ${open.length ? `<button data-send-checks="${r.n}" ${ready ? "" : "disabled"} class="${ctx.BTN} mt-2">Send my checks</button>
      <p class="mt-1 text-center text-[11px] text-foreground/50">${checks.filter((c, i) => c.pass === true || c.pass === false || ticks[`${r.n}:${i}`] !== undefined).length} of ${checks.length} checked</p>` : ""}
    </div>`;
  }).join("") + (t.verdict ? `<p class="text-[12px] text-foreground/60">${ctx.esc(t.verdict)}</p>` : "") + chatLink;
}

// Blind comparison with plain Claude, for text work: the same task done twice, A and B in random order.
function compareTile(ctx, b) {
  const t = b.test ?? {};
  const pairs = arr(t.pairs).filter((x) => x && typeof x === "object");
  const state = t.state ?? (num(t.win) !== null || num(t.loss) !== null ? "done" : pairs.length ? "pick" : "running");
  if (state === "done") {
    const cell = (n, label, tone) => `<div class="flex-1 rounded-lg ${tone} px-2 py-2 text-center"><p class="text-[18px] font-semibold leading-none">${n ?? 0}</p><p class="mt-1 text-[10.5px]">${label}</p></div>`;
    return `
    <div class="flex gap-1.5">${cell(t.win, "it won", "bg-[#4f5bd5]/[0.07] text-[#4f5bd5]")}${cell(t.tie, "same", "bg-muted text-foreground/60")}${cell(t.loss, "Claude won", "bg-muted text-foreground/60")}</div>
    ${num(t.picked) !== null && num(t.tasks) !== null ? `<p class="mt-1.5 text-[12px]">Blind, you picked it in <b>${t.picked} of ${t.tasks}</b>.</p>` : ""}
    ${t.verdict ? `<p class="mt-1 text-[12px] text-foreground/60">${ctx.esc(t.verdict)}</p>` : ""}`;
  }
  if (!pairs.length) return `<p class="text-[12px] text-foreground/55">Your agent and plain Claude do the same tasks. Then you pick, without knowing which is which.</p>`;
  const picks = pickOf(ctx, b);
  const side = (label, lines) => `<div class="max-h-48 min-w-0 overflow-y-auto rounded-md bg-muted px-2.5 py-2 text-[11.5px] leading-snug"><p class="${ctx.PX} mb-1 text-[7px] text-foreground/45">${label}</p>${arr(lines).slice(0, 12).map((x) => `<p>${ctx.esc(x)}</p>`).join("")}</div>`;
  const pickBtn = (n, v, label) => `<button data-pick="${n}:${v}" class="flex-1 rounded-md border-2 px-1 py-1.5 text-[11.5px] font-medium ${picks[n] === v ? "border-[#4f5bd5] bg-[#4f5bd5] text-white" : "border-foreground/12 text-foreground/70 hover:border-[#4f5bd5]/40"}">${label}</button>`;
  const all = pairs.every((x, i) => picks[x.n ?? i + 1]);
  return `
  <div class="flex flex-col gap-2.5">
    ${pairs.map((x, i) => { const n = x.n ?? i + 1; return `
    <div class="rounded-lg border-2 ${picks[n] ? "border-[#4f5bd5]/30" : "border-foreground/10"} p-2.5">
      <p class="text-[12.5px] font-semibold leading-snug">Task ${n} · ${ctx.esc(x.title ?? "")}</p>
      <div class="mt-2 grid grid-cols-2 gap-1.5">${side("A", x.a)}${side("B", x.b)}</div>
      <div class="mt-2 flex gap-1">${pickBtn(n, "A", "A is better")}${pickBtn(n, "=", "Same")}${pickBtn(n, "B", "B is better")}</div>
    </div>`; }).join("")}
  </div>
  <button data-send-picks ${all ? "" : "disabled"} class="${ctx.BTN} mt-3">${all ? "Send my picks" : `Pick in all ${pairs.length} tasks`}</button>`;
}

function launchTile(ctx, b) {
  const l = b.launch ?? {};
  const team = (ctx.S.teams ?? []).find((t) => t.slug === b.team);
  const live = team?.agents?.find((a) => a.slug === b.slug);
  const numbers = live?.metrics ?? null;
  return `
  ${l.floor || l.measure || l.trigger ? `<p class="text-[12.5px]">${[l.floor && `On the ${ctx.esc(l.floor)} floor`, l.trigger && `runs ${ctx.esc(String(l.trigger).charAt(0).toLowerCase() + String(l.trigger).slice(1))}`, l.measure && `its number checked ${ctx.esc(l.measure)}`, l.next && `first count ${dateShort(l.next)}`].filter(Boolean).join(" · ")}</p>` : ""}
  ${numbers ? `<div class="mt-2">${metricTiles(ctx, numbers)}</div>` : ""}
  ${live ? `<button data-open-agent="${ctx.esc(b.slug)}" class="${ctx.BTN2} mt-2">Its page and numbers</button>` : ""}`;
}

function tileFor(ctx, b, id) {
  switch (id) {
    case "job": return jobTile(ctx, b);
    case "metric": return metricTiles(ctx, { agent: b.metric?.agent && { ...b.metric.agent, count: 1 }, result: b.metric?.result && { ...b.metric.result, count: 1 } });
    case "research": return researchTile(ctx, b);
    case "ontology": return planTile(ctx, b);
    case "money":
    case "integrations": return integrationsTile(ctx, b);
    case "test": return testTile(ctx, b);
    case "launch": return launchTile(ctx, b);
    default: return "";
  }
}

// HOW IT WILL LOOK AND BEHAVE: the agent as a new colleague, filled in as the steps go (preview in the build file):
// its look at work, when it works, what it does in order, when it asks you, what it never does, a bit of a real
// result. Empty parts say which step brings them, nothing is made up.
function agentLook(ctx, b, cls, { work = false } = {}) {
  const sp = sprite(b);
  const img = `<img data-idle src="./assets/agents/${sp ?? "create-agent-silhouette"}.png" alt="" class="size-full object-contain transition-opacity duration-200" />`;
  if (!work || !sp || !WORKING.has(sp)) return `<div class="${cls} relative shrink-0">${img}</div>`;
  return `<div data-look-working class="${cls} relative shrink-0">${img}
    <video data-work-video src="./assets/agents/${sp}-working.webm" muted loop playsinline preload="auto" class="pointer-events-none absolute inset-0 size-full opacity-0"></video>
    <canvas data-work-canvas width="192" height="192" class="pointer-events-none absolute inset-0 size-full opacity-0"></canvas></div>`;
}
function agentPreview(ctx, b) {
  const pv = b.preview && typeof b.preview === "object" ? b.preview : {};
  const steps = arr(pv.steps).length ? arr(pv.steps) : arr(b.job?.steps);
  const later = (what) => `<p class="text-[12px] text-foreground/35">${what}</p>`;
  const row = (label, body) => `<div class="grid grid-cols-[76px_1fr] gap-2 border-t border-foreground/5 py-2.5"><p class="${ctx.PX} pt-0.5 text-[6px] text-foreground/45">${label}</p><div class="min-w-0">${body}</div></div>`;
  const list = (items) => `<ul class="flex flex-col gap-0.5 text-[12.5px] leading-snug">${items.map((x) => `<li>${ctx.esc(x)}</li>`).join("")}</ul>`;
  const m = b.metric?.agent;
  return `
  <div class="mt-4 ${ctx.CARD} p-3.5">
    <div class="flex items-center gap-3">
      <div class="flex size-20 shrink-0 items-end justify-center rounded-lg bg-muted">${agentLook(ctx, b, "size-20", { work: true })}</div>
      <div class="min-w-0">
        <p class="text-[15px] font-semibold leading-tight">${ctx.esc(b.name ?? b.slug)}</p>
        ${b.role ? `<p class="mt-0.5 text-[12px] leading-snug text-foreground/60">${ctx.esc(b.role)}</p>` : ""}
        ${pv.rhythm ? `<p class="mt-1 flex items-center gap-1 text-[11.5px] text-foreground/55">${ctx.icon("clock", "size-3")} ${ctx.esc(pv.rhythm)}</p>` : ""}
      </div>
    </div>
    <div class="mt-3">
      ${(() => { const sys = arr(b.job?.systems).map((x) => x?.name ?? x).filter(Boolean);
        return sys.length ? row("Works with", `<p class="text-[12.5px]">${sys.map(ctx.esc).join(" · ")}</p>`)
          : row("You give", b.job?.from ? `<p class="text-[12.5px]">${ctx.esc(b.job.from)}</p>` : later("after the job")); })()}
      ${row("It does", steps.length ? `<ol class="flex flex-col gap-1 text-[12.5px] leading-snug">${steps.slice(0, 5).map((x, i) => `<li class="flex gap-2"><span class="mt-[1px] flex size-4 shrink-0 items-center justify-center rounded bg-[#4f5bd5]/15 text-[9px] font-bold text-[#4f5bd5]">${i + 1}</span>${ctx.esc(x)}</li>`).join("")}</ol>` : later("after the rules"))}
      ${row("Asks you", arr(pv.asks).length ? list(arr(pv.asks)) : later("after the rules"))}
      ${row("Never", arr(pv.never).length ? list(arr(pv.never)) : later("after the rules"))}
      ${row("Its number", m?.name ? `<p class="text-[12.5px]">${ctx.esc(m.name)}${num(m.now) !== null ? `: ${ctx.esc(sayNumber(m, m.now))} without it` : ""}${num(m.target) !== null ? ` <span class="text-foreground/45">· goal ${ctx.esc(sayNumber(m, m.target))}</span>` : ""}</p>` : later("after the number"))}
    </div>
    <p class="${ctx.PX} mt-1 text-[6px] text-foreground/45">You get</p>
    ${(() => { const shot = arr(b.test?.runs).flatMap((r) => arr(r?.artifacts)).find((x) => x?.kind === "image" && x.path);
      return shot ? `<button data-shot="${ctx.esc(shot.path)}" class="mt-2 block w-full overflow-hidden rounded-lg border-2 border-foreground/10"><img src="${ctx.A.live.fileUrl(shot.path)}" alt="" loading="lazy" class="max-h-60 w-full object-cover object-top" /></button><p class="mt-1 text-[10.5px] text-foreground/40">From its test drive</p>` : ""; })()}
    ${arr(b.test?.runs).some((r) => arr(r?.artifacts).some((x) => x?.kind === "image")) ? "" : arr(pv.example).length
      ? `<div class="mt-2 flex gap-2">${agentLook(ctx, b, "size-8")}<div class="min-w-0 flex-1 rounded-lg rounded-tl-none bg-muted px-3 py-2 text-[12.5px] leading-snug">${arr(pv.example).slice(0, 4).map((x) => `<p>${ctx.esc(x)}</p>`).join("")}</div></div>
         ${pv.exampleFrom ? `<p class="mt-1 text-[10.5px] text-foreground/40">${ctx.esc(pv.exampleFrom)}</p>` : ""}`
      : `<p class="mt-1 text-[12.5px]">${ctx.esc(b.job?.outcome ?? b.job?.gets ?? "")}</p>${later("A real result appears after the test drive")}`}
  </div>`;
}

// The chat asks; here it only says so, in the floor's amber "needs you" look (not a button: nothing to press here)
const askBar = (ctx, b) => b.ask ? `
  <div class="mt-3 flex items-center gap-2.5 rounded-xl border-2 border-amber-400 bg-amber-50 px-3 py-2.5">
    <span class="flex size-7 shrink-0 items-center justify-center rounded-full bg-amber-400 text-[15px] font-black text-white">!</span>
    <span class="min-w-0 flex-1"><span class="${ctx.PX} block text-[7px] text-amber-800">Answer in the chat on the left</span><span class="mt-0.5 block text-[12.5px] text-amber-950">${ctx.esc(String(b.ask).replace(/\s*answer in the chat\.?$/i, ""))}</span></span>
  </div>` : "";

// The icon of each station on the track.
const STEP_ICON = { job: "file", metric: "chart", research: "search", ontology: "list", integrations: "link", money: "link", test: "flask", launch: "play" };

// ---------------------------------------------------------------- the screen
// Where to act now: one bar. The chat asks (amber, "Answer in the chat on the left"), or the choice is here (blue,
// buttons below reach the chat), or nothing is asked and it is working (grey, what it does now).
function actBar(ctx, b, p) {
  if (b.step === "done") return "";
  if (b.ask) return askBar(ctx, b);
  if (b.waitOn === "panel") return `
  <div class="mt-3 flex items-center gap-2.5 rounded-xl border-2 border-[#4f5bd5] bg-[#4f5bd5]/[0.06] px-3 py-2.5">
    <span class="flex size-7 shrink-0 items-center justify-center rounded-full bg-[#4f5bd5] text-white">${ctx.icon("hand", "size-4")}</span>
    <span class="min-w-0 flex-1 text-[13px] font-semibold text-[#4f5bd5]">Your turn: answer below ↓</span>
  </div>`;
  return `
  <div class="mt-3 flex items-center gap-2.5 rounded-xl bg-muted px-3 py-2.5">
    <span class="flex size-7 shrink-0 items-center justify-center">${spin}</span>
    <span class="min-w-0 flex-1 text-[12.5px] text-foreground/70">${ctx.esc(b.working ?? `Working on ${p.label.toLowerCase()}`)}…</span>
  </div>`;
}

// The track: one station per step, the agent standing at the current one. Done stations open their step.
function track(ctx, b, steps, p, done, shown) {
  const at = done ? steps.length - 1 : p.at;
  return `
  <div class="relative mt-4 rounded-xl border-2 border-foreground/10 bg-muted/60 px-2 pb-2.5 pt-1">
    <span class="absolute bottom-[34px] left-[8%] right-[8%] h-0.5 bg-foreground/10"></span>
    <div class="relative grid" style="grid-template-columns:repeat(${steps.length},minmax(0,1fr))">
      ${steps.map(([id], i) => {
        const st = done || i < p.at ? "done" : i === p.at ? "active" : "next";
        return `
        <button ${st !== "next" ? `data-step="${id}"` : "disabled"} aria-label="${ctx.esc(steps[i][1])}" class="flex flex-col items-center gap-1 pt-1">
          <span class="flex h-11 items-end">${i === at ? agentLook(ctx, b, `size-11 ${done ? "" : "animate-[pixelBob_2s_ease-in-out_infinite]"}`) : ""}</span>
          <span class="flex size-8 items-center justify-center rounded-md border-2 ${st === "done" ? "border-[#4f5bd5] bg-[#4f5bd5] text-white" : st === "active" ? "border-[#4f5bd5] bg-card text-[#4f5bd5]" : "border-foreground/15 bg-card text-foreground/30"} ${shown === id ? "ring-2 ring-[#4f5bd5]/35" : ""}">${ctx.icon(STEP_ICON[id] ?? "file", "size-3.5")}</span>
          <span class="h-1.5"></span>
        </button>`;
      }).join("")}
    </div>
  </div>`;
}

// The step you look at: the current one, or a done one you opened. A done step can be redone with a reason.
function stepCard(ctx, b, steps, p, done, shown) {
  const i = steps.findIndex(([id]) => id === shown);
  if (i < 0) return "";
  const [id, label] = steps[i];
  const st = done || i < p.at ? "done" : i === p.at ? "active" : "next";
  const tile = tileFor(ctx, b, id);
  const line = summary(ctx, b, id);
  const mine = b.waitOn === "panel" && st === "active";
  const actions = mine && id === "job" ? `
    <div class="mt-2 flex gap-2"><button data-say="job ok" class="${ctx.BTN}">${ctx.icon("check", "size-3")} That's it</button>
      <button data-say="job change" class="${ctx.BTN2} !w-auto shrink-0 px-4">Change</button></div>`
    : mine && id === "ontology" ? `
    <div class="mt-3 flex gap-2"><button data-say="rules ok" class="${ctx.BTN}">${ctx.icon("check", "size-3")} Looks right</button>
      <button data-say="rules change" class="${ctx.BTN2} !w-auto shrink-0 px-4">Change</button></div>`
    : mine && id === "integrations" ? `<button data-say="integrations ok" class="${ctx.BTN} mt-3">Use these</button>` : "";
  return `
  <div class="${ctx.CARD} mt-3 p-3.5 animate-[fadeSlideUp_0.3s_ease-out_both]">
    <div class="flex items-center justify-between gap-2">
      <p class="${ctx.LABEL}">${st === "active" ? `Now · step ${i + 1} of ${steps.length}` : `Step ${i + 1} · done`}</p>
      ${st === "done" && !b.kept ? `<button data-redo="${id}" class="inline-flex items-center gap-1 text-[11.5px] font-medium text-[#4f5bd5] hover:underline">${ctx.icon("refresh", "size-3")} Redo</button>` : ""}
    </div>
    <p class="mt-1 text-[15px] font-semibold">${label}</p>
    ${tile ? `<div class="mt-2.5">${tile}</div>` : line ? `<p class="mt-1 text-[12px] text-foreground/60">${ctx.esc(line)}</p>` : `<p class="mt-1 text-[12px] text-foreground/45">Working on it in the chat.</p>`}
    ${mine && b.panelAsk ? `<p class="mt-3 text-[13.5px] font-semibold">${ctx.esc(b.panelAsk)}</p>` : ""}
    ${actions}
  </div>`;
}

// The end: keep this version (it goes on the floor, its number starts counting), or redo. Kept: the first task.
function keepArea(ctx, b) {
  if (b.kept) {
    const v = String(b.kept).replace(/^v/, "");
    return `
    <div class="mt-3 flex items-center gap-2.5 rounded-xl border-2 border-[#4f5bd5]/25 bg-[#4f5bd5]/[0.05] px-3 py-2.5">
      <span class="flex size-7 shrink-0 items-center justify-center rounded-full bg-[#4f5bd5] text-white">${ctx.icon("check", "size-4")}</span>
      <p class="min-w-0 flex-1 text-[12.5px] leading-snug"><b>Kept as version ${ctx.esc(v)}</b>${b.launch?.floor ? ` · on ${ctx.esc(b.launch.floor)}` : ""}${b.launch?.next ? ` · first count ${dateShort(b.launch.next)}` : ""}</p>
    </div>
    ${b.firstTask === "asked" ? "" : `<button data-say="first task" class="${ctx.BTN} mt-2">${ctx.icon("play", "size-3")} ${b.launch?.trigger ? "Run it now" : "Give it the first task"}</button>`}
    ${copyCard(ctx)}
    <button data-redo="all" class="mt-2 w-full text-center text-[11.5px] text-foreground/50 hover:text-[#4f5bd5]">Not happy? Make a new version</button>`;
  }
  if (b.step !== "launch" && b.step !== "done") return "";
  return `
  <div class="mt-3 flex gap-2">
    <button data-say="keep" class="${ctx.BTN}">${ctx.icon("check", "size-3")} Keep it</button>
    <button data-redo="all" class="${ctx.BTN2} !w-auto shrink-0 px-4">Redo</button>
  </div>
  <p class="mt-1.5 text-center text-[11px] text-foreground/45">Keep saves version 1, puts it on your floor and starts counting its number.</p>`;
}

// A closed copy on Teamly: asked once, after the first agent is kept, two equal buttons, nothing sent before an answer.
// Then one quiet line: saved, or waiting (Teamly can't take copies yet, or you are not signed in).
function copyCard(ctx) {
  const c = ctx.S.copies ?? {};
  if (c.consent === false) return "";
  if (c.consent === true) {
    const st = c.status === "saved" || (c.sent && !c.queued) ? "saved on Teamly" : c.status === "key" ? "waiting for you to sign in" : c.queued ? "waiting for Teamly" : "on Teamly";
    return `<p class="mt-2 flex items-center justify-center gap-1.5 text-[11.5px] text-foreground/55">${ctx.icon("cloud", "size-3.5")} Backup: ${st} · <button data-copies="no" class="underline hover:text-foreground">Turn off</button></p>`;
  }
  return `
  <div class="mt-3 rounded-lg bg-muted px-3 py-2.5">
    <p class="flex items-center gap-1.5 text-[12.5px] font-semibold">${ctx.icon("cloud", "size-4 text-[#4f5bd5]")} Back it up on Teamly?</p>
    <p class="mt-0.5 text-[11.5px] leading-snug text-foreground/60">Only you see it, and it comes back on a new computer. Settings, files and keys stay here.</p>
    <div class="mt-2 grid grid-cols-2 gap-2">
      <button data-copies="yes" class="rounded-md border-2 border-foreground/15 bg-card py-1.5 text-[12px] font-medium hover:border-[#4f5bd5]/50">Back it up</button>
      <button data-copies="no" class="rounded-md border-2 border-foreground/15 bg-card py-1.5 text-[12px] font-medium hover:border-[#4f5bd5]/50">Only on this computer</button>
    </div>
  </div>`;
}

// The agent as it will be at work. While it is being built, folded to one line; ready, open.
function agentCard(ctx, b, done) {
  const l = ctx.local("build");
  const open = l.look ?? done;
  if (open) return `${agentPreview(ctx, b)}${done ? "" : `<button data-look class="mt-1.5 w-full text-center text-[11.5px] text-foreground/50 hover:text-[#4f5bd5]">Hide</button>`}`;
  return `
  <button data-look class="${ctx.CARD} mt-3 flex w-full items-center gap-2.5 p-3 text-left hover:border-[#4f5bd5]/40">
    ${agentLook(ctx, b, "size-8")}
    <span class="min-w-0 flex-1"><span class="block text-[13px] font-semibold">What it will be like</span><span class="block truncate text-[11.5px] text-foreground/50">${ctx.esc([b.preview?.rhythm, b.job?.gets].filter(Boolean).join(" · ") || "Fills in as the steps go")}</span></span>
    ${ctx.icon("chevronRight", "size-4 shrink-0 text-foreground/35")}
  </button>`;
}

const REDO = {
  job: ["Not the job I meant", "Too broad", "Too narrow"],
  metric: ["Wrong number", "I can't count that", "The start is wrong"],
  research: ["It missed good sources", "Wrong direction"],
  ontology: ["The plan is wrong", "A rule is missing", "It asks me too often", "It does too much on its own"],
  integrations: ["Too expensive", "I don't need a paid tool", "I need another tool"],
  test: ["It didn't do the job", "The result looks wrong", "It did something I didn't want"],
  launch: ["Wrong floor", "Wrong schedule"],
  all: ["Start over from the job", "It doesn't do the job well", "Too slow"],
};
function redoSheet(ctx, b, step) {
  const label = step === "all" ? "the agent" : (STEPS.find(([id]) => id === step)?.[1] ?? step).toLowerCase();
  ctx.openSheet(`
    <p class="text-[15px] font-semibold">Redo ${ctx.esc(label)}</p>
    <p class="mt-1 text-[12px] text-foreground/55">What is wrong? The version before stays, you can go back.</p>
    <div class="mt-3 flex flex-col gap-1.5">
      ${(REDO[step] ?? REDO.all).map((r) => `<button data-redo-reason="${ctx.esc(r)}" class="rounded-lg border-2 border-foreground/12 px-3 py-2.5 text-left text-[13px] hover:border-[#4f5bd5]/40">${ctx.esc(r)}</button>`).join("")}
      <button data-redo-reason="" class="mt-1 text-[12px] font-medium text-[#4f5bd5]">Something else: I'll say it in the chat</button>
    </div>`, (sheet) => sheet.querySelectorAll("[data-redo-reason]").forEach((el) => {
    el.onclick = () => { ctx.closeSheet(); say(ctx, b, `redo ${step}${el.dataset.redoReason ? `: ${el.dataset.redoReason}` : ""}`); };
  }));
}

// A button's words go to the chat that builds this agent: straight in when it listens, otherwise copied.
async function say(ctx, b, what) {
  const prompt = `Teamly: build ${b.slug} ${what}`;
  const here = !b.chat || b.chat === ctx.A.hostChat;
  if (await ctx.sendPrompt(prompt, b.chat || ctx.A.hostChat, { name: "the builder" })) return true;
  try { await navigator.clipboard.writeText(prompt); } catch { /* blocked: the toast shows the words */ }
  ctx.toast(here ? "Copied. Paste it in the chat on the left" : "Copied. Paste it in the chat that builds this agent");
  return false;
}

export function render(ctx) {
  const b = buildOf(ctx);
  const l = ctx.local("build");
  // Build was pressed and the chat is asking the first question: show step 1 waiting, not "nothing is being built"
  if (!b && Date.now() - (Number(ctx.ui.buildAsked) || 0) < 30 * 60 * 1000) {
    return `
    <div class="px-4 pb-24 pt-4">
      <button data-back class="${ctx.PX} inline-flex items-center gap-1 text-[7px] text-[#4f5bd5]">${ctx.icon("arrowLeft", "size-3")} Library</button>
      <div class="mt-3 flex items-center gap-3">
        <div class="flex size-16 shrink-0 items-end justify-center rounded-lg bg-muted"><img src="./assets/agents/create-agent-silhouette.png" alt="" class="size-14 object-contain" /></div>
        <div class="min-w-0"><p class="${ctx.LABEL}">Building your agent</p><p class="mt-1 text-[17px] font-semibold leading-tight">Your new agent</p></div>
      </div>
      ${track(ctx, { slug: "new" }, STEPS, { at: 0, of: STEPS.length, label: STEPS[0][1] }, false, "job")}
      ${askBar(ctx, { ask: "What should run without you? Tell me about the last time you did it yourself" })}
    </div>`;
  }
  if (!b) {
    return `
    <div class="px-4 pb-24 pt-10 text-center">
      <img src="./assets/agents/create-agent-silhouette.png" alt="" class="mx-auto size-20 object-contain" />
      <p class="mt-3 text-[15px] font-semibold">No agent is being built</p>
      <p class="mx-auto mt-1 max-w-xs text-[12.5px] leading-snug text-muted-foreground">An agent does a job without you: a dashboard, replies, reports. You watch it being built here.</p>
      <button data-build-new class="${ctx.BTN} mx-auto mt-4 !w-auto px-6">Build your own agent</button>
    </div>`;
  }
  const steps = stepsOf(b);
  const p = progress(b);
  const done = b.step === "done";
  if (l.slug !== b.slug) Object.assign(l, { slug: b.slug, open: null, look: null });
  const at = done ? steps.length - 1 : p.at;
  const shown = l.open && steps.some(([id]) => id === l.open) ? l.open : steps[at]?.[0];
  return `
  <div class="px-4 pb-24 pt-4">
    <div class="flex items-center justify-between gap-2">
      <button data-back class="${ctx.PX} inline-flex items-center gap-1 text-[7px] text-[#4f5bd5]">${ctx.icon("arrowLeft", "size-3")} Library</button>
      <p class="text-[11px] text-foreground/45">${b.kept ? `Version ${ctx.esc(String(b.kept).replace(/^v/, ""))}` : ""}</p>
    </div>
    <div class="mt-3 flex items-center gap-3">
      <div class="flex size-16 shrink-0 items-end justify-center rounded-lg bg-muted">${agentLook(ctx, b, "size-16", { work: !done })}</div>
      <div class="min-w-0">
        <p class="${ctx.LABEL}">${done ? "Agent ready" : b.path === "fast" ? "Setting up your agent" : b.path === "fork" ? "Building your version" : "Building your agent"}</p>
        <p class="mt-1 text-[17px] font-semibold leading-tight">${ctx.esc(b.name ?? b.slug)}</p>
        ${b.role && !(b.job?.outcome && shown === "job") ? `<p class="mt-0.5 line-clamp-2 text-[12px] leading-snug text-foreground/55">${ctx.esc(b.role)}</p>` : ""}
      </div>
    </div>
    ${track(ctx, b, steps, p, done, shown)}
    <p class="mt-1.5 text-center text-[12.5px] text-foreground/65">${done ? `Ready${b.launch?.floor ? ` · ${ctx.esc(b.launch.floor)} floor` : ""}${b.launch?.trigger ? ` · ${ctx.esc(String(b.launch.trigger).toLowerCase())}` : ""}`
      : `Step ${p.at + 1} of ${p.of} · <b class="font-semibold text-foreground">${ctx.esc(p.label)}</b>${b.eta ? ` · ${ctx.esc(b.eta)} left` : ""}`}</p>
    ${actBar(ctx, b, p)}
    ${stepCard(ctx, b, steps, p, done, shown)}
    ${keepArea(ctx, b)}
    ${agentCard(ctx, b, done)}
    ${(ctx.S.builds ?? []).length > 1 ? `
    <p class="${ctx.LABEL} mt-6">Other agents</p>
    <div class="mt-2 flex flex-col gap-2">${(ctx.S.builds ?? []).filter((x) => x.slug !== b.slug).slice(0, 4).map((x) => buildCard(ctx, x)).join("")}</div>` : ""}
  </div>`;
}

export function mount(root, ctx) {
  const l = ctx.local("build");
  root.querySelectorAll("[data-back]").forEach((el) => { el.onclick = () => ctx.go("library"); });
  root.querySelectorAll("[data-step]").forEach((el) => { el.onclick = () => { l.open = l.open === el.dataset.step ? null : el.dataset.step; ctx.rerender(); }; });
  root.querySelector("[data-finds]")?.addEventListener("click", () => { l.finds = !l.finds; ctx.rerender(); });
  root.querySelector("[data-how]")?.addEventListener("click", () => { l.how = !l.how; ctx.rerender(); });
  root.querySelectorAll("[data-look]").forEach((el) => { el.onclick = () => { const b = buildOf(ctx); l.look = !(l.look ?? b?.step === "done"); ctx.rerender(); }; });
  const b = buildOf(ctx);
  root.querySelectorAll("[data-say]").forEach((el) => { el.onclick = () => b && say(ctx, b, el.dataset.say); });
  root.querySelectorAll("[data-redo]").forEach((el) => { el.onclick = () => b && redoSheet(ctx, b, el.dataset.redo); });
  root.querySelectorAll("[data-pick]").forEach((el) => {
    el.onclick = () => { if (!b) return; const [n, v] = el.dataset.pick.split(":"); const picks = pickOf(ctx, b); picks[n] = picks[n] === v ? undefined : v; ctx.rerender(); };
  });
  root.querySelector("[data-rules]")?.addEventListener("click", () => { l.rules = !l.rules; ctx.rerender(); });
  root.querySelector("[data-checks]")?.addEventListener("click", () => { l.checks = !l.checks; ctx.rerender(); });
  root.querySelectorAll("[data-copies]").forEach((el) => {
    el.onclick = () => ctx.A.live.copies(el.dataset.copies === "yes")
      .then((c) => { ctx.S.copies = c; ctx.toast(c.consent ? "Backed up on Teamly as soon as it can take it" : "Your agents stay only on this computer"); ctx.rerender(); })
      .catch(() => ctx.toast("Couldn't save that"));
  });
  root.querySelectorAll("[data-tick]").forEach((el) => {
    el.onclick = () => { if (!b) return; const [n, i, v] = el.dataset.tick.split(":"); const t = tickOf(ctx, b); const k = `${n}:${i}`; t[k] = t[k] === (v === "y") ? undefined : v === "y"; ctx.rerender(); };
  });
  root.querySelectorAll("[data-send-checks]").forEach((el) => {
    el.onclick = () => {
      if (!b) return;
      const n = el.dataset.sendChecks, t = tickOf(ctx, b);
      const r = arr(b.test?.runs).find((x) => String(x?.n) === n);
      const words = arr(r?.checks).map((c, i) => (c?.pass === true ? "y" : c?.pass === false ? "n" : t[`${n}:${i}`] === true ? "y" : t[`${n}:${i}`] === false ? "n" : null));
      if (words.some((w) => w === null)) return;
      say(ctx, b, `checks ${n} ${words.map((w, i) => `${i + 1}${w}`).join(" ")}`);
    };
  });
  root.querySelector("[data-test-chat]")?.addEventListener("click", () => {
    const s = b?.test?.session;
    if (s) ctx.A.live.openChat(s).then((r) => ctx.toast(r?.here ? "The test chat is this one" : "Opening the test chat")).catch(() => ctx.toast("Open the test chat from the sidebar"));
  });
  root.querySelectorAll("[data-shot]").forEach((el) => {
    el.onclick = () => ctx.openSheet(`<img src="${ctx.A.live.fileUrl(el.dataset.shot)}" alt="" class="w-full rounded-lg border-2 border-foreground/10" />`);
  });
  root.querySelector("[data-send-picks]")?.addEventListener("click", () => {
    if (!b) return;
    const picks = pickOf(ctx, b);
    const n = arr(b.test?.pairs).map((x, i) => x.n ?? i + 1);
    if (n.some((k) => !picks[k])) return;
    say(ctx, b, `picks ${n.map((k) => `${k}${picks[k]}`).join(" ")}`);
  });
  root.querySelector("[data-top-up]")?.addEventListener("click", () => ctx.A.live.openUrl("topup").then(() => ctx.toast("Top up on the site, then come back: the balance updates by itself")).catch(() => ctx.toast("Couldn't open the site")));
  root.querySelector("[data-sign-in]")?.addEventListener("click", () => ctx.A.live.openUrl("key").then(() => ctx.toast("Sign in on the site: the key comes back here by itself")).catch(() => ctx.toast("Couldn't open the site")));
  root.querySelector("[data-build-new]")?.addEventListener("click", async () => {
    if (await ctx.sendPrompt("Teamly: build agent")) { ctx.ui.buildAsked = Date.now(); ctx.saveUI(); ctx.rerender(); return; }
    try { await navigator.clipboard.writeText("Teamly: build agent"); } catch { /* blocked */ }
    ctx.toast("Copied. Paste it in the chat on the left");
  });
  const stops = [...root.querySelectorAll("[data-look-working]")].map((el) => startWorking(el));
  root.querySelectorAll("[data-open-build]").forEach((el) => { el.onclick = () => { ctx.ui.buildRef = el.dataset.openBuild; ctx.saveUI(); ctx.rerender(); }; });
  root.querySelector("[data-open-agent]")?.addEventListener("click", (e) => {
    const bb = buildOf(ctx);
    ctx.ui.agentRef = { team: bb.team, slug: e.currentTarget.dataset.openAgent };
    ctx.ui.teamSlug = bb.team;
    ctx.saveUI();
    ctx.go("agent");
  });
  return () => stops.forEach((stop) => stop());
}
