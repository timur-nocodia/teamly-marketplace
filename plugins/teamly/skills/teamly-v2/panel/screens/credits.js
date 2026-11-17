// WALLET: Teamly Dollars and where they go — what the key really holds (money.js). The balance and the tool calls come
// from the Teamly API (the same wallet as on the site); top up on the site. A key that isn't a Teamly key has none.
// Drawn in Teamly's pixel style: square corners, chunky black borders, hard shadows, pixel labels and prices.

const KEY_LINE = {
  true: ["text-[#1e7a45]", "Connected to Teamly"],
  demo: ["text-[#707383]", "Not a Teamly key: agents use free tools only. Sign in to Teamly for paid tools"],
  rejected: ["text-amber-700", "Teamly doesn't recognize this key: sign in to Teamly again"],
  offline: ["text-[#707383]", "Teamly can't be reached right now: it will check again"],
  server: ["text-[#707383]", "Teamly answered with an error: it will check again"],
  checking: ["text-[#707383]", "Checking the key…"],
};

const PIX = "font-[family-name:var(--font-pixel)] uppercase";
const CARD = "relative border-[3px] border-[#0a0a0a] bg-white shadow-[5px_5px_0_0_#0a0a0a]";
const ROWS = "flex flex-col divide-y-2 divide-[#0a0a0a]/10";
const LABEL = `${PIX} text-[8px] tracking-[0.12em] text-[#3F6AB8]`;
const META = `${PIX} text-[7px] leading-relaxed tracking-[0.08em] text-[#707383]`;
const PRICE = `${PIX} shrink-0 text-right text-[9px]`;   // + a color where used
const TILE = `${PIX} grid size-8 shrink-0 place-items-center border-2 border-[#0a0a0a] text-[7px] text-[#0a0a0a]`;
const CHIP = `${PIX} inline-block border-2 px-1.5 py-[3px] text-[6.5px] leading-none tracking-[0.08em]`;
const PRESS = "active:translate-x-[3px] active:translate-y-[3px] active:shadow-none";
const BTN_BRAND = `${PIX} block w-full border-2 border-[#1E4385] bg-[#3F6AB8] px-3 py-3 text-center text-[9px] tracking-[0.1em] text-white shadow-[3px_3px_0_0_#1E4385] hover:bg-[#2A55A8] ${PRESS}`;
const PLAIN = `${PIX} block w-full border-2 border-[#0a0a0a] bg-white px-3 py-2.5 text-center text-[8px] tracking-[0.1em] shadow-[3px_3px_0_0_#0a0a0a] ${PRESS}`;
const BTN_PLAIN = `${PLAIN} text-[#0a0a0a] hover:bg-[#eef1f5]`;
const BTN_DANGER = `${PLAIN} text-[#0a0a0a] hover:bg-[#FDE8E4] hover:text-[#B42318]`;

// Which service a tool call or a price line is about, in words a person knows (from the provider and endpoint).
const SERVICES = [
  [/instagram/i, "Instagram", "IG"], [/tiktok/i, "TikTok", "TT"], [/twitter|tweet|x\.com|(^|[^a-z])x([^a-z]|$)/i, "X", "X"],
  [/youtube/i, "YouTube", "YT"], [/linkedin/i, "LinkedIn", "IN"], [/reddit/i, "Reddit", "RD"],
  [/seedance|kling|runway|video/i, "Video", "VID"], [/heygen|avatar/i, "Avatar", "AV"],
  [/eleven|voice|tts|speech|sound/i, "Voice", "VOX"], [/image|flux|dall|banana|cover/i, "Images", "IMG"],
  [/render/i, "Render", "RND"], [/investor|crunchbase|pitchbook/i, "Investor data", "VC"],
];
const SEARCH = [/google|serp|search|crawl|page/i, "Web search", "WEB"];   // only when no named service is there
export function servicesIn(text) {
  const t = String(text ?? "");
  const named = SERVICES.filter(([rx]) => rx.test(t));
  return (named.length ? named : SEARCH[0].test(t) ? [SEARCH] : []).map(([, name, tag]) => ({ name, tag }));
}
export const serviceOf = (text) => servicesIn(text)[0] ?? { name: "Tool call", tag: "API" };

const breakdownOf = (list) => (Array.isArray(list) ? list.filter((b) => b && typeof b === "object") : []);

// The person's agents: from their floors (each agent's own card first, then the library's), or the demo's hired list.
function myAgents(ctx) {
  const out = new Map();
  for (const t of ctx.S.teams ?? []) {
    for (const a of Array.isArray(t.agents) ? t.agents : []) {
      if (!a || typeof a.slug !== "string" || out.has(a.slug)) continue;
      const up = typeof a.upstream === "string" ? a.upstream.split("@")[0] : a.upstream?.slug;
      const lib = ctx.A.agentBySlug[a.slug] ?? (up ? ctx.A.agentBySlug[up] : null);
      const card = a.card && typeof a.card === "object" ? a.card : {};
      out.set(a.slug, { slug: a.slug, name: a.name || card.name || lib?.name || a.slug, sprite: card.sprite || lib?.sprite,
        breakdown: breakdownOf(Array.isArray(card.costBreakdown) ? card.costBreakdown : lib?.costBreakdown) });
    }
  }
  if (!out.size) {
    for (const a of ctx.A.AGENTS.filter((x) => ctx.isHired(x.slug))) {
      out.set(a.slug, { slug: a.slug, name: a.name, sprite: a.sprite, breakdown: breakdownOf(a.costBreakdown) });
    }
  }
  return [...out.values()];
}

// Every paid tool those agents can call, once, with who uses it.
function toolsOf(agents) {
  const tools = [];
  for (const a of agents) {
    for (const b of a.breakdown) {
      const key = String(b.name || b.tool || "").toLowerCase();
      const known = tools.find((t) => t.key === key);
      if (known) { if (!known.agents.some((x) => x.slug === a.slug)) known.agents.push(a); continue; }
      tools.push({ key, b, agents: [a] });
    }
  }
  return tools;
}

const providersOf = (b) => (Array.isArray(b.providers) ? b.providers.filter((p) => typeof p === "string") : []);

const BALANCE_LINE = {
  real: "The same wallet as on the Teamly site.",
  none: "This key isn't a Teamly key, so there are no Teamly Dollars on it. Paste your key from the Teamly site to see your balance.",
  rejected: "Teamly doesn't recognize this key: replace it below with the one from your key page.",
  offline: "Teamly can't be reached right now. The balance shows up as soon as it answers.",
  error: "Teamly answered with an error instead of your balance. It asks again every minute.",
  checking: "Asking Teamly for your balance…",
};

function balanceCard(ctx, m) {
  const empty = m.state === "real" && m.balance < 0.01;  // less than a cent can't pay for any tool call
  return `
    <div class="relative border-[3px] border-[#3F6AB8] bg-white p-4 shadow-[6px_6px_0_0_#3F6AB8]">
      <div class="flex items-center gap-2.5">
        <span aria-hidden="true" class="${PIX} grid size-8 place-items-center border-2 border-[#0a0a0a] bg-[#F5C542] text-[11px] shadow-[2px_2px_0_0_#0a0a0a]">$</span>
        <p class="${LABEL} flex-1">Teamly Dollars</p>
        ${m.state === "real" || m.state === "error" ? `<button data-refresh title="Ask Teamly again" class="${META} inline-flex items-center gap-1 hover:text-[#3F6AB8]">${m.at ? `Updated ${ctx.esc(ctx.minsAgo(m.at * 1000))}` : "Refresh"} ${ctx.icon("refresh", "size-3")}</button>` : ""}
      </div>
      <p class="${PIX} mt-4 text-[26px] leading-none text-[#0a0a0a]">${m.state === "rejected" ? "—" : m.balance == null ? "$…" : ctx.cr(m.balance).replace("−", "-")}</p>
      ${m.held > 0 ? `<p class="${META} mt-2.5">${ctx.cr(m.held)} held for a run in progress</p>` : ""}
      <p class="mt-3 text-[12.5px] leading-snug ${empty || m.state === "rejected" ? "font-medium text-[#B42318]" : "text-[#4a4d5a]"}">${empty
        ? "Empty: steps with paid tools pause until you top up." : BALANCE_LINE[m.state]}</p>
      ${m.state === "real" ? `<button data-topup class="${BTN_BRAND} mt-4">Top up on the site ${ctx.icon("external", "inline size-3 -mt-0.5")}</button>`
        : m.state === "none" || m.state === "rejected" ? `<button data-get-key class="${BTN_BRAND} mt-4">Sign in to Teamly ${ctx.icon("external", "inline size-3 -mt-0.5")}</button>` : ""}
    </div>`;
}

function toolsCard(ctx, tools) {
  return `
    <div class="${CARD} ${ROWS}">
      ${tools.map(({ b, agents }) => {
        const providers = providersOf(b);
        const found = servicesIn(`${providers.join(" ")} ${b.name ?? ""} ${b.tool ?? ""}`);
        const s = found[0] ?? serviceOf("");
        return `
        <div class="flex gap-3 px-3.5 py-3">
          <span class="${TILE} bg-[#eef1f5]">${ctx.esc(s.tag)}</span>
          <div class="min-w-0 flex-1">
            <div class="flex items-baseline justify-between gap-2">
              <p class="${PIX} text-[8px] leading-relaxed tracking-[0.08em] text-[#0a0a0a]">${ctx.esc(b.name || found.map((x) => x.name).join(" · ") || s.name)}</p>
              <p class="${PRICE} text-[#0a0a0a]">~${ctx.cr(Number(b.credits || 0))}</p>
            </div>
            <p class="mt-1 line-clamp-2 text-[12px] leading-snug text-[#4a4d5a]">${ctx.esc(providers.length ? providers.join(" · ") : b.tool || "")}${b.unit ? ` · ${ctx.esc(b.unit)}` : ""}</p>
            <div class="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
              ${b.optional ? `<span class="${CHIP} border-[#9a7514] bg-[#FFF6D6] text-[#7a5b0c]">Only when you ask</span>` : ""}
              ${agents.map((a) => `<span class="inline-flex items-center gap-1 text-[11.5px] text-[#4a4d5a]">${ctx.avatar(a.sprite, "size-5")}${ctx.esc(a.name)}</span>`).join("")}
            </div>
          </div>
        </div>`;
      }).join("")}
    </div>`;
}

function agentsCard(ctx, agents) {
  return `
    <div class="${CARD} ${ROWS}">
      ${agents.map((a) => {
        const base = a.breakdown.filter((b) => !b.optional).reduce((n, b) => n + Number(b.credits || 0), 0);
        const extra = a.breakdown.filter((b) => b.optional).reduce((n, b) => n + Number(b.credits || 0), 0);
        const named = (b) => servicesIn(`${b.name ?? ""} ${b.tool ?? ""}`).map((x) => x.name);
        const services = [...new Set(a.breakdown.flatMap((b) => (providersOf(b).length ? providersOf(b) : named(b).length ? named(b) : ["Paid tool"])))];
        return `
        <div class="flex items-center gap-3 px-3.5 py-3">
          ${ctx.avatar(a.sprite, "size-8")}
          <div class="min-w-0 flex-1">
            <p class="text-[13px] font-medium text-[#0a0a0a]">${ctx.esc(a.name)}</p>
            <div class="mt-1.5 flex flex-wrap gap-1">${services.length
              ? services.map((x) => `<span class="${CHIP} border-[#0a0a0a] bg-[#eef1f5] text-[#0a0a0a]">${ctx.esc(x)}</span>`).join("")
              : `<span class="${CHIP} border-[#1e7a45] bg-[#E3F6EA] text-[#1e7a45]">Free tools only</span>`}</div>
          </div>
          <div class="shrink-0 text-right">
            <p class="${PRICE} ${base ? "text-[#0a0a0a]" : "text-[#1e7a45]"}">${base ? `~${ctx.cr(base)}` : "Free"}</p>
            ${extra ? `<p class="${META} mt-1">+${ctx.cr(extra)} if you ask</p>` : ""}
          </div>
        </div>`;
      }).join("")}
    </div>`;
}

const STATUS = [
  [/succe|done|ok|complete|finish/i, "Done", "border-[#1e7a45] bg-[#E3F6EA] text-[#1e7a45]"],
  [/run|pend|queue|start|ready/i, "Running", "border-[#3F6AB8] bg-[#E8EEFA] text-[#3F6AB8]"],
];
const statusOf = (s) => {
  const hit = STATUS.find(([rx]) => rx.test(String(s ?? "")));
  return hit ? [hit[1], hit[2]] : ["Failed", "border-[#B42318] bg-[#FDE8E4] text-[#B42318]"];
};

// The tool calls this key paid for, as the Teamly API records them (nothing local, nothing simulated).
function callsCard(ctx, m) {
  const note = (text) => `<div class="${CARD} px-3.5 py-4"><p class="text-[12.5px] leading-snug text-[#4a4d5a]">${text}</p></div>`;
  if (m.state !== "real") {
    return note(m.state === "checking" || m.state === "offline" || m.state === "error" ? "Tool calls show up here when Teamly answers."
      : "Tool calls show up here once your Teamly key is connected.");
  }
  const runs = Array.isArray(ctx.S.runs) ? ctx.S.runs : [];
  const list = runs.length ? `
    <div class="${CARD} ${ROWS}">
      ${runs.map((r) => {
        const s = serviceOf(`${r.provider} ${r.endpoint}`);
        const [label, tone] = statusOf(r.status);
        const at = Date.parse(r.at);
        return `
        <div class="flex items-center gap-3 px-3.5 py-2.5">
          <span class="${TILE} bg-[#eef1f5]">${ctx.esc(s.tag)}</span>
          <div class="min-w-0 flex-1">
            <p class="flex items-center gap-2 text-[13px] font-medium text-[#0a0a0a]">${ctx.esc(s.name)}<span class="${CHIP} ${tone}">${label}</span></p>
            <p class="mt-0.5 truncate font-mono text-[10.5px] text-[#707383]">${ctx.esc(r.provider)}${ctx.esc(r.endpoint)}</p>
          </div>
          <div class="shrink-0 text-right">
            <p class="${PRICE} text-[#0a0a0a]">${r.cost != null ? `-${ctx.cr(r.cost)}` : "…"}</p>
            <p class="mt-1 text-[10.5px] text-[#707383]">${Number.isFinite(at) ? ctx.minsAgo(at) : ""}</p>
          </div>
        </div>`;
      }).join("")}
    </div>` : note("No paid tool calls yet. When an agent calls one — Instagram data, video, voice — it shows up here with its price.");
  return `${list}<button data-history class="${PIX} mt-3.5 block w-full text-center text-[7px] tracking-[0.1em] text-[#3F6AB8] hover:underline">Full history on the Teamly site</button>`;
}

const heading = (title, note = "") => `
    <div class="mt-8 mb-3 flex items-baseline justify-between gap-2"><p class="${LABEL}">${title}</p>${note ? `<p class="${META}">${note}</p>` : ""}</div>`;

export function render(ctx) {
  const m = ctx.money();
  const k = ctx.S.key ?? {};
  const [keyTone, keyText] = KEY_LINE[k.verified === true ? "true" : k.reason] ?? KEY_LINE.checking;
  const agents = myAgents(ctx);
  const mine = toolsOf(agents);
  const library = mine.length || agents.length ? [] : toolsOf(ctx.A.AGENTS.map((a) => ({ slug: a.slug, name: a.name, sprite: a.sprite, breakdown: breakdownOf(a.costBreakdown) })));
  return `
  <div class="min-h-full bg-[#f3f5f9] px-4 pb-24 pt-6">
    ${balanceCard(ctx, m)}

    ${heading("Where Teamly Dollars go")}
    <p class="text-[12.5px] leading-snug text-[#4a4d5a]">Only <b class="text-[#0a0a0a]">paid tools</b> your agents call through your Teamly key. Their thinking and writing run on <b class="text-[#0a0a0a]">your Claude plan</b>: free.</p>

    ${heading(mine.length || !library.length ? "Tools" : "Tools in the library", "price per call")}
    ${mine.length ? toolsCard(ctx, mine) : library.length ? toolsCard(ctx, library)
      : `<div class="${CARD} px-3.5 py-4"><p class="text-[12.5px] leading-snug text-[#4a4d5a]">Your agents use only free tools: web search and public pages.</p></div>`}

    ${agents.length ? `${heading("Your agents", "per result")}${agentsCard(ctx, agents)}` : ""}

    ${heading("Tool calls", m.state === "real" ? "latest 20" : "")}
    ${callsCard(ctx, m)}

    ${heading("Teamly key")}
    <div class="${CARD} p-3.5">
      <div class="flex items-center gap-2">
        ${ctx.icon("key", "size-3.5 shrink-0 text-[#707383]")}
        <span class="min-w-0 flex-1 truncate font-mono text-[12px] text-[#0a0a0a]">${ctx.esc(k.masked ?? "")}</span>
      </div>
      <p class="mt-2 text-[12px] ${keyTone}">${keyText}</p>
      <p class="mt-1 text-[11px] leading-snug text-[#707383]">From ${ctx.esc(k.source ?? "~/.teamly/credentials.json")} on this computer. Agents read it from there; if the key came in the install prompt, it is also in that chat.</p>
      <form id="replace-form" class="mt-3 hidden flex-col gap-2">
        <input id="replace-input" type="password" autocomplete="off" placeholder="Paste a new key" class="h-10 border-2 border-[#0a0a0a] px-2.5 font-mono text-[12px] outline-none focus:border-[#3F6AB8]" />
        <button type="submit" class="${BTN_BRAND}">Save key</button>
      </form>
      <div class="mt-3.5 grid grid-cols-2 gap-3">
        <button data-replace class="${BTN_PLAIN}">Replace key</button>
        <button data-disconnect class="${BTN_DANGER}">Disconnect</button>
      </div>
    </div>
  </div>`;
}

export function mount(root, ctx) {
  // top up on the Teamly site (Polar) in the person's own browser; a key that isn't a Teamly key gets the key page instead
  const site = (which) => ctx.A.live.openUrl(which).then(() => ctx.toast("Opened in your browser")).catch((e) => ctx.toast(e.message));
  root.querySelector("[data-topup]")?.addEventListener("click", () => site("topup"));
  root.querySelector("[data-get-key]")?.addEventListener("click", () => site("key"));
  const ask = () => ctx.A.live.refreshWallet().then(() => setTimeout(() => ctx.refreshLive().then(ctx.refresh), 1500)).catch(() => {});
  root.querySelector("[data-refresh]")?.addEventListener("click", ask);
  if (!mount.asked || Date.now() - mount.asked > 30_000) { mount.asked = Date.now(); ask(); }   // opening the wallet asks Teamly now
  root.querySelector("[data-history]")?.addEventListener("click", () => site("topup"));
  const form = root.querySelector("#replace-form");
  root.querySelector("[data-replace]").onclick = () => { form.classList.replace("hidden", "flex"); root.querySelector("#replace-input").focus(); };
  form.onsubmit = async (e) => {
    e.preventDefault();
    try { await ctx.A.live.saveKey(root.querySelector("#replace-input").value.trim()); await ctx.refreshLive(); ctx.refresh(); ctx.toast("Key replaced"); }
    catch (ex) { ctx.toast((ex.message)); }
  };
  root.querySelector("[data-disconnect]").onclick = async () => {
    // one click must not throw the key away: the person may not have it anywhere else
    if (!window.confirm("Remove the Teamly key from this computer? Paid tools stop until you paste it again.")) return;
    const r = await ctx.A.live.removeKey().catch((e) => ({ error: e.message }));
    // a key from TEAMLY_API_KEY or ~/.env can't be removed from here: say where it lives
    if (r?.connected) ctx.toast(`This key comes from ${r.source === "~/.env" ? "the TEAMLY_API_KEY line in ~/.env" : "the TEAMLY_API_KEY setting"}: remove it there.`);
    await ctx.refreshLive(); ctx.refresh();
  };
}
