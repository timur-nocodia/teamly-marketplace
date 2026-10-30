// LIBRARY: built for hundreds of agents. Search, then COLLECTIONS (Top rated, Best this week, Tested vs Claude, New)
// and FLOORS (Content, Fundraising…) as sections: each shows its best 4 and "See all N"; opened, the full list,
// 30 at a time. A card shows what you need to choose: stars, what it owns, what you get (chips), a bit of a real
// result, proof vs Claude, price, time. Tap → the job description with Hire / Details.
// Hire is not an instant install: it goes to the chat of the floor you pick, where the coordinator makes the agent
// yours in 4 stages (the floor shows them). Stars come from ratings the coordinator asks for after every task.
import { areaOfTeam, floorFor } from "./teams.js";

const AREAS = {
  content: { label: "Content", floor: "floor-content" },
  fundraising: { label: "Fundraising", floor: "floor-fundraising" },
  legal: { label: "Legal", floor: "floor-legal" },
  sales: { label: "Sales", floor: "floor-sales" },
  hiring: { label: "Hiring", floor: "floor-hiring" },
  product: { label: "Product", floor: "floor-product" },
  finance: { label: "Finance", floor: "floor-finance" },
  support: { label: "Support", floor: "floor-support" },
  planning: { label: "Planning", floor: "floor-office" },
  other: { label: "Other", floor: "floor-office" },
};
// Bayesian stars: a 5.0 from 2 people doesn't beat a 4.7 from 300. No ratings yet counts as 4.0, the same rule
// SKILL.md 1.5 uses to pick agents: above the ones proven weak, below the ones proven strong.
const score = (a) => { const n = Number(a.rating?.count) || 0; return ((Number(a.rating?.avg) || 0) * n + 4 * 5) / (n + 5); };
const winRate = (a) => { const m = /(\d+)\s*\/\s*(\d+)/.exec(a.evalWin ?? ""); return m ? Number(m[1]) / Number(m[2]) : 0; };
const best = (x, y) => score(y) - score(x) || winRate(y) - winRate(x) || (y.results ?? 0) - (x.results ?? 0);
const COLLECTIONS = [
  { id: "top", label: "Top rated", sub: "Most stars from people who used them", floor: "floor-top", icon: "★",
    pick: (l) => l.filter((a) => a.rating?.count).sort(best) },
  { id: "week", label: "Best this week", sub: "Most results in the last 7 days", floor: "floor-week", icon: "↑",
    pick: (l) => l.filter((a) => a.week > 0).sort((x, y) => y.week - x.week || best(x, y)) },
  { id: "tested", label: "Tested vs Claude", sub: "Beat plain Claude on blind tests", floor: "floor-tested", icon: "✓",
    pick: (l) => l.filter((a) => a.evalWin).sort((x, y) => winRate(y) - winRate(x) || best(x, y)) },
  { id: "new", label: "New", sub: "Added in the last 2 weeks", floor: "floor-new", icon: "+",
    pick: (l) => { const since = new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 10); return l.filter((a) => String(a.updatedAt ?? "") >= since).sort((x, y) => String(y.updatedAt).localeCompare(String(x.updatedAt))); } },
];
const PAGE = 30;
const SHELF = 4; // agents per section on the overview; the rest behind "See all"
const areaOf = (a) => { const x = a.area === "fundraise" ? "fundraising" : a.area; return AREAS[x] ? x : "other"; };

function ui(ctx) {
  const l = ctx.local("library");
  l.area ??= "all";
  l.q ??= "";
  l.limit ??= PAGE;
  return l;
}

const chipsOf = (get) => get.split(/,\s*|\s+and\s+|\s+with\s+/i).map((x) => x.trim()).filter(Boolean).slice(0, 3).map((x) => x.charAt(0).toUpperCase() + x.slice(1));

// ---------------------------------------------------------------- helpers
// The services an agent is connected to, as chips; optional ones dashed. Prices aren't shown: they're known only after a call.
function integrationChips(ctx, a, max = 3) {
  const list = ctx.A.integrationsOf(a);
  const chip = (x) => `<span class="rounded ${x.optional ? "border border-dashed border-foreground/20 text-foreground/45" : "bg-muted text-foreground/60"} px-1.5 py-0.5"${x.optional ? ' title="Optional: only when you ask"' : ""}>${ctx.esc(x.name)}</span>`;
  return list.slice(0, max).map(chip).join("") + (list.length > max ? `<span class="text-foreground/40">+${list.length - max}</span>` : "");
}
const owns = (a) => a.job?.owns ?? a.role ?? "";
const macOnly = (a) => (a.runtime?.os ?? []).length === 1 && a.runtime.os[0] === "mac";
const deliverables = (a) => a.job?.deliverables ?? (a.job?.get ? chipsOf(a.job.get) : []);

function stars(ctx, a, size = "text-[12px]") {
  if (!a.rating?.count) return `<span class="${size} text-foreground/40">No ratings yet</span>`;
  const pct = Math.max(0, Math.min(100, (a.rating.avg / 5) * 100));
  return `
  <span class="inline-flex items-center gap-1.5 ${size}">
    <span class="relative inline-block leading-none tracking-[1px]" aria-label="${a.rating.avg} out of 5">
      <span class="text-foreground/15">★★★★★</span>
      <span class="absolute inset-y-0 left-0 overflow-hidden whitespace-nowrap text-amber-400" style="width:${pct}%">★★★★★</span>
    </span>
    <span class="font-semibold">${a.rating.avg.toFixed(1)}</span><span class="text-foreground/45">(${a.rating.count})</span>
  </span>`;
}

// Ratings the library didn't take (server.py send_ratings): their stars are counted into what this screen shows, so
// without this line nobody would learn they never left this computer.
function syncNote(ctx) {
  const s = ctx.S.librarySync;
  if (!s || !(Number(s.pending) > 0)) return "";
  const n = Number(s.pending);
  const what = `${n} rating${n === 1 ? "" : "s"} you gave ${n === 1 ? "is" : "are"} still only on this computer`;
  const why = Number(s.code) === 0 ? "the Teamly library can't be reached" : `the Teamly library answered ${ctx.esc(String(s.code))}`;
  return `<p data-library-sync class="mt-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[12px] leading-snug text-foreground/80">${what}: ${why}. Your stars count in what you see here, not yet for anyone else. Teamly tries again every 2 minutes.</p>`;
}

function pool(ctx) {
  return ctx.A.AGENTS.filter((a) => !a.replacedBy);
}
const myAreas = (ctx) => [...new Set((ctx.S.teams ?? []).map(areaOfTeam).filter(Boolean))];
// "On your floor" = a floor of your office has this agent (or your version of it), not a file copied somewhere.
const onFloor = (ctx, slug) => (ctx.S.teams ?? []).some((t) => (t.agents ?? []).some((x) => x.slug === slug || x.upstream === slug || x.card?.upstream === slug));
function searched(ctx, l) {
  const words = l.q.toLowerCase().split(/\s+/).filter(Boolean);
  const list = pool(ctx);
  if (!words.length) return list;
  return list.filter((a) => {
    const hay = [a.name, owns(a), a.job?.give, a.job?.get, ...deliverables(a), a.role, a.author, AREAS[areaOf(a)].label, ...(a.tags ?? [])].join(" ").toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

// ---------------------------------------------------------------- card
function card(ctx, a) {
  const hired = onFloor(ctx, a.slug);
  const example = Array.isArray(a.example) ? a.example.find((x) => x && x !== "video") : null;
  return `
  <button data-agent-row="${ctx.esc(a.slug)}" class="flex h-full w-full flex-col rounded-xl border-2 border-foreground/10 bg-card p-3 text-left transition hover:border-[#4f5bd5]/40 hover:shadow-[2px_2px_0_0_rgba(79,91,213,.25)]">
    <span class="flex w-full items-start gap-2.5">
      <img src="./assets/agents/${a.sprite}.png" alt="" loading="lazy" class="size-11 shrink-0 object-contain" />
      <span class="min-w-0 flex-1">
        <span class="flex flex-wrap items-center gap-1.5">
          <span class="text-[14px] font-semibold leading-tight">${ctx.esc(a.name)}</span>
          ${hired ? `<span class="rounded bg-[#4f5bd5]/10 px-1 text-[9.5px] font-semibold text-[#4f5bd5]">on your floor</span>` : ""}
        </span>
        <span class="mt-0.5 block">${stars(ctx, a, "text-[11.5px]")}</span>
        <span class="mt-1 block text-[12.5px] leading-snug text-foreground/75">${ctx.esc(owns(a))}</span>
        <span class="mt-0.5 block truncate text-[10.5px] text-foreground/40">by ${ctx.esc(a.author)}</span>
      </span>
    </span>
    ${example ? `<span class="mt-2 block truncate px-0.5 text-[11.5px] italic text-foreground/50">“${ctx.esc(example)}”</span>` : ""}
    <span class="mt-auto flex w-full flex-wrap items-center gap-x-2 gap-y-1 pt-2.5 text-[11px] text-foreground/55">
      ${a.evalWin ? `<span class="rounded bg-emerald-50 px-1.5 py-0.5 font-semibold text-emerald-700">✓ beats Claude ${ctx.esc(a.evalWin)}</span>` : ""}
      ${macOnly(a) ? `<span title="${ctx.esc(a.runtime?.why || "Works only on a Mac")}" class="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-foreground/55">${ctx.icon("laptop", "size-3")}Mac only</span>` : ""}
      ${integrationChips(ctx, a)}
      <span class="ml-auto">${a.results ? `${a.results} got it` : "new"}</span>
    </span>
  </button>`;
}
const grid = (ctx, list) => `<div class="grid grid-cols-1 gap-2.5 min-[560px]:grid-cols-2">${list.map((a) => card(ctx, a)).join("")}</div>`;

// Section headers look the same for collections and floors: the picture of that floor of the office, the name on it.
const sectionHeader = (ctx, { label, sub, floor }, more) => `
  <div class="relative mb-2.5 mt-6 h-[68px] overflow-hidden rounded-xl border-2 border-foreground/10">
    <img src="./assets/building/${floor}.webp" alt="" class="absolute inset-0 size-full object-cover" />
    <div class="absolute inset-0 bg-gradient-to-r from-white/90 via-white/40 to-white/70"></div>
    <div class="absolute left-3 top-1/2 -translate-y-1/2">
      <p class="${ctx.PX} text-[10px]">${label}</p>
      <p class="mt-1 text-[11px] text-foreground/60">${sub}</p>
    </div>
    ${more ? `<button data-area="${more.id}" class="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg border-2 border-foreground/15 bg-white/95 px-2.5 py-1.5 text-[12px] font-medium text-[#4f5bd5] hover:border-[#4f5bd5]/50">See all ${more.n} ›</button>` : ""}
  </div>`;
const collectionHeader = (ctx, c, n, more) => sectionHeader(ctx, { label: c.label, sub: `${c.sub} · ${n}`, floor: c.floor }, more && { id: c.id, n });
const floorHeader = (ctx, key, n, more) => sectionHeader(ctx, { label: AREAS[key].label, sub: `${n} ${n === 1 ? "agent" : "agents"} for this floor`, floor: AREAS[key].floor }, more && { id: key, n });
const moreBtn = (left) => left > 0 ? `<button data-more class="mt-3 w-full rounded-lg border-2 border-foreground/10 py-2.5 text-[12px] font-medium text-foreground/65 hover:border-foreground/25">Show ${Math.min(PAGE, left)} more · ${left} left</button>` : "";

function feed(ctx, l) {
  const list = searched(ctx, l);
  if (!list.length) return `<p class="py-10 text-center text-[13px] text-foreground/50">No agent for “${ctx.esc(l.q)}” yet.<br/><span class="text-[12px]">The coordinator can build one for you in the chat.</span></p>`;
  const col = COLLECTIONS.find((c) => c.id === l.area);
  if (col) {
    const all = col.pick(list);
    return `${collectionHeader(ctx, col, all.length, false)}${all.length ? grid(ctx, all.slice(0, l.limit)) : `<p class="py-6 text-center text-[12.5px] text-foreground/50">Nothing here yet — stars and weekly results appear as people rate tasks.</p>`}${moreBtn(all.length - l.limit)}`;
  }
  const groups = {};
  for (const a of list) (groups[areaOf(a)] ??= []).push(a);
  const floors = (l.area === "mine" ? myAreas(ctx) : Object.keys(groups)).filter((k) => groups[k]?.length).sort((x, y) => groups[y].length - groups[x].length);
  if (AREAS[l.area]) {
    const all = (groups[l.area] ?? []).sort(best);
    return `${floorHeader(ctx, l.area, all.length, false)}${grid(ctx, all.slice(0, l.limit))}${moreBtn(all.length - l.limit)}`;
  }
  // overview: collections first (how good), then floors (what for); a search shows every match by floor
  const searching = !!l.q.trim();
  const shelves = searching || l.area === "mine" ? "" : COLLECTIONS.map((c) => {
    const all = c.pick(list);
    return all.length ? `${collectionHeader(ctx, c, all.length, all.length > SHELF)}${grid(ctx, all.slice(0, SHELF))}` : "";
  }).join("");
  return shelves + floors.map((k) => {
    const all = groups[k].sort(best);
    return `${floorHeader(ctx, k, all.length, !searching && all.length > SHELF)}${grid(ctx, searching ? all : all.slice(0, SHELF))}`;
  }).join("");
}
const countLine = (ctx, l) => { const n = searched(ctx, l).length; return `${n} ${n === 1 ? "agent" : "agents"}`; };

// ---------------------------------------------------------------- the job description (tap a card)
function jobSheet(ctx, a) {
  const j = a.job ?? { owns: a.role, give: a.needs, steps: [], get: a.outcome, not: "" };
  const connected = ctx.A.integrationsOf(a);
  return `
  <div class="flex items-center gap-3 pt-2">
    <img src="./assets/agents/${a.sprite}.png" alt="" class="size-14 object-contain" />
    <div class="min-w-0 flex-1">
      <p class="text-[16px] font-semibold leading-tight">${ctx.esc(a.name)}</p>
      <p class="mt-0.5">${stars(ctx, a)}</p>
      <p class="mt-0.5 text-[11px] text-foreground/50">${AREAS[areaOf(a)].label} · by ${ctx.esc(a.author)}</p>
    </div>
  </div>
  <p class="mt-3 text-[14px] leading-snug"><span class="${ctx.PX} mr-1 text-[7px] text-[#4f5bd5]">Owns</span>${ctx.esc(j.owns)}</p>
  <div class="mt-3 flex flex-col gap-1.5">
    <div class="rounded-lg bg-muted px-3 py-2"><p class="${ctx.LABEL}">You give</p><p class="mt-1 text-[13px]">${ctx.esc(j.give)}</p></div>
    <div class="rounded-lg border-2 border-[#4f5bd5]/20 bg-[#4f5bd5]/[0.04] px-3 py-2"><p class="${ctx.PX} text-[7px] text-[#4f5bd5]">It does</p>
      <ol class="mt-1 flex flex-col gap-1 text-[13px]">${(j.steps ?? []).map((x, i) => `<li class="flex gap-2"><span class="mt-[1px] flex size-4 shrink-0 items-center justify-center rounded bg-[#4f5bd5]/15 text-[9px] font-bold text-[#4f5bd5]">${i + 1}</span>${ctx.esc(x)}</li>`).join("")}</ol></div>
    <div class="rounded-lg border-2 border-foreground/10 px-3 py-2"><p class="${ctx.LABEL}">You get</p><p class="mt-1 text-[13px] font-medium">${ctx.esc(j.get)}</p></div>
  </div>
  ${j.not ? `<p class="mt-2 text-[12px] text-foreground/50">Not its job: ${ctx.esc(j.not.charAt(0).toLowerCase() + j.not.slice(1))}</p>` : ""}
  ${connected.length ? `<p class="mt-2 text-[12px] text-foreground/60"><span class="${ctx.PX} mr-1 text-[7px] text-foreground/45">Connected</span>${connected.map((x) => `${ctx.esc(x.name)}${x.optional ? ' <span class="text-foreground/40">(optional)</span>' : ""}`).join(" · ")}</p>` : ""}
  ${whereLine(ctx, a)}
  <p class="mt-2 text-[11px] text-foreground/45">${a.results ? `${a.results} people got the result` : "New — nobody has rated it yet"}${a.evalWin ? ` · beats plain Claude ${ctx.esc(a.evalWin)}` : ""}</p>
  <div class="mt-4 flex gap-2">
    <button data-sheet-hire class="${ctx.PX} flex-1 rounded-lg bg-[#4f5bd5] py-3 text-[8px] text-white hover:bg-[#3f4bc5]">Hire ${ctx.esc(a.name)}</button>
    <button data-sheet-details class="${ctx.PX} shrink-0 rounded-lg border-2 border-foreground/15 px-3 py-3 text-[8px] text-foreground/65">Details</button>
  </div>`;
}

// Where the agent works: on your computer, in its own chat (the cloud stays out until it has been tested).
function whereLine(ctx, a) {
  const rt = a.runtime ?? {};
  return `<p class="mt-2 flex items-center gap-1.5 text-[12px] text-foreground/60">${ctx.icon("laptop", "size-3.5")} ${macOnly(a) ? "Only on a Mac" : "On your computer"}${rt.why ? ` — ${ctx.esc(rt.why.charAt(0).toLowerCase() + rt.why.slice(1))}` : ""}</p>`;
}

// ---------------------------------------------------------------- hire: onto a floor, through that floor's chat
const HIRE_STAGES = [
  ["Make it yours", "The coordinator copies the agent onto the floor and asks you 1–3 questions (your voice, platform, language)."],
  ["Install", "Your version goes into Claude Code as an agent of this floor."],
  ["Desk and chat", "The agent gets its own chat, reads what it knows and answers “ready”."],
  ["On the floor", "It appears on the floor with the others. Give it a task in the floor's chat."],
];
function hireSheet(ctx, a) {
  const teams = ctx.S.teams ?? [];
  if (!teams.length) {
    return ctx.openSheet(`
      <p class="text-[15px] font-semibold">Hire ${ctx.esc(a.name)}</p>
      <p class="mt-2 text-[13px] text-foreground/70">Agents work on a floor of your office — a team for one area. Build your first floor, then hire ${ctx.esc(a.name)} onto it.</p>
      <button data-go-office class="${ctx.BTN} mt-4">Go to the office</button>`, (s) => { s.querySelector("[data-go-office]").onclick = () => { ctx.closeSheet(); ctx.go("teams"); }; });
  }
  const want = areaOf(a);
  // a floor that already has this agent comes last and is never picked for you: hiring it there makes a second one
  const has = (t) => (t.agents ?? []).some((x) => x.slug === a.slug || x.upstream === a.slug || x.upstream?.slug === a.slug);
  const sorted = [...teams].sort((x, y) => (has(x) - has(y)) || ((areaOfTeam(y) === want) - (areaOfTeam(x) === want)));
  let pick = sorted[0].slug;
  const draw = () => `
    <div class="flex items-center gap-3 pt-2">
      <img src="./assets/agents/${a.sprite}.png" alt="" class="size-12 object-contain" />
      <div><p class="text-[15px] font-semibold">Hire ${ctx.esc(a.name)}</p><p class="text-[11.5px] text-foreground/55">Which floor does it join?</p></div>
    </div>
    <div class="mt-3 flex flex-col gap-1.5">
      ${sorted.map((t) => `
      <button data-floor="${ctx.esc(t.slug)}" class="relative flex h-14 items-center overflow-hidden rounded-xl border-2 text-left ${t.slug === pick ? "border-[#4f5bd5]" : "border-foreground/10"}">
        <img src="./assets/building/${floorFor(`${t.area ?? ""} ${t.name ?? ""}`)}.webp" alt="" class="absolute inset-0 size-full object-cover opacity-60" />
        <span class="absolute inset-0 bg-gradient-to-r from-white/95 via-white/60 to-transparent"></span>
        <span class="relative pl-3"><span class="${ctx.PX} block text-[8px]">${ctx.esc(t.name)}</span><span class="mt-0.5 block text-[11px] ${has(t) ? "font-medium text-amber-700" : "text-foreground/55"}">${has(t) ? `already has ${ctx.esc(a.name)}: this adds a second one` : `${(t.agents ?? []).length} agents${areaOfTeam(t) === want ? " · fits this agent" : ""}`}</span></span>
        ${t.slug === pick ? `<span class="relative ml-auto mr-3 flex size-5 items-center justify-center rounded-full bg-[#4f5bd5] text-white">${ctx.icon("check", "size-3")}</span>` : ""}
      </button>`).join("")}
    </div>
    <p class="${ctx.LABEL} mt-4">What happens in the floor's chat · ~3–5 min</p>
    <ol class="mt-2 flex flex-col gap-1.5">
      ${HIRE_STAGES.map(([t, d], i) => `<li class="flex gap-2.5"><span class="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-[#4f5bd5]/12 text-[10px] font-bold text-[#4f5bd5]">${i + 1}</span><span class="text-[12.5px] leading-snug"><b>${t}.</b> <span class="text-foreground/65">${d}</span></span></li>`).join("")}
    </ol>
    <div class="mt-3 rounded-lg bg-muted px-3 py-2 font-mono text-[11.5px]">Teamly: hire ${ctx.esc(a.slug)} → ${ctx.esc(pick)}${has(teams.find((x) => x.slug === pick) ?? {}) ? " (a second one)" : ""}</div>
    <button data-hire-go class="${ctx.BTN} mt-3">${ctx.icon("copy", "size-3")} Copy &amp; open ${ctx.esc(sorted.find((t) => t.slug === pick).name)}'s chat</button>
    <p class="mt-2 text-center text-[11px] text-foreground/45">Paste it in the chat. The floor shows each stage while it happens.</p>`;
  ctx.openSheet(draw(), function bind(sheet) {
    sheet.querySelectorAll("[data-floor]").forEach((b) => { b.onclick = () => { pick = b.dataset.floor; ctx.openSheet(draw(), bind); }; });
    sheet.querySelector("[data-hire-go]").onclick = async () => {
      const t = teams.find((x) => x.slug === pick);
      const prompt = `Teamly: hire ${a.slug} → ${pick}${has(t ?? {}) ? " (a second one)" : ""}`;
      try { await navigator.clipboard.writeText(prompt); } catch { /* clipboard blocked: the prompt is on screen */ }
      if (t?.coordinator_session) {
        ctx.A.live.openChat(t.coordinator_session)
          .then(() => { ctx.closeSheet(); ctx.toast(`Copied — paste it in ${(t.name)}'s chat`); })
          .catch(() => ctx.toast("Copied — open the floor's chat in the sidebar and paste it"));
      } else { ctx.closeSheet(); ctx.toast("Copied — open the floor's chat in the sidebar and paste it"); }
    };
  });
}

// ---------------------------------------------------------------- screen
export function render(ctx) {
  const l = ui(ctx);
  const all = pool(ctx);
  const counts = {};
  for (const a of all) counts[areaOf(a)] = (counts[areaOf(a)] ?? 0) + 1;
  const mineCount = all.filter((a) => myAreas(ctx).includes(areaOf(a))).length;
  const colChips = COLLECTIONS.map((c) => [c.id, `${c.icon} ${c.label}`, c.pick(all).length]).filter(([, , n]) => n);
  const floorChips = [...(mineCount ? [["mine", "For your floors", mineCount]] : []), ...Object.keys(AREAS).filter((k) => counts[k]).map((k) => [k, AREAS[k].label, counts[k]])];
  if (l.area !== "all" && ![...colChips, ...floorChips].some(([id]) => id === l.area)) l.area = "all";
  const chip = ([id, label, n]) => `<button data-area="${id}" class="flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] ${l.area === id ? "border-[#4f5bd5] bg-[#4f5bd5] text-white" : "border-foreground/12 text-foreground/65 hover:border-foreground/30"}">${label}<span class="text-[10px] opacity-70">${n}</span></button>`;
  return `
  <div class="px-4 pb-16 pt-4">
    <div class="flex items-baseline justify-between gap-2">
      <p class="${ctx.PX} text-[11px]">Library</p>
      <span data-count class="text-[11px] text-foreground/45">${countLine(ctx, l)}</span>
    </div>
    <p class="mt-1.5 text-[12px] text-muted-foreground">Agents built by people who already got the result. Each owns one job — tap one to see what it does.</p>
    ${syncNote(ctx)}
    <button data-install-file class="mt-2 inline-flex items-center gap-1.5 text-[12px] font-medium text-[#4f5bd5] hover:underline">${ctx.icon("folder", "size-3.5")} Got an agent or a team from someone (a file or a link)? Install it</button>
    <label class="mt-3 flex h-10 items-center gap-2 rounded-lg border-2 border-foreground/12 bg-card px-3 focus-within:border-[#4f5bd5]">
      ${ctx.icon("search", "size-4 text-foreground/40")}
      <input data-search value="${ctx.esc(l.q)}" placeholder="Search: “investors”, “reels”, “contract”…" class="w-full bg-transparent text-[13px] outline-none placeholder:text-foreground/35" />
    </label>
    <div class="mt-2.5 flex items-center gap-1.5 overflow-x-auto pb-1">
      ${chip(["all", "All", all.length])}${colChips.map(chip).join("")}
      <span class="mx-1 h-5 w-px shrink-0 bg-foreground/15"></span>
      ${floorChips.map(chip).join("")}
    </div>
    <div data-feed>${feed(ctx, l)}</div>
  </div>`;
}

export function mount(root, ctx) {
  const l = ui(ctx);
  const byslug = () => Object.fromEntries(pool(ctx).map((a) => [a.slug, a]));
  const bindFeed = () => {
    root.querySelectorAll("[data-agent-row]").forEach((b) => {
      b.onclick = () => {
        const a = byslug()[b.dataset.agentRow];
        if (!a) return;
        ctx.openSheet(jobSheet(ctx, a), (sheet) => {
          sheet.querySelector("[data-sheet-hire]")?.addEventListener("click", () => { ctx.closeSheet(); hireSheet(ctx, a); });
          sheet.querySelector("[data-sheet-details]")?.addEventListener("click", () => { ctx.closeSheet(); ctx.ui.agentRef = { library: a.slug }; ctx.saveUI(); ctx.go("agent"); });
        });
      };
    });
    root.querySelector("[data-more]")?.addEventListener("click", () => { l.limit += PAGE; refreshFeed(); });
    root.querySelectorAll("[data-feed] [data-area]").forEach((b) => { b.onclick = () => openArea(b.dataset.area); });
  };
  // a section opens from the top of its list
  const openArea = (id) => { l.area = id; l.limit = PAGE; ctx.rerender(); root.scrollTop = 0; };
  // typing redraws only the feed, so the search field keeps focus
  const refreshFeed = () => {
    root.querySelector("[data-feed]").innerHTML = feed(ctx, l);
    root.querySelector("[data-count]").textContent = countLine(ctx, l);
    bindFeed();
  };
  root.querySelector("[data-search]")?.addEventListener("input", (e) => { l.q = e.target.value; l.limit = PAGE; refreshFeed(); });
  // sharing without a portal: the coordinator finds the archive, checks it and asks before it goes on a floor
  root.querySelector("[data-install-file]")?.addEventListener("click", () => ctx.sendToCoordinator(ctx, "Teamly: install from file or link"));
  root.querySelectorAll("[data-area]").forEach((b) => { b.onclick = () => openArea(b.dataset.area); });
  bindFeed();
}
