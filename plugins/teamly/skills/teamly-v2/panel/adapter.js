// The ONE place the panel gets data from.
// LIVE  = server.py on this computer: key status, installed agents, teams, active task, step files, ratings, edits.
// MOCK  = everything the Teamly platform will give later: library cards, ready teams, wallet/credits, demo run.
// To go live with the platform, replace the MOCK section with calls to the Teamly API; screens don't change.

// ---------------------------------------------------------------- LIVE
async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { "Content-Type": "application/json", "X-Teamly-Panel": "1", ...(opts.headers ?? {}) },
  });
  const text = await res.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch { if (res.ok) throw new Error("the panel server sent a broken answer"); }
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}
// The chat whose right panel this page is in: the coordinator opens the panel as …/?chat=<its session id>.
// Unknown (null) when the panel was opened another way — then "Open chat" always switches, as before.
export const hostChat = new URLSearchParams(location.search).get("chat") || null;
export const live = {
  state: () => api("/api/state"),
  saveKey: (key) => api("/api/key", { method: "POST", body: JSON.stringify({ key }) }),
  removeKey: () => api("/api/key", { method: "DELETE" }),
  // the Teamly site's top-up or key page, opened by the server in the person's own browser
  openUrl: (which) => api("/api/open-url", { method: "POST", body: JSON.stringify({ which }) }),
  refreshWallet: () => api("/api/wallet/refresh", { method: "POST", body: "{}" }),   // ask Teamly for the balance now
  hire: (slug) => api("/api/hire", { method: "POST", body: JSON.stringify({ slug }) }),
  fire: (slug) => api("/api/fire", { method: "POST", body: JSON.stringify({ slug }) }),
  rate: (rec) => api("/api/rating", { method: "POST", body: JSON.stringify(rec) }),
  saveEdit: (task, file, text) => api("/api/edit", { method: "POST", body: JSON.stringify({ task, file, text }) }),
  openChat: (session) => (session && session === hostChat ? Promise.resolve({ here: true }) : api("/api/open-chat", { method: "POST", body: JSON.stringify({ session }) })),
  newOffice: (name, setup = false) => api("/api/offices", { method: "POST", body: JSON.stringify({ name, setup }) }),
  nextOffice: (office) => api("/api/offices/next", { method: "POST", body: JSON.stringify({ office }) }),
  uiGet: () => api("/api/ui"),
  uiSave: (state) => api("/api/ui", { method: "POST", body: JSON.stringify(state) }),
  uiReset: () => api("/api/ui", { method: "DELETE" }),
  fileUrl: (path) => `/api/file?path=${encodeURIComponent(path)}`,
  fileText: async (path) => {
    const r = await fetch(`/api/file?path=${encodeURIComponent(path)}`);
    if (!r.ok) throw new Error("file not found");
    return r.text();
  },
};

// ---------------------------------------------------------------- MOCK: library
// Card = what you GET, not who the agent is. cost = credits per result (1 credit = $1), spent only on tools.
// installable: true means the agent package exists in teamly-skill-v2/agents/ and the server can install it.
export const AGENTS = [
  {
    slug: "mark", name: "Mark", role: "Content Scout", sprite: "hoodie07", author: "Igor", official: true, installable: true,
    goals: ["content"], dept: "Content",
    outcome: "10 AI reels that blew up in the last 7 days, ranked, each with an idea for your reel.",
    example: ["1. Claude Code “hacked” a TV — 2.4M views", "2. Three free skills → “$10K” websites — 1.15M", "3. Claude replaces an SMM manager — 27K comments"],
    time: "~10 min", cost: 0.4, costFor: "Reels, TikTok and X search (Teamly API)", results: 38,
    needs: "Nothing from you",
    firstTask: "Find 10 reels about AI agents and Claude Code that blew up in the last 7 days.",
    working: ["Searching TikTok for “Claude Code” — 214 reels checked", "Checking views on Instagram Reels — 61 candidates", "Ranking by views per day — top 10 picked"],
  },
  {
    slug: "riley", name: "Riley", role: "Script Writer", sprite: "creative06", author: "Igor", official: true, installable: true,
    goals: ["content"], dept: "Content",
    outcome: "A 90–130 word reel script in your voice: result in the first line, code word at the end.",
    example: ["“Claude Code now removes the ads from your TV in 15 minutes and makes it faster…”", "114 words · hook in line 1 · linter clean"],
    time: "~5 min", cost: 0, costFor: "No tools — free", results: 31,
    needs: "Nothing from you",
    firstTask: "Write a reel script from the top finding.",
    working: ["Reading Mark's top 3", "Writing the hook — draft 2 of 3", "Running the script linter"],
  },
  {
    slug: "james", name: "James", role: "Reels Editor", sprite: "creative05", author: "Igor", official: true, installable: true,
    goals: ["content"], dept: "Content",
    outcome: "A ready 1080×1920 reel: captions, graphics on the words, sound design.",
    example: ["video"],
    time: "~25 min", cost: 2.4, costFor: "Sound effects + cloud render (ElevenLabs, render farm)", results: 22,
    needs: "One take from you (1 min of filming) — or an AI take for 2.0 credits",
    firstTask: "Edit today's reel from the take and the script.",
    working: ["Listening to the take — 0:52", "Captions 12 of 31", "Graphics on the words — 7 of 9", "Sound pass and export"],
  },
  {
    slug: "vega", name: "Vega", role: "X Trend Researcher", sprite: "streetwear13", author: "timur", installable: false,
    goals: ["content"], dept: "Content",
    outcome: "Top 15 posts in your niche on X this week, with why each one worked.",
    example: ["1. “I replaced my agency with 4 agents” — 1.8M", "2. Claude Code + Figma thread — 940K"],
    time: "~8 min", cost: 0.3, costFor: "X search (Teamly API)", results: 12, needs: "Nothing from you",
    firstTask: "Find 15 posts about AI agents that blew up on X this week.",
    working: ["Searching X", "Ranking by engagement"],
  },
  {
    slug: "pia", name: "Pia", role: "Carousel Maker", sprite: "creative01", author: "anna", installable: false,
    goals: ["content"], dept: "Content",
    outcome: "A 7-slide Instagram carousel in your style from any post or link.",
    example: ["Cover + 5 slides + CTA slide", "Ready PNGs 1080×1350"],
    time: "~12 min", cost: 0.8, costFor: "Cover image generation", results: 9, needs: "A link or a topic",
    firstTask: "Make a carousel from the top finding.",
    working: ["Writing slides", "Generating the cover"],
  },
  {
    slug: "judy", name: "Judy", role: "Judging Scout", sprite: "smartcasual01", author: "Igor", installable: false,
    goals: ["legal"], dept: "Legal",
    outcome: "10 hackathons that need judges, with outreach drafts to the organizers.",
    example: ["ETHGlobal SF — judges open till Nov 3", "AI Engineer Summit hackathon — form link"],
    time: "~15 min", cost: 0.5, costFor: "Web search + page reading", results: 3, needs: "Your bio (once)",
    firstTask: "Find 10 hackathons in Nov–Dec that need judges.",
    working: ["Searching hackathon calendars", "Checking judge applications"],
  },
  {
    slug: "owen", name: "Owen", role: "O-1 Case Builder", sprite: "formal03", author: "Igor", installable: false,
    goals: ["legal"], dept: "Legal",
    outcome: "An exhibit list for your O-1 case, grouped by criterion, every item with a source.",
    example: ["Criterion 3 — press: 6 exhibits", "Criterion 4 — judging: 2 exhibits"],
    time: "~20 min", cost: 0.2, costFor: "Page reading", results: 2, needs: "Links to your articles",
    firstTask: "Build the exhibit list from my articles.",
    working: ["Reading articles", "Grouping by criterion"],
  },
  {
    slug: "ellis", name: "Ellis", role: "Investor Scout", sprite: "formal12", author: "timur", installable: false,
    goals: ["fundraise"], dept: "Sales",
    outcome: "40 investors that fit your round, each with a quoted thesis and a recent signal.",
    example: ["a16z speedrun — “agents for SMB” (Oct 2026)", "Seed check $250K–1M"],
    time: "~18 min", cost: 1.2, costFor: "Investor databases + web search", results: 7, needs: "Your round size",
    firstTask: "Find 40 seed investors for an AI agents marketplace.",
    working: ["Searching investor databases", "Quoting theses"],
  },
  {
    slug: "dean", name: "Dean", role: "Pitch Coach", sprite: "formal05", author: "Igor", installable: false,
    goals: ["fundraise"], dept: "Sales",
    outcome: "A cold investor verdict on your deck, concrete edits and the questions the call will open with.",
    example: ["Verdict: POLITE PASS → fix slide 3", "First question: “why now?”"],
    time: "~6 min", cost: 0, costFor: "No tools — free", results: 5, needs: "Your deck",
    firstTask: "Review my deck as a cold investor.",
    working: ["Reading the deck", "Writing the verdict"],
  },
];

// Ready teams = the onboarding. Clicking a team is the answer to "what do you want to get?".
export const TEAMS = [
  {
    id: "content", liveSlug: "content", name: "Daily Reel", goal: "content", label: "Reels & content",
    outcome: "A ready reel every day: trend → script → your take → edit.",
    chain: ["mark", "riley", "you", "james"], time: "~45 min", needs: "Film one take (1 min)",
    firstTask: "Make one reel about AI agents for today.",
  },
  {
    id: "legal", name: "O-1 Judging", goal: "legal", label: "Visa & legal",
    outcome: "10 judging invitations in two weeks, plus the exhibit list for your case.",
    chain: ["judy", "owen"], time: "~35 min", needs: "Your bio and article links (once)",
    firstTask: "Find hackathons that need judges and draft outreach.",
  },
  {
    id: "fundraise", name: "Investor Outreach", goal: "fundraise", label: "Raise money",
    outcome: "A list of 40 fitting investors and a deck that survives a cold read.",
    chain: ["ellis", "dean"], time: "~25 min", needs: "Round size and your deck",
    firstTask: "Find investors for our seed round and review the deck.",
  },
];

export const agentBySlug = Object.fromEntries(AGENTS.map((a) => [a.slug, a]));
export const teamById = Object.fromEntries(TEAMS.map((t) => [t.id, t]));
export const YOU = { slug: "you", name: "You", role: "Your step", sprite: null };
export const teamCost = (team) => team.chain.reduce((s, slug) => s + (agentBySlug[slug]?.cost ?? 0), 0);
// Live data names agents in Russian (content.json); the panel shows the library name.
export const LIVE_NAME_TO_SLUG = { "марк": "mark", "рили": "riley", "james": "james", "джеймс": "james" };

// ---------------------------------------------------------------- MOCK: wallet (credits)
// Real version: balance and ledger come from the Teamly platform (1 credit = $1, Polar checkout).
const WALLET_KEY = "teamly-v2:wallet";
export const STARTER_CREDITS = 5;
export const TOPUP_URL = "https://teamly.to";
function loadWallet() {
  try { return JSON.parse(localStorage.getItem(WALLET_KEY)) ?? null; } catch { return null; }
}
function saveWallet(w) { try { localStorage.setItem(WALLET_KEY, JSON.stringify(w)); } catch { /* no storage */ } wallet.onChange?.(); }
export const wallet = {
  data: loadWallet() ?? { balance: STARTER_CREDITS, ledger: [{ at: Date.now(), label: "Starter demo balance", amount: STARTER_CREDITS }] },
  get balance() { return Math.round(this.data.balance * 100) / 100; },
  canPay(amount) { return this.data.balance + 1e-9 >= amount; },
  spend(label, amount) {
    if (!amount) return;
    this.data.balance -= amount;
    this.data.ledger.unshift({ at: Date.now(), label, amount: -amount });
    saveWallet(this.data);
  },
  topUp(amount) {
    this.data.balance += amount;
    this.data.ledger.unshift({ at: Date.now(), label: "Top up (Polar)", amount });
    saveWallet(this.data);
  },
  set(amount) { this.data.balance = amount; this.data.ledger.unshift({ at: Date.now(), label: "Demo: balance set", amount: 0 }); saveWallet(this.data); },
  reset() { this.data = { balance: STARTER_CREDITS, ledger: [{ at: Date.now(), label: "Starter demo balance", amount: STARTER_CREDITS }] }; saveWallet(this.data); },
  runsLeft(costPerRun) { return costPerRun > 0 ? Math.floor(this.data.balance / costPerRun) : Infinity; },
};

// ---------------------------------------------------------------- MOCK: demo run
// A run walks the 8 "Now" moments with fake progress, because the live task can't show them all on demand.
// Steps: queued → working → done (per agent), "you" step → needs you, james → failure once → retry,
// out of credits → pause → top up → continue from the same step → result.
export function newRun(chain, task, { failOnce = "james" } = {}) {
  return {
    id: `run-${Date.now()}`, task, startedAt: Date.now(), failOnce,
    steps: chain.map((slug) => ({ slug, status: "queued", lineIdx: 0, spent: 0, failed: false })),
    cur: 0, phase: "running", rated: false, // phase: running | needs_you | failed | no_credits | done
  };
}
// Advance the run by one visible moment. Returns a short message for the log.
export function advance(run) {
  if (run.phase === "done") return "";
  const step = run.steps[run.cur];
  const agent = agentBySlug[step.slug];
  if (step.slug === "you") {
    if (step.status !== "needs_you") { step.status = "needs_you"; run.phase = "needs_you"; return "Needs you"; }
    return "";
  }
  if (run.phase === "failed" || run.phase === "no_credits") return "";
  if (step.status === "queued") {
    if (!wallet.canPay(agent.cost)) { run.phase = "no_credits"; return "Out of credits"; }
    step.status = "working"; return `${agent.name} started`;
  }
  if (step.status === "working") {
    if (step.lineIdx < agent.working.length - 1) { step.lineIdx += 1; return agent.working[step.lineIdx]; }
    if (run.failOnce === step.slug && !step.failed) { step.failed = true; run.phase = "failed"; return "Step failed"; }
    if (!wallet.canPay(agent.cost)) { run.phase = "no_credits"; return "Out of credits"; }
    wallet.spend(`${agent.name}: ${agent.costFor}`, agent.cost);
    step.spent = agent.cost; step.status = "done";
    return nextStep(run);
  }
  return "";
}
function nextStep(run) {
  if (run.cur >= run.steps.length - 1) { run.phase = "done"; run.finishedAt = Date.now(); return "Result ready"; }
  run.cur += 1; run.phase = "running";
  const next = run.steps[run.cur];
  if (next.slug === "you") { next.status = "needs_you"; run.phase = "needs_you"; return "Needs you"; }
  return "Next step";
}
export function resolveYou(run) { // the person delivered the take
  const step = run.steps[run.cur];
  if (step.slug !== "you") return;
  step.status = "done";
  nextStep(run);
}
export function retry(run) { run.phase = "running"; run.steps[run.cur].lineIdx = 0; }
export function resume(run) { if (run.phase === "no_credits") run.phase = "running"; }
export const runSpent = (run) => run.steps.reduce((s, x) => s + x.spent, 0);
export const runEstimate = (run) => run.steps.reduce((s, x) => s + (agentBySlug[x.slug]?.cost ?? 0), 0);
export const FAILURE = {
  james: { what: "The render stopped: your take is 4K HEVC and the renderer can't read it.", fix: "Retry — James converts the take to 1080p first. No credits are charged for the failed try." },
};

// ---------------------------------------------------------------- MOCK: onboarding (the coordinator's suggestion)
// Real version: the coordinator asks "What are we solving?" in the chat (describe / analyse my chats and folder /
// pick a direction), then writes `suggested: [{slug, why}]` into ~/.teamly/teams/<slug>.json; the panel reads it.
export const WHY = {
  mark: "Finds what is blowing up right now, so every reel starts from proof",
  riley: "Turns the trend into a script in your voice",
  james: "Edits your take into a finished reel",
  judy: "Finds hackathons that need judges and writes to organizers",
  owen: "Collects the evidence your O-1 lawyer needs",
  ellis: "Finds investors whose thesis fits your round",
  dean: "Reads your deck like a cold investor",
};
export function suggestFor(goal) {
  const t = TEAMS.find((x) => x.goal === goal) ?? TEAMS[0];
  return { goal: t.goal, teamId: t.id, agents: t.chain.filter((s) => s !== "you").map((slug) => ({ slug, why: WHY[slug] })) };
}
export function goalFromText(text) {
  const s = text.toLowerCase();
  if (/(visa|o-1|o1|виз|судейств|judg|lawyer|юрист)/.test(s)) return "legal";
  if (/(invest|raise|deck|pitch|инвест|раунд|питч)/.test(s)) return "fundraise";
  return "content";
}
// What the coordinator might find in your recent Claude Code chats and this folder (shape of the real answer).
export const ANALYSIS = {
  chats: 40, files: 214, days: 14,
  top: [
    { label: "Reels & video editing", count: 19, goal: "content" },
    { label: "Investors & pitch deck", count: 8, goal: "fundraise" },
    { label: "O-1 visa", count: 5, goal: "legal" },
  ],
};

// ---------------------------------------------------------------- MOCK: onboarding steps (prototype only)
// What the coordinator writes to ~/.teamly/onboarding.json, step by step. Numbers are from Igor's real
// analysis on 21.10.2026 (151 sessions, 30 days). The real run uses the live file instead.
const JOBS = [
  { id: "reels", title: "Reels & video", sessions: 54, repeats: "Trend → script in your voice → take or AI blogger → edit", pain: "credits burned on generations you didn't approve; wrong format, length, captions" },
  { id: "planning", title: "Planning & sprints", sessions: 39, repeats: "Weekly plan, milestones, honest feedback (critical-opinion 35×)" },
  { id: "posts", title: "Posts & carousels", sessions: 34, repeats: "Instagram carousels, LinkedIn and X posts, blog articles" },
  { id: "legal", title: "Visa & legal", sessions: 21, repeats: "O-1 case, E2, taxes, prenup" },
  { id: "investors", title: "Investors & pitch", sessions: 18, repeats: "Finding VCs, deck reviews, answers to investors" },
];
const MOCK_TEAM = {
  name: "Daily Reel", slug: "daily-reel", result: "Ready 9:16 reel", cadence: "Every day", approach: "trend-remakes",
  chain: ["trend-radar", "reel-script", "you", "james"],
  agents: [
    { slug: "trend-radar", source: "fork", upstream: "trend-radar", why: "Finds what broke out in your niche this week, ranked by velocity" },
    { slug: "reel-script", source: "fork", upstream: "reel-script", why: "Writes the script in your voice: result first, code word at the end" },
    { slug: "james", source: "fork", upstream: "james", why: "Edits your take: captions, graphics on the words, sound" },
  ],
  firstTask: "Make one reel about AI agents for today.", costPerResult: 2.8,
};
const MOCK_GOAL = { id: "grow-audience", title: "Grow an audience with short video", target: "20 reels by 15.11", deadline: "15.11", targetCount: 20 };
const MOCK_NOW = { current: "Films and edits everything himself, topics from the head", blockers: ["no editor", "doesn't know what to film"], alreadyHave: ["script prompts in Claude Code"], gaps: ["finding topics", "editing"] };
const MOCK_APPROACHES = [
  { slug: "trend-remakes", title: "Remake what is already breaking out", idea: "Every day take one of 10 reels that broke out in your niche this week and re-film it in your voice in a minute.", whatsNewForYou: "You said you don't know what to film: topics come from measured breakouts, and the editor is part of the team.", chain: ["trend-radar", "reel-script", "you", "james"], needsFromYou: "1 min of filming a day", costPerResult: 2.8, timePerResult: "~45 min", author: "Igor Kossolapov",
    evidence: [{ text: "Author's 103 reels: product by name and “free” give ×1.9 to median views", kind: "practitioner" }] },
  { slug: "carousel-repurpose", title: "Carousels from proven posts", idea: "Three carousels a week from English posts that already collected saves, rewritten for your audience.", whatsNewForYou: "No filming and no editing at all: covers the days you can't shoot.", chain: ["trend-radar", "carousel-maker"], needsFromYou: "10 min to approve", costPerResult: 1.2, timePerResult: "~15 min", author: "Igor Kossolapov",
    evidence: [{ text: "“My whole system” posts get saved 2–3× more often than liked", kind: "research" }] },
  { slug: "codeword-funnel", title: "Code word → DM → lead", idea: "Each reel ends with a code word; a comment triggers a DM with the material. Views turn into contacts.", whatsNewForYou: "Measures leads, not views: reach drops a bit, conversations multiply.", chain: ["reel-script", "you", "dm-funnel"], missing: ["dm-funnel"], needsFromYou: "Material worth giving away", costPerResult: 0, timePerResult: "~10 min", author: "Igor Kossolapov",
    evidence: [{ text: "Author's code-word reels: median 14K views vs 102K, but 133 comments vs 41", kind: "practitioner" }] },
];
const MOCK_FORKS = [
  { slug: "trend-radar", name: "Trend Radar · yours", upstream: "trend-radar", upstreamAuthor: "Igor Kossolapov", changes: ["niche: any → AI tools and Claude Code", "sources: all → English-first for AI", "10 items → 5 with a remake idea each"] },
  { slug: "reel-script", name: "Reel Script · yours", upstream: "reel-script", upstreamAuthor: "Igor Kossolapov", changes: ["voice: generic → built from your 5 best scripts", "CTA: none → code word mode", "length: 90–130 → 100–120 words"] },
];
const MOCK_ONT = { task: "One reel a day", result: "Ready 9:16 reel with caption", done: "Script passes the linter, take is filmed, edit exported", steps: ["Breakouts of the week", "Script in your voice", "Your take", "Edit"],
  rules: [{ text: "Result in the first sentence, a product the viewer knows", source: "chat 2026-09-24" }, { text: "No steps in speech: steps go to the link", source: "chat 2026-09-22" }, { text: "Never reuse post images in a reel: redo for 9:16", source: "chat 2026-09-21" }] };
export const MOCK_ONBOARDING = [
  { step: "start" },
  { step: "goal", goal: MOCK_GOAL },
  { step: "now", goal: MOCK_GOAL, now: MOCK_NOW },
  { step: "approaches", goal: MOCK_GOAL, now: MOCK_NOW, approaches: MOCK_APPROACHES },
  { step: "approaches", goal: MOCK_GOAL, now: MOCK_NOW, approaches: MOCK_APPROACHES, picked: ["trend-remakes"] },
  { step: "fork", goal: MOCK_GOAL, forks: MOCK_FORKS, ontology: MOCK_ONT },
  { step: "packaged", goal: MOCK_GOAL, team: { ...MOCK_TEAM, goal: { ...MOCK_GOAL, progress: 0 } }, pack: "~/Content Team/team" },
  { step: "started", goal: MOCK_GOAL, team: { ...MOCK_TEAM, goal: { ...MOCK_GOAL, progress: 1 } }, pack: "~/Content Team/team" },
];
export function mockTeamMd(team) {
  if (!team) return "";
  const rows = team.agents.map((a) => `- ${a.name ?? agentBySlug[a.slug]?.name} — ${a.why}${a.source === "built" ? ` (built from ${a.builtFrom} of your chats)` : ""}`).join("\n");
  return `# ${team.name}\n\nResult: ${team.result} · ${team.cadence}\nChain: ${team.chain.map((s) => (s === "you" ? "you (take)" : agentBySlug[s]?.name ?? s)).join(" → ")}\nCost per result: ~${team.costPerResult} credits (tools only)\n\n## Who does what\n${rows}\n\n## What you do\nFilm one take (~1 min) — or let Sasha make an AI take.\n\n## Run it\nOpen a new Claude Code chat in this folder and paste:\n  Teamly v2: run the team from this folder\n`;
}

// ---------------------------------------------------------------- LIVE library (replaces the mock cards)
// The server sends the library's cards (the shared Teamly library and the person's own); they replace the mocks.
const SPRITES = ["hoodie07", "creative06", "creative05", "streetwear13", "creative01", "smartcasual01", "formal03", "formal12", "formal05", "hoodie03", "creative11", "smartcasual21", "streetwear01"];
const hashSlug = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
// A stable face for an agent that has no sprite of its own (team records written before cards had sprites).
export const spriteFor = (slug) => SPRITES[hashSlug(String(slug)) % SPRITES.length];
function goalsFromTags(tags) {
  const t = (Array.isArray(tags) ? tags : []).join(" ").toLowerCase();
  const g = [];
  if (/content|reel|video|script|carousel|post|trend/.test(t)) g.push("content");
  if (/invest|pitch|fundrais|deck|vc/.test(t)) g.push("fundraise");
  if (/legal|visa|law/.test(t)) g.push("legal");
  if (/plan|sprint|week|productivity/.test(t)) g.push("planning");
  return g.length ? g : ["other"];
}
let libraryKey = "";
// Cards come from other people. The two fields the screens put into an attribute or count get a strict shape
// (the server does the same; this keeps the panel safe on its own).
const asList = (v) => (Array.isArray(v) ? v : typeof v === "string" || (v && typeof v === "object") ? [v] : []);
const asText = (v) => (typeof v === "string" ? v : v == null ? "" : String(v));
// What an agent is connected to: the services it reaches, from the card's `integrations` or, for cards without it, read
// off its tools and paid tools. Scripts and files of its own are not integrations. Prices are never shown: nobody
// knows them before a tool runs.
const KNOWN = [
  [/web\s*search|websearch/i, "Web search"], [/web\s*fetch|webfetch|read a link|web pages?/i, "Web pages"],
  [/instagram|tiktok|live (social )?data|x views/i, "Live social data"], [/investor database/i, "Investor databases"],
  [/sec edgar/i, "SEC EDGAR"], [/calendar/i, "Calendar"], [/cover|image gen|pictures?/i, "Image generation"],
  [/seedance|video gen/i, "Video generation"], [/elevenlabs|voice-?over|text.to.speech/i, "Voice"], [/heygen|avatar/i, "Avatars"],
  [/notion/i, "Notion"], [/gmail|e-?mail/i, "Email"], [/telegram/i, "Telegram"], [/google drive/i, "Google Drive"], [/apify/i, "Apify"],
];
export function integrationsOf(a) {
  const own = Array.isArray(a?.integrations) ? a.integrations.map((x) => (typeof x === "string" ? { name: x } : x))
    .filter((x) => x && typeof x.name === "string" && x.name.trim()) : null;
  if (own?.length) return own.map((x) => ({ name: x.name.trim(), optional: !!x.optional }));
  const found = new Map();
  const texts = [...(Array.isArray(a?.tools) ? a.tools : []), ...(Array.isArray(a?.costBreakdown) ? a.costBreakdown.map((c) => c?.tool) : [])];
  for (const t of texts) {
    if (typeof t !== "string") continue;
    const hit = KNOWN.find(([re]) => re.test(t));
    if (!hit) continue;
    const optional = /optional|необязательно|only with your ok/i.test(t);
    found.set(hit[1], { name: hit[1], optional: found.has(hit[1]) ? found.get(hit[1]).optional && optional : optional });
  }
  return [...found.values()].sort((x, y) => Number(x.optional) - Number(y.optional));
}

export function cleanCard(c) {
  if (!c || typeof c !== "object") return c;
  if (c.sprite != null && !/^[A-Za-z0-9_-]{1,64}$/.test(String(c.sprite))) delete c.sprite;
  if (c.results != null) c.results = Math.max(0, Math.floor(Number(c.results)) || 0);
  // lists the screens walk and texts they slice: one odd field in one card must not take the Library down
  for (const k of ["tags", "costBreakdown", "setup", "tools", "integrations"]) if (c[k] != null) c[k] = asList(c[k]);
  if (c.job != null && (typeof c.job !== "object" || Array.isArray(c.job))) c.job = null;
  if (c.job) {
    for (const k of ["steps", "deliverables"]) if (c.job[k] != null) c.job[k] = asList(c.job[k]).map(asText);
    for (const k of ["area", "owns", "give", "get", "not"]) if (c.job[k] != null) c.job[k] = asText(c.job[k]);
  }
  if (c.runtime != null && (typeof c.runtime !== "object" || Array.isArray(c.runtime))) c.runtime = null;
  if (c.runtime?.why != null) c.runtime.why = asText(c.runtime.why);
  if (c.rating != null && (typeof c.rating !== "object" || !Number.isFinite(Number(c.rating.avg)))) c.rating = null;
  return c;
}
export function cleanState(S) {
  if (S && typeof S === "object") S.library = (Array.isArray(S.library) ? S.library : []).filter((c) => c && typeof c === "object" && typeof c.slug === "string");
  for (const c of S?.library ?? []) cleanCard(c);
  for (const t of S?.teams ?? []) for (const a of Array.isArray(t.agents) ? t.agents : []) cleanCard(a?.card);
  return S;
}

export function setLibrary(cards) {
  if (!Array.isArray(cards)) return false;  // an empty library is a real answer too: the prototype's agents never stay
  const key = JSON.stringify(cards.map((c) => [c?.slug, c?.version, c?.evalWin, c?.results, c?.rating?.count, c?.week, c?.job?.deliverables?.length]));
  if (key === libraryKey) return false;
  const mapped = cards.filter((c) => c && typeof c === "object" && typeof c.slug === "string" && c.slug).map(cleanCard).map((c) => ({
    slug: c.slug, name: c.name ?? c.slug, role: c.role ?? "", sprite: c.sprite ?? SPRITES[hashSlug(c.slug) % SPRITES.length],
    author: c.author ?? "?", official: c.authorKind === "teamly", kind: c.authorKind ?? "community", installable: true,
    goals: goalsFromTags(c.tags), dept: (c.tags ?? [])[0] ?? "",
    outcome: c.outcome ?? "", example: Array.isArray(c.example) ? c.example : c.example ? [String(c.example)] : [],
    time: c.time ?? "", cost: Number(c.costPerResult ?? 0), costFor: c.costFor ?? "", results: c.results ?? 0,
    needs: c.needsFromYou ?? "Nothing from you", firstTask: c.firstTask ?? c.outcome ?? "",
    working: c.working ?? ["Reading the ontology", "Working on the task", "Checking against the quality bar"],
    evalWin: c.evalWin ?? null, version: c.version ?? "", upstream: c.upstream ?? null,
    hasOntology: !!c.hasOntology, hasEvals: !!c.hasEvals, functionType: c.functionType ?? "", note: c.note ?? "",
    // the job description: what it owns, you give → it does (3 steps) → you get, and what is not its job
    job: c.job ?? null, area: c.job?.area ?? goalsFromTags(c.tags)[0], costBreakdown: c.costBreakdown ?? [],
    tools: c.tools ?? [], integrations: c.integrations ?? null,
    replacedBy: c.replacedBy ?? null,
    rating: c.rating ?? null, week: c.week ?? 0, updatedAt: c.updatedAt ?? "",
    runtime: c.runtime ?? { local: true, cloud: false, why: "" },
  }));
  libraryKey = key;  // only once the cards mapped: a card that threw never leaves the prototype's agents in place
  AGENTS.splice(0, AGENTS.length, ...mapped);
  for (const k of Object.keys(agentBySlug)) delete agentBySlug[k];
  for (const a of AGENTS) agentBySlug[a.slug] = a;
  for (let i = TEAMS.length - 1; i >= 0; i--) if (!TEAMS[i].chain.every((s) => s === "you" || agentBySlug[s])) TEAMS.splice(i, 1);
  for (const k of Object.keys(teamById)) delete teamById[k];
  for (const t of TEAMS) teamById[t.id] = t;
  return true;
}
