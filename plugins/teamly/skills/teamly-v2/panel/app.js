// Teamly v2 panel shell: key gate → start (entries) → tabs NOW · LIBRARY · CREDITS.
// The panel cannot type into the Claude Code chat: every action that needs the chat copies a prompt
// for the coordinator chat and shows it in a sheet. Data comes only from adapter.js.
import * as A from "./adapter.js";
import * as startScreen from "./screens/start.js";
import * as teamScreen from "./screens/team.js";
import * as libraryScreen from "./screens/library.js";
import * as creditsScreen from "./screens/credits.js";
import * as officeScreen from "./screens/office.js";
import * as teamsScreen from "./screens/teams.js";
import * as agentScreen from "./screens/agent.js";
import * as overviewScreen from "./screens/overview.js";
import { updateStrip, versionLabel } from "./update.js";
import { moneyOf } from "./money.js";

const SCREENS = { start: startScreen, teams: teamsScreen, team: teamScreen, agent: agentScreen, library: libraryScreen, credits: creditsScreen, office: officeScreen, overview: overviewScreen };
const TABS = [
  { id: "teams", label: "Office", icon: "building", also: ["team", "agent", "office", "overview"] },
  { id: "library", label: "Library", icon: "layoutGrid", also: [] },
  { id: "credits", label: "Wallet", icon: "coins", also: [] },
];

// ---------------------------------------------------------------- helpers
const ICONS = {
  activity: '<path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/>',
  building: '<path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"/><path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/><path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"/><path d="M10 6h4"/><path d="M10 10h4"/><path d="M10 14h4"/><path d="M10 18h4"/>',
  chat: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
  cloud: '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
  laptop: '<path d="M20 16V7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v9m16 0H4m16 0 1.28 2.55a1 1 0 0 1-.9 1.45H3.62a1 1 0 0 1-.9-1.45L4 16"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  coins: '<circle cx="8" cy="8" r="6"/><path d="M18.09 10.37A6 6 0 1 1 10.34 18"/><path d="M7 6h1v4"/><path d="m16.71 13.88.7.71-2.82 2.82"/>',
  key: '<path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z"/><circle cx="16.5" cy="7.5" r=".5" fill="currentColor"/>',
  external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  copy: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  play: '<polygon points="6 3 20 12 6 21 6 3"/>',
  file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  hand: '<path d="M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2"/><path d="M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2"/><path d="M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>',
  sparkles: '<path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/>',
  chevronRight: '<path d="m9 18 6-6-6-6"/>',
  arrowRight: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  pencil: '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
  flask: '<path d="M10 2v7.31"/><path d="M14 9.3V1.99"/><path d="M8.5 2h7"/><path d="M14 9.3a6.5 6.5 0 1 1-4 0"/><path d="M5.52 16h12.96"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
  layoutGrid: '<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  arrowLeft: '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
  list: '<path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/>',
  target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  chart: '<path d="M3 3v18h18"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>',
  pause: '<rect x="14" y="4" width="4" height="16" rx="1"/><rect x="6" y="4" width="4" height="16" rx="1"/>',
};
export function icon(name, cls = "size-4") {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="${cls}" aria-hidden="true">${ICONS[name] ?? ""}</svg>`;
}
export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
export const PX = "font-[family-name:var(--font-pixel)] uppercase tracking-wider";
export const BTN = `${PX} flex w-full items-center justify-center gap-1.5 rounded-lg bg-[#4f5bd5] px-3 py-3 text-[9px] text-white shadow-md shadow-[#4f5bd5]/20 transition-all hover:bg-[#3f4bc5] disabled:opacity-40`;
export const BTN2 = `${PX} flex w-full items-center justify-center gap-1.5 rounded-lg border-2 border-foreground/15 bg-card px-3 py-2.5 text-[8px] text-foreground/70 transition-all hover:border-foreground/30 hover:text-foreground`;
export const CARD = "rounded-xl border-2 border-foreground/10 bg-card";
export const LABEL = `${PX} text-[7px] text-foreground/40`;
// Teamly Dollars: the same wallet as on the Teamly site (USD)
const DEV = new URLSearchParams(location.search).has("dev");  // prototype controls: ?dev=1
// Teamly Dollars formatting below
// money: dollars and cents; an amount under a cent is never shown as $0 (a paid call, a wallet that is almost empty)
export const cr = (n) => {
  const raw = Number(n || 0);
  if (raw !== 0 && Math.abs(raw) < 0.005) return `${raw < 0 ? "−" : ""}<$0.01`;
  const v = Math.round(raw * 100) / 100;
  return `${v < 0 ? "−" : ""}$${Math.abs(v).toFixed(v % 1 ? 2 : 0)}`;
};
// what the key really holds, from the Teamly API (money.js): never the prototype's local demo balance
export const money = () => moneyOf(S);
// a sprite name comes from files other people wrote: only a plain name goes into the address
export const spriteName = (s) => (typeof s === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(s) ? s : null);
export const avatar = (sprite, cls = "size-9") => spriteName(sprite)
  ? `<img src="./assets/profiles/${spriteName(sprite)}.png" alt="" class="${cls} shrink-0 rounded-md border-2 border-foreground/10 bg-white object-cover" />`
  : `<div class="${cls} flex shrink-0 items-center justify-center rounded-md border-2 border-dashed border-[#4f5bd5]/40 bg-[#4f5bd5]/5 text-[#4f5bd5]">${icon("hand", "size-4")}</div>`;
export const minsAgo = (ms) => {
  const m = Math.max(0, Math.round((Date.now() - ms) / 60000));
  if (!Number.isFinite(m)) return "";
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 24 * 60 ? `${Math.round(m / 60)} h ago`
    : new Date(ms).toLocaleDateString([], { day: "numeric", month: "short" });
};

// ---------------------------------------------------------------- state
const UI_KEY = "teamly-v2:ui";
function loadUI() { try { return JSON.parse(localStorage.getItem(UI_KEY)) ?? {}; } catch { return {}; } }
const ui = Object.assign({ onboarded: false, entry: null, goal: null, hired: [], run: null, dept: null, liveView: true, suggested: null, analysis: null, teamName: null, mockOb: null }, loadUI());
// The panel's state also lives on disk (~/.teamly/ui.json via the local server): each chat's side panel has its own
// browser storage and the server can be restarted, so the file is what survives. Saved a moment after the last change.
let syncTimer = null;
const screensToKeep = () => ({ library: pickKeys(screenLocal.library, ["area", "q"]), building: pickKeys(screenLocal.building, ["office"]), floor: pickKeys(screenLocal.floor, ["view"]) });
let keptScreens = "";
function syncUI() {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    const screens = screensToKeep();
    keptScreens = JSON.stringify(screens);
    A.live.uiSave({ ui, wallet: A.wallet.data, screens }).catch(() => { /* server down: browser storage still has it */ });
  }, 400);
}
// screens change their own filters (library floor, office building) without saveUI: save when those change
function syncScreensIfChanged() { if (JSON.stringify(screensToKeep()) !== keptScreens) syncUI(); }
const pickKeys = (o, keys) => Object.fromEntries(keys.filter((k) => o?.[k] !== undefined).map((k) => [k, o[k]]));
export function saveUI() { try { localStorage.setItem(UI_KEY, JSON.stringify(ui)); } catch { /* no storage */ } syncUI(); }

let S = null; // server state (live)
let serverError = null;
const screenLocal = {};

let seenVersion = null;
async function refreshLive() {
  try {
    S = A.cleanState(await A.live.state()); serverError = null; A.setLibrary(S.library);
    // the server started again on another version (an update or a rollback): load that version's panel too
    if (seenVersion && S.version && S.version !== seenVersion) location.reload();
    seenVersion = S.version ?? seenVersion;
  } catch (e) { serverError = e.message; }
}

// Reel entry: the coordinator opens the panel as /?entry=reel&agent=mark&task=...
(function readEntryFromUrl() {
  const q = new URLSearchParams(location.search);
  if (q.get("entry") === "reel" && A.agentBySlug[q.get("agent")]) {
    ui.entry = { kind: "reel", agent: q.get("agent"), task: q.get("task") || A.agentBySlug[q.get("agent")].firstTask };
    Object.assign(ui, { onboarded: false, dept: null, run: null, goal: null, suggested: null, analysis: null });
    saveUI();
    history.replaceState(null, "", location.pathname + "#/start");
  }
})();

// ---------------------------------------------------------------- overlays
let toastTimer;
export function toast(text) {
  const root = document.getElementById("toast-root");
  root.innerHTML = `<div class="pointer-events-auto max-w-sm rounded-lg bg-foreground px-3 py-2 text-xs text-background shadow-lg animate-[bubbleIn_0.25s_ease-out_both]"></div>`;
  root.firstElementChild.textContent = text;  // plain text: prompts and STATUS lines end up here
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { root.innerHTML = ""; }, 2800);
}
export function openSheet(html, onMount) {
  const root = document.getElementById("sheet-root");
  root.innerHTML = `
    <div data-sheet-backdrop class="fixed inset-0 z-40 bg-black/30 animate-[fadeIn_0.2s_ease-out_both]"></div>
    <div class="fixed inset-x-0 bottom-0 z-50 max-h-[88dvh] overflow-y-auto rounded-t-2xl border-t-2 border-border bg-card shadow-xl animate-[sheetUp_0.25s_ease-out_both]">
      <div class="sticky top-0 z-10 flex justify-center bg-card pt-2 pb-1">
        <div class="h-1 w-10 rounded-full bg-foreground/15"></div>
        <button data-sheet-close class="absolute right-3 top-1.5 rounded p-1 text-foreground/40 hover:bg-muted hover:text-foreground">${icon("x", "size-4")}</button>
      </div>
      <div class="px-4 pb-6">${html}</div>
    </div>`;
  root.querySelector("[data-sheet-backdrop]").onclick = closeSheet;
  root.querySelector("[data-sheet-close]").onclick = closeSheet;
  onMount?.(root);
}
export function closeSheet() { document.getElementById("sheet-root").innerHTML = ""; }

async function writeClipboard(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall back */ }
  try {
    const ta = Object.assign(document.createElement("textarea"), { value: text });
    ta.style.cssText = "position:fixed;opacity:0";
    document.body.append(ta); ta.select();
    const ok = document.execCommand("copy"); ta.remove(); return ok;
  } catch { return false; }
}
// The panel can't write into the chat: show the prompt, copy it, tell the person where to paste.
export async function copyPrompt(title, prompt, { note = "", then } = {}) {
  const ok = await writeClipboard(prompt);
  openSheet(`
    <p class="${LABEL}">Paste into the coordinator chat</p>
    <h2 class="mt-2 text-[15px] font-semibold text-foreground">${esc(title)}</h2>
    <div class="mt-3 rounded-lg border-2 border-[#4f5bd5]/25 bg-[#4f5bd5]/5 p-3 font-mono text-[12px] leading-relaxed text-foreground select-all">${esc(prompt)}</div>
    <p class="mt-2 text-[12px] ${ok ? "text-emerald-600" : "text-amber-600"}">${ok ? "Copied. Paste it into the chat on the left and press Enter." : "Select the text above and copy it, then paste it into the chat."}</p>
    ${note ? `<p class="mt-2 text-[12px] text-muted-foreground">${note}</p>` : ""}
    <div class="mt-4 flex flex-col gap-2">
      <button data-copy-again class="${BTN2}">${icon("copy", "size-3")} Copy again</button>
      <button data-copy-done class="${BTN}">Done</button>
    </div>`, (root) => {
    root.querySelector("[data-copy-again]").onclick = async () => toast((await writeClipboard(prompt)) ? "Copied" : "Copy blocked — select the text");
    root.querySelector("[data-copy-done]").onclick = () => { closeSheet(); then?.(); };
  });
}

// ---------------------------------------------------------------- the chat is the only input
// The panel can't type into the Claude Code chat. Every decision is a question the coordinator asks IN THE CHAT
// (AskUserQuestion: a card with buttons). The panel mirrors that question so you see where you are.
// Prototype: the mirrored options are clickable and simulate your answer, so the path can be walked without the chat.
export function chatAsk(question, options, { demo = true, note = "" } = {}) {
  const row = (o) => `<span class="min-w-0 flex-1"><span class="block text-[13px] font-medium leading-snug">${esc(o.label)}</span>${o.sub ? `<span class="mt-0.5 block text-[11px] leading-snug text-foreground/50">${esc(o.sub)}</span>` : ""}</span>`;
  return `
  <div class="mt-3 rounded-xl border-2 border-[#4f5bd5]/30 bg-[#4f5bd5]/[0.04] p-3.5 animate-[fadeSlideUp_0.35s_ease-out_both]">
    <div class="flex items-center gap-2">
      ${avatar("formal01", "size-7")}
      <p class="text-[12px] font-semibold">Coordinator</p>
      <span class="ml-auto inline-flex items-center gap-1 rounded-md bg-[#4f5bd5] px-2 py-1 text-[11px] font-medium text-white">${icon("arrowLeft", "size-3.5")} Answer in the chat</span>
    </div>
    <p class="mt-2.5 text-[15px] font-semibold leading-snug">${esc(question)}</p>
    ${note ? `<p class="mt-1 text-[12px] leading-snug text-muted-foreground">${note}</p>` : ""}
    <details class="mt-3"><summary class="cursor-pointer text-[11px] text-foreground/45">${icon("flask", "inline size-3")} Prototype: simulate your answer</summary>
    <div class="mt-2 flex flex-col gap-1.5">
      ${options.map((o) => demo
        ? `<button data-sim="${o.id}" class="flex items-start gap-2 rounded-lg border-2 border-dashed border-foreground/15 bg-card px-3 py-2 text-left transition-colors hover:border-[#4f5bd5]/50">${row(o)}</button>`
        : `<div class="flex items-start gap-2 rounded-lg border-2 border-foreground/10 bg-card px-3 py-2">${row(o)}</div>`).join("")}
    </div></details>
  </div>`;
}

// What the coordinator does after you answer "yes" in the chat: installs the agents, opens their chats, starts the task.
export async function simulateHire(ctx, slugs, { teamId, task, start = true } = {}) {
  for (const slug of slugs) {
    const a = A.agentBySlug[slug];
    if (a?.installable) await A.live.hire(slug).catch(() => {});
    if (!ui.hired.includes(slug)) ui.hired.push(slug);
  }
  if (teamId) { ui.dept = teamId; ui.teamName ??= A.teamById[teamId].name; }
  ui.suggested = null; ui.onboarded = true;
  if (start) {
    const chain = teamId ? A.teamById[teamId].chain : slugs;
    ui.run = A.newRun(chain, task ?? A.agentBySlug[slugs[0]].firstTask);
    ui.liveView = false;
  }
  saveUI();
  await refreshLive();
  toast(start ? "Hired and started — the first agent is working" : "Hired");
  if (location.hash === "#/team") render(); else location.hash = "#/team";
}

// ---------------------------------------------------------------- shared flows
export function isHired(slug) {
  const live = (S?.teams ?? []).flatMap((t) => (Array.isArray(t.agents) ? t.agents : []));
  if (live.length) return live.some((a) => a.slug === slug || a.upstream === slug || a.card?.upstream === slug);
  return ui.hired.includes(slug) || (S?.installed ?? []).some((i) => i.slug === slug && i.ours);
}
// Hire = install skill(s) via the server (live for agents in teamly-skill-v2/agents) + one prompt for the coordinator,
// then the first task is proposed right away so the person never lands in an empty chat.
export async function hireFlow(ctx, slugs, { task, title, teamId } = {}) {
  const results = [];
  for (const slug of slugs) {
    const a = A.agentBySlug[slug];
    if (!a) continue;
    if (a.installable) {
      try { const r = await A.live.hire(slug); results.push({ slug, path: r.path, live: true }); }
      catch (e) { results.push({ slug, error: e.message }); }
    } else results.push({ slug, live: false });
    if (!ui.hired.includes(slug)) ui.hired.push(slug);
  }
  if (teamId) ui.dept = teamId;
  saveUI();
  await refreshLive();
  firstTaskSheet(ctx, slugs, { task, title, results, teamId });
}

function chainOf(slugs, teamId) { return teamId ? A.teamById[teamId].chain : slugs; }

export function firstTaskSheet(ctx, slugs, { task, title, results = [], teamId } = {}) {
  const agents = slugs.map((s) => A.agentBySlug[s]).filter(Boolean);
  const chain = chainOf(slugs, teamId);
  const estimate = chain.reduce((s, x) => s + (A.agentBySlug[x]?.cost ?? 0), 0);
  const m = money();
  const enough = !estimate || (m.balance ?? 0) >= estimate;
  const names = agents.map((a) => a.name).join(", ");
  const head = title ?? (agents.length === 1 ? `${agents[0].name} is hired` : `${names} are hired`);
  const rows = results.map((r) => {
    const a = A.agentBySlug[r.slug];
    const tag = r.error ? `<span class="text-red-500">${esc(r.error)}</span>`
      : r.live ? `<span class="text-emerald-600">skill installed</span>` : `<span class="text-foreground/40">mock — no package yet</span>`;
    return `<div class="flex items-center gap-2 py-1">${avatar(a.sprite, "size-6")}<span class="text-[12px] font-medium">${esc(a.name)}</span><span class="ml-auto text-[11px]">${tag}</span></div>`;
  }).join("");
  openSheet(`
    <div class="flex items-center gap-2">${icon("check", "size-4 text-emerald-500")}<h2 class="text-[15px] font-semibold">${esc(head)}</h2></div>
    ${rows ? `<div class="mt-2 rounded-lg border-2 border-foreground/10 px-3 py-1.5">${rows}</div>` : ""}
    ${results.some((r) => r.live) && S?.sandbox ? `<p class="mt-1.5 text-[11px] text-foreground/40">Prototype: installed into the sandbox folder, not ~/.claude/skills.</p>` : ""}
    <p class="${LABEL} mt-5">First task</p>
    <textarea id="first-task" rows="3" class="mt-2 w-full resize-none rounded-lg border-2 border-foreground/15 bg-card p-2.5 text-[13px] leading-snug outline-none focus:border-[#4f5bd5] focus:shadow-[2px_2px_0_0_#4f5bd5]">${esc(task ?? agents[0]?.firstTask ?? "")}</textarea>
    <div class="mt-3 flex items-center justify-between rounded-lg ${enough ? "bg-muted" : "bg-red-50"} px-3 py-2.5 text-[12px]">
      <span class="text-foreground/70">This task will spend <b class="text-foreground">~${cr(estimate)}</b></span>
      <span class="${enough ? "text-foreground/60" : "font-semibold text-red-600"}">balance ${m.balance == null ? "…" : cr(m.balance)}</span>
    </div>
    <p class="mt-1.5 text-[11px] text-foreground/45">Teamly Dollars pay only for tools (search, render). The agents' own work runs on your Claude subscription.</p>
    <div class="mt-4 flex flex-col gap-2">
      ${enough
        ? `<button data-run class="${BTN}">${icon("play", "size-3")} Run</button>`
        : `<button data-topup class="${BTN}">Top up to run</button><button data-run class="${BTN2}">Run anyway — pause when credits end</button>`}
      <button data-later class="${PX} py-2 text-[7px] text-foreground/40 hover:text-foreground/70">Later</button>
    </div>`, (root) => {
    root.querySelector("[data-later]").onclick = () => { closeSheet(); ctx.go("team"); };
    root.querySelector("[data-topup]")?.addEventListener("click", () => A.live.openUrl(m.real ? "topup" : "key")
      .then(() => toast(m.real ? "Top up on the site, then come back: the balance updates by itself" : "Get your Teamly key on the site"))
      .catch((e) => toast(e.message)));
    root.querySelector("[data-run]").onclick = () => {
      const t = root.querySelector("#first-task").value.trim() || agents[0]?.firstTask;
      const who = teamId ? `the ${A.teamById[teamId].name} team (${names})` : `${names}`;
      const prompt = `Teamly: hire ${who} into this department and start the first task: "${t}"`;
      ui.run = A.newRun(chain, t);
      ui.onboarded = true;
      saveUI();
      copyPrompt("Hire and start", prompt, {
        note: "One message does both: the coordinator opens a chat for each agent and hands the task to the first one.",
        then: () => { ui.liveView = false; saveUI(); ctx.go("team"); },
      });
    };
  });
}

export async function fireFlow(ctx, slug) {
  const a = A.agentBySlug[slug];
  if (a?.installable) { try { await A.live.fire(slug); } catch { /* not installed by us */ } }
  ui.hired = ui.hired.filter((s) => s !== slug);
  saveUI();
  await refreshLive();
  copyPrompt(`Remove ${a.name}`, `Teamly: remove ${a.name} from this department and close their chat.`, { then: () => render() });
}

// Top up: real version opens the Polar checkout on teamly.to; the prototype adds credits after a fake checkout.
export function topUpSheet(ctx, after) {
  const packs = [10, 25, 50];
  openSheet(`
    <p class="${LABEL}">Top up</p>
    <h2 class="mt-2 text-[15px] font-semibold">Add Teamly credits</h2>
    <p class="mt-1 text-[12px] text-muted-foreground">1 credit = $1. Paid on teamly.to (Polar).</p>
    <div class="mt-4 grid grid-cols-3 gap-2">
      ${packs.map((p, i) => `<button data-pack="${p}" class="rounded-xl border-2 ${i === 1 ? "border-[#4f5bd5] shadow-[2px_2px_0_0_#4f5bd5]" : "border-foreground/10"} px-2 py-3 text-center hover:border-[#4f5bd5]">
        <p class="text-[18px] font-bold">$${p}</p><p class="${PX} mt-1 text-[6px] text-foreground/40">${p} cr</p></button>`).join("")}
    </div>
    ${A.teamById.content ? `<p class="mt-3 text-[11px] text-foreground/45">A reel costs ~${cr(A.teamCost(A.teamById.content))}: $25 ≈ ${Math.floor(25 / A.teamCost(A.teamById.content))} reels.</p>` : ""}
    <button data-polar class="${BTN} mt-4">Pay on teamly.to ${icon("external", "size-3")}</button>
    <p class="mt-2 text-center text-[10px] text-foreground/35">Prototype: no real payment. Credits are added here after a fake checkout.</p>`, (root) => {
    let pack = 25;
    root.querySelectorAll("[data-pack]").forEach((b) => {
      b.onclick = () => {
        pack = Number(b.dataset.pack);
        root.querySelectorAll("[data-pack]").forEach((x) => { x.className = x.className.replace("border-[#4f5bd5] shadow-[2px_2px_0_0_#4f5bd5]", "border-foreground/10"); });
        b.className = b.className.replace("border-foreground/10", "border-[#4f5bd5] shadow-[2px_2px_0_0_#4f5bd5]");
      };
    });
    root.querySelector("[data-polar]").onclick = () => {
      A.wallet.topUp(pack);
      closeSheet();
      toast(`+${pack} credits · balance ${cr(A.wallet.balance)}`);
      render();
      after?.();
    };
  });
}

// ---------------------------------------------------------------- ctx
function tabFromHash() {
  const t = location.hash.replace(/^#\/?/, "").split("?")[0];
  return SCREENS[t] ? t : null;
}
function buildCtx() {
  return {
    S, ui, A, saveUI, refreshLive,
    icon, esc, PX, BTN, BTN2, CARD, LABEL, cr, money, avatar, minsAgo,
    local: (name) => (screenLocal[name] ??= {}),
    go: (tab) => { if (location.hash === `#/${tab}`) render(); else location.hash = `#/${tab}`; },
    rerender: () => renderMain(),
    refresh: () => render(),
    toast, openSheet, closeSheet, copyPrompt, hireFlow, fireFlow, firstTaskSheet, topUpSheet, isHired, chatAsk, simulateHire,
    sendToCoordinator,
  };
}

// ---------------------------------------------------------------- key gate
const INPUT_BOX = "flex h-10 min-w-0 items-center gap-2 rounded-md border-2 border-foreground/15 bg-card px-2.5 transition-all focus-within:border-[#4f5bd5] focus-within:shadow-[2px_2px_0_0_#4f5bd5]";
const INPUT = "w-full min-w-0 bg-transparent font-mono text-[12px] text-foreground outline-none placeholder:font-[family-name:var(--font-pixel)] placeholder:text-[7px] placeholder:tracking-wider placeholder:text-muted-foreground/45";
function keyGate() {
  return `
  <div class="flex min-h-full flex-col items-center justify-center px-6 py-10 animate-[fadeSlideUp_0.5s_ease-out_both]">
    <img src="./assets/agents/formal01.png" alt="" class="size-24 object-contain animate-[pixelBob_3s_ease-in-out_infinite]" />
    <h1 class="${PX} mt-4 text-[12px] text-foreground">Connect Teamly</h1>
    <p class="mt-3 max-w-xs text-center text-[13px] leading-relaxed text-muted-foreground">
      Sign in once and your agents get their tools: search, video, voice. You pay only for what the tools use.
    </p>
    <button id="sign-in" type="button" class="${BTN} mt-6 w-full max-w-xs">Sign in to Teamly</button>
    <p id="sign-in-note" class="mt-3 hidden max-w-xs text-center text-[12px] leading-relaxed text-muted-foreground">The Teamly site opened in your browser. Sign in there: the key comes back here by itself.</p>
    <button id="have-key" type="button" class="${PX} mt-5 text-[7px] text-foreground/45 hover:text-foreground/70">I have a key</button>
    <form id="key-form" class="mt-4 hidden w-full max-w-xs flex-col gap-2">
      <label class="${INPUT_BOX}">
        ${icon("key", "size-3.5 shrink-0 text-foreground/50")}
        <input id="key-input" type="password" autocomplete="new-password" spellcheck="false" placeholder="PASTE YOUR KEY" aria-label="Teamly key" class="${INPUT}" />
      </label>
      <p id="key-error" class="hidden text-[11px] text-red-500"></p>
      <button type="submit" class="${BTN}">Connect</button>
    </form>
    <p class="mt-4 max-w-xs text-center text-[12px] leading-relaxed text-muted-foreground">The agents' own work runs on your Claude subscription. Paid tools (live data, video, voice) take Teamly Dollars from the key's wallet — top up on the site when a tool needs it.</p>
    <button id="demo-key" type="button" class="${PX} mt-4 text-[7px] text-foreground/35 hover:text-foreground/60">Try with a demo key</button>
    <p class="mt-6 max-w-xs text-center text-[12px] text-muted-foreground">As soon as Teamly is connected, the coordinator in the chat on the left continues by itself.</p>
    <p class="mt-2 max-w-xs text-center text-[11px] text-muted-foreground/60">The key is saved on this computer in ~/.teamly/credentials.json.</p>
  </div>`;
}
function mountKeyGate(app) {
  const form = app.querySelector("#key-form");
  const input = app.querySelector("#key-input");
  const err = app.querySelector("#key-error");
  // no focus on the key field by default: the panel does not redraw while a field has focus, and the key from the
  // sign-in arrives from outside (the site sends it to /connect.html), so the gate must be free to switch at once
  form.onsubmit = async (e) => {
    e.preventDefault();
    try {
      const r = await A.live.saveKey(input.value.trim());
      await refreshLive();
      render();
      toast(r.reason === "demo" ? "Not a Teamly key: agents use free tools only. Sign in to Teamly for paid tools"
        : r.verified ? "Key connected · checking your Teamly Dollars" : "Key saved · Teamly can't be reached right now, it will check again");
    } catch (ex) { err.textContent = ex.message; err.classList.remove("hidden"); }
  };
  input.oninput = () => err.classList.add("hidden");
  app.querySelector("#sign-in").onclick = () => A.live.openUrl("key")
    .then(() => app.querySelector("#sign-in-note").classList.remove("hidden"))
    .catch((e) => toast(e.message));
  app.querySelector("#have-key").onclick = () => { form.classList.replace("hidden", "flex"); input.focus(); };
  app.querySelector("#demo-key").onclick = () => { form.classList.replace("hidden", "flex"); input.value = "tmly_demo_7c1e94f2a"; input.focus(); };
}

// ---------------------------------------------------------------- chrome
// One bar on top: brand, the tabs (Office / Library / Credits), prototype controls, balance. No bottom bar.
function topBar(ctx) {
  const m = money();
  const badKey = m.state === "rejected";
  const run = ui.run;
  const est = run ? A.runEstimate(run) : (A.teamById.content ? A.teamCost(A.teamById.content) : 1);
  const tone = badKey ? "border-amber-300 bg-amber-50 text-amber-700"
    : m.state === "real" && m.balance < 0.01 ? "border-red-300 bg-red-50 text-red-600"
    : m.state === "real" && m.balance < est ? "border-amber-300 bg-amber-50 text-amber-700" : "border-border/80 bg-card text-foreground";
  const balTitle = { real: "Teamly Dollars on your key", none: "This key isn't a Teamly key: no Teamly Dollars on it",
    rejected: "Teamly doesn't recognize this key", offline: "Teamly can't be reached right now", error: "Teamly answered with an error instead of your balance",
    checking: "Checking your Teamly Dollars…" }[m.state];
  const needs = ui.run && ["needs_you", "failed", "no_credits"].includes(ui.run.phase);
  const tabs = TABS.map((t) => {
    // an agent opened from the library belongs to the Library tab, one opened from a floor to the Office
    const fromLibrary = state.tab === "agent" && !!ui.agentRef?.library;
    const on = state.tab === t.id || (t.also.includes(state.tab) && !fromLibrary) || (t.id === "library" && fromLibrary);
    return `
    <a href="#/${t.id}" aria-label="${t.label}" class="relative flex h-8 items-center gap-1.5 rounded-lg px-2 transition-all ${on ? "bg-[#4f5bd5]/10 text-[#4f5bd5]" : "text-foreground/55 hover:bg-muted/80 hover:text-foreground"}">
      <span class="relative">${icon(t.icon, "size-4")}${t.id === "teams" && needs ? '<span class="absolute -right-1.5 -top-1 size-2 rounded-full bg-red-500"></span>' : ""}</span>
      <span class="${PX} hidden text-[7px] min-[480px]:inline">${t.label}</span>
      ${on ? '<span class="absolute -bottom-[9px] left-2 right-2 h-0.5 rounded-full bg-[#4f5bd5]"></span>' : ""}
    </a>`;
  }).join("");
  return `
  <header class="relative z-30 flex h-[var(--topbar-h)] shrink-0 items-center gap-1.5 border-b border-border/60 bg-card px-3">
    <a href="#/teams" aria-label="Back to the office" title="${S?.version ? `Teamly ${esc(S.version)} · ` : ""}back to the office" class="${PX} mr-1 text-[9px] text-[#4f5bd5] hover:opacity-75">Teamly</a>
    <nav class="flex min-w-0 items-center gap-0.5">${tabs}</nav>
    <button id="founder-btn" aria-label="Talk to the founder" title="Something broke or an idea? Talk to the founder" class="ml-auto flex h-7 shrink-0 items-center gap-1 rounded-md border border-foreground/15 px-2 text-[11px] text-foreground/60 hover:border-[#4f5bd5]/50 hover:text-[#4f5bd5]">${icon("chat", "size-3.5")}<span class="${PX} hidden text-[7px] min-[560px]:inline">Feedback</span></button>
    ${DEV ? `<button id="demo-btn" aria-label="Prototype controls" class="flex size-7 shrink-0 items-center justify-center rounded-md border border-dashed border-foreground/25 text-foreground/40 hover:text-foreground">${icon("flask", "size-3.5")}</button>` : ""}
    <button id="bal-btn" aria-label="Wallet" title="${balTitle}" class="${PX} flex shrink-0 items-center gap-1.5 rounded-lg border-2 px-2 py-1.5 text-[8px] ${tone}">
      ${icon(badKey ? "alert" : "coins", "size-3.5")} ${badKey ? "Key?" : m.balance == null ? "$…" : cr(m.balance).replace("−", "-")}
    </button>
  </header>`;
}

// Demo controls: walk the moments that the live task can't show on demand.
// Feedback goes to the founder personally: a bug is written up by the coordinator (it knows what happened and keeps
// private data out), an idea too; direct contacts come from founder.json. The panel never sends anything itself.
// Asking the coordinator: the request is copied, and the person sees which chat it goes to before the app switches
// (the panel of that chat is a different one: an unannounced jump feels like the panel crashed).
export function sendToCoordinator(ctx, prompt, { title = "Ask your coordinator", what = "" } = {}) {
  navigator.clipboard?.writeText(prompt).catch(() => {});
  // the floor it was pressed on, and only that floor: another team's coordinator would act on the wrong team
  const team = S?.teams?.find((t) => t.slug === ui.teamSlug) ?? (S?.teams?.length === 1 ? S.teams[0] : null);
  if (!team?.coordinator_session) { toast(`Copied: ${prompt} — paste it in ${team ? `${team.name ?? team.slug}'s` : "your Teamly"} chat`); return; }
  if (team.coordinator_session === A.hostChat) { toast("Copied — paste it in the chat on the left"); return; }
  openSheet(`
    <p class="${LABEL}">${esc(title)}</p>
    ${what ? `<p class="mt-2 text-[13px] leading-snug">${what}</p>` : ""}
    <div class="mt-3 border-2 border-foreground/10 bg-muted px-3 py-2 font-mono text-[12px]">${esc(prompt)}</div>
    <p class="mt-2 text-[12px] leading-snug text-foreground/60">Copied. It goes to the coordinator of <b>${esc(team.name ?? team.slug)}</b>: its own chat opens — paste it there. The panel of that chat opens on its side.</p>
    <div class="mt-4 flex flex-col gap-2">
      <button data-go-chat class="${BTN}">Open ${esc(team.name ?? "the team")}'s chat</button>
      <button data-just-copy class="${BTN2}">Just copy, I'll paste it myself</button>
    </div>`, (root) => {
    root.querySelector("[data-go-chat]").onclick = () => {
      closeSheet();
      A.live.openChat(team.coordinator_session).catch(() => toast(`Couldn't open the chat. Copied: ${prompt}`));
    };
    root.querySelector("[data-just-copy]").onclick = () => { closeSheet(); toast("Copied"); };
  });
}
// Where this person is in the test: the first time they reached each step (from ~/.teamly/funnel.json).
function funnelBlock() {
  const f = S?.funnel;
  if (!f?.steps) return "";
  const done = f.steps.filter((x) => x.at).length;
  return `
    <details class="mt-4 rounded-xl border-2 border-foreground/10 p-3">
      <summary class="cursor-pointer text-[12.5px] font-semibold">Your Teamly so far · ${done}/${f.steps.length} steps</summary>
      <ol class="mt-2 flex flex-col gap-1">
        ${f.steps.map((x) => `<li class="flex items-center gap-2 text-[12px] ${x.at ? "" : "text-foreground/40"}"><span class="flex size-4 shrink-0 items-center justify-center rounded-full ${x.at ? "bg-emerald-500 text-white" : "border-2 border-foreground/20"}">${x.at ? icon("check", "size-2.5") : ""}</span><span class="flex-1">${esc(x.label)}</span>${x.at ? `<span class="text-[10.5px] text-foreground/40">${new Date(x.at * 1000).toLocaleDateString([], { day: "numeric", month: "short" })}</span>` : ""}</li>`).join("")}
      </ol>
      <button data-copy-stats class="${BTN2} mt-2.5">Copy my stats for Igor</button>
    </details>`;
}

function founderSheet(ctx) {
  const f = S?.founder ?? {};
  const links = [f.telegram ? `<a href="https://t.me/${esc(String(f.telegram).replace(/^@/, ""))}" target="_blank" rel="noopener" class="${BTN2}">Telegram ${esc(f.telegram)}</a>` : "",
    f.email ? `<a href="mailto:${esc(f.email)}?subject=${encodeURIComponent("Teamly feedback")}" class="${BTN2}">${esc(f.email)}</a>` : ""].join("");
  openSheet(`
    <div class="flex items-center gap-3 pt-2">
      <img src="./assets/agents/formal01.png" alt="" class="size-14 object-contain" />
      <div><p class="text-[16px] font-semibold">Talk to ${esc((f.name ?? "the founder").split(" ")[0])}, the founder</p><p class="text-[12px] text-foreground/55">${esc(links ? f.promise ?? "Reads every message himself" : "Your report is saved on this computer; send it the way you know the team")}</p></div>
    </div>
    <p class="mt-3 text-[13px] leading-snug">Something broke, an agent did a poor job, or you have an idea — write. The coordinator writes it up with what happened (no keys, no personal files) and shows it to you before anything is sent.</p>
    <div class="mt-4 flex flex-col gap-2">
      <button data-fb="bug" class="${BTN}">Report a bug</button>
      <button data-fb="idea" class="${BTN2}">Share an idea or a complaint</button>
      ${links ? `<p class="${LABEL} mt-2">Or directly</p>${links}` : ""}
    </div>
    ${funnelBlock()}
    ${versionLabel(S?.version, esc)}`, (root) => {
    root.querySelector("[data-copy-stats]")?.addEventListener("click", async () => {
      const f = S?.funnel ?? {};
      const lines = [`Teamly test stats · v${S?.version ?? "?"} · ${navigator.platform || "?"}`, ...(f.steps ?? []).map((x) => `${x.at ? "✓" : "·"} ${x.label}${x.at ? ` — ${new Date(x.at * 1000).toLocaleString()}` : ""}`),
        `Floors ${f.counts?.floors ?? 0} · agents ${f.counts?.agents ?? 0} · tasks ${f.counts?.tasksDone ?? 0}/${f.counts?.tasks ?? 0} done · ratings ${f.counts?.ratings ?? 0}${f.counts?.avgStars ? ` (avg ${f.counts.avgStars}★)` : ""}`];
      try { await navigator.clipboard.writeText(lines.join("\n")); toast("Copied — send it to Igor"); } catch { toast("Couldn't copy"); }
    });
    root.querySelector('[data-fb="bug"]').onclick = () => { closeSheet(); sendToCoordinator(ctx, "Teamly: report a bug"); };
    root.querySelector('[data-fb="idea"]').onclick = () => { closeSheet(); sendToCoordinator(ctx, "Teamly: feedback"); };
  });
}

function demoSheet(ctx) {
  openSheet(`
    <p class="${LABEL}">Prototype controls</p>
    <div class="mt-3 flex flex-col gap-2">
      <button data-d="obnext" class="${BTN}">Onboarding: next step (as the coordinator)</button>
      <button data-d="general" class="${BTN2}">Restart: new user (from the key)</button>
      <button data-d="reel" class="${BTN2}">Restart: entry from a reel (Mark)</button>
      <button data-d="live" class="${BTN2}">Show my live department (Content Dep)</button>
      <button data-d="low" class="${BTN2}">Set balance to 0.80 cr</button>
      <button data-d="credits" class="${BTN2}">Reset demo balance to ${cr(A.STARTER_CREDITS)}</button>
      <button data-d="nokey" class="${BTN2}">Disconnect key (see the connect screen)</button>
    </div>`, (root) => {
    const act = {
      general: async () => {
        for (const i of S?.installed ?? []) if (i.ours) await A.live.fire(i.slug).catch(() => {});
        Object.assign(ui, { onboarded: false, entry: null, goal: null, hired: [], run: null, dept: null, suggested: null, analysis: null, teamName: null, mockOb: null });
        A.wallet.reset();
        await A.live.removeKey().catch(() => {});
        await refreshLive();
      },
      reel: async () => {
        for (const i of S?.installed ?? []) if (i.ours) await A.live.fire(i.slug).catch(() => {});
        Object.assign(ui, { onboarded: false, entry: { kind: "reel", agent: "mark", task: A.agentBySlug.mark.firstTask }, goal: null, hired: [], run: null, dept: null, suggested: null, analysis: null });
        await refreshLive();
      },
      obnext: async () => {
        const i = ui.mockOb ? A.MOCK_ONBOARDING.findIndex((x) => x === ui.mockOb || JSON.stringify(x) === JSON.stringify(ui.mockOb)) : -1;
        ui.mockOb = A.MOCK_ONBOARDING[Math.min(i + 1, A.MOCK_ONBOARDING.length - 1)];
        ui.onboarded = true;
        if (ui.mockOb.step === "started") {
          ui.teamName = ui.mockOb.team.name;
          ui.run = A.newRun(ui.mockOb.team.chain, ui.mockOb.team.firstTask);
          ui.liveView = false;
        }
      },
      live: () => { Object.assign(ui, { onboarded: true, entry: null, dept: "content", hired: ["mark", "riley", "james"], liveView: true, suggested: null, teamName: "Content" }); },
      low: () => A.wallet.set(0.8),
      credits: () => A.wallet.reset(),
      nokey: async () => { await A.live.removeKey(); await refreshLive(); },
    };
    root.querySelectorAll("[data-d]").forEach((b) => {
      b.onclick = async () => {
        const k = b.dataset.d;
        await act[k]();
        saveUI(); closeSheet();
        if (k === "general" || k === "live" || k === "obnext") location.hash = "#/team";
        if (k === "reel") location.hash = "#/start";
        if (k === "samples") location.hash = "#/library";
        render();
      };
    });
  });
}

// ---------------------------------------------------------------- render
const state = { tab: "start" };
let cleanup;
let drawn = null;  // the live data the screen was last drawn from
function renderMain() {
  drawn = JSON.stringify(S);
  if (ui.lastTab !== state.tab) { ui.lastTab = state.tab; saveUI(); }
  const ctx = buildCtx();
  const main = document.getElementById("screen");
  if (!main) return;
  const keepScroll = main.dataset.tab === state.tab ? main.scrollTop : 0;
  // sideways scroll too (the board's columns): a live update must not throw the person back to the first column
  const sideways = main.dataset.tab === state.tab ? [...main.querySelectorAll("[data-keep-x]")].map((el) => [el.dataset.keepX, el.scrollLeft]) : [];
  cleanup?.();
  const screen = SCREENS[state.tab];
  try {
    main.innerHTML = screen.render(ctx);
    main.dataset.tab = state.tab;
    main.scrollTop = keepScroll;
    for (const [id, x] of sideways) { const el = main.querySelector(`[data-keep-x="${id}"]`); if (el) el.scrollLeft = x; }
    cleanup = screen.mount?.(main, ctx);
  } catch (e) {  // one odd record must not blank the panel: say so here, the other screens keep working
    console.error(e);
    cleanup = undefined;
    main.innerHTML = `<div class="m-4 border-2 border-amber-400 bg-amber-50 p-4 text-[12.5px] leading-snug text-amber-900">This screen hit a problem and can't be drawn: ${esc(e?.message ?? e)}. The other screens work. To report it, press Feedback and copy this message into the report.</div>`;
  }
  syncScreensIfChanged();
}
export function render() {
  drawn = JSON.stringify(S);
  const app = document.getElementById("app");
  if (!S) {
    app.innerHTML = `<main class="flex flex-1 items-center justify-center p-8 text-center text-[13px] text-muted-foreground">${serverError ? `Teamly server is not answering (${esc(serverError)}).<br/>Start it: python3 server.py` : "Loading…"}</main>`;
    return;
  }
  if (!S.key?.connected) {
    cleanup?.(); cleanup = undefined;
    app.innerHTML = `<main class="min-h-0 flex-1 overflow-y-auto">${keyGate()}</main>`;
    mountKeyGate(app);
    return;
  }
  const asked = tabFromHash();
  // Entry from a reel skips onboarding: its landing screen comes first. Everyone else lands on Team.
  if (ui.entry?.kind === "reel" && !ui.onboarded) state.tab = asked && asked !== "teams" ? asked : "start";
  else state.tab = asked && asked !== "start" ? asked : "teams";
  const ctx = buildCtx();
  app.innerHTML = `${topBar(ctx)}${updateStrip(S.update, ui.updateLater, esc)}<main id="screen" class="relative min-h-0 flex-1 overflow-y-auto"></main>`;
  app.querySelector("#bal-btn").onclick = () => ctx.go("credits");
  app.querySelector("[data-update]")?.addEventListener("click", () => sendToCoordinator(ctx, "Teamly: update"));
  app.querySelector("[data-update-later]")?.addEventListener("click", () => { ui.updateLater = S.update.latest; saveUI(); render(); });
  app.querySelector("#demo-btn")?.addEventListener("click", () => demoSheet(ctx));
  app.querySelector("#founder-btn").onclick = () => founderSheet(ctx);
  renderMain();
}

window.addEventListener("hashchange", () => { closeSheet(); render(); });
// Back after being away (e.g. topping up on the site): ask Teamly for the balance once. The app's pane repeats
// "visible" every couple of seconds while nothing changed, so only a real return counts, at most every 30 s.
let hiddenAt = 0, walletAskedAt = 0;
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") { hiddenAt = Date.now(); return; }
  const back = hiddenAt && Date.now() - hiddenAt > 5000;
  hiddenAt = 0;
  if (back && S?.key?.connected && Date.now() - walletAskedAt > 30000) { walletAskedAt = Date.now(); A.live.refreshWallet().catch(() => {}); }
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeSheet(); });

// An open panel whose server stopped answering keeps its last picture: it says so instead of looking live.
function offlineNote(on) {
  const n = document.getElementById("offline-note");
  if (!on) { n?.remove(); return; }
  if (n) return;
  const note = Object.assign(document.createElement("div"), {
    id: "offline-note",
    className: "fixed inset-x-0 bottom-0 z-50 border-t-2 border-[#0a0a0a] bg-amber-50 px-4 py-2 text-center text-[12px] text-amber-900",
    textContent: "The Teamly panel server is not answering. This is the last thing it showed; it updates again when the server is back.",
  });
  document.body.append(note);
}

// Poll live data every 5 s; re-render only the screen, and only when no sheet is open.
setInterval(async () => {
  await refreshLive();
  offlineNote(!!serverError && !!S);
  // Only real changes (a step finished, a file appeared) redraw the screen, never while you type or a sheet is open.
  // Compared with what the screen was drawn from, so a change that came while a sheet was open shows up after it closes.
  const typing = /^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName ?? "");
  if (JSON.stringify(S) === drawn || typing || document.getElementById("sheet-root").innerHTML) return;
  // the key arriving from the chat (install prompt) switches the whole panel, not just the screen
  const was = JSON.parse(drawn || "null");
  if (!was || was.key?.connected !== S?.key?.connected || JSON.stringify(was.update) !== JSON.stringify(S?.update) || !document.getElementById("screen")) render(); else renderMain();
}, 5000);

// ?fresh=1 — see the skill exactly as a brand-new user: no key, no agents, no team, no history.
// It deletes things, so it waits for your click: any web page can open this address, only you can press the button.
function confirmFresh() {
  return new Promise((resolve) => {
    const box = document.createElement("div");
    box.className = "fixed inset-0 z-[70] grid place-items-center bg-black/40 p-4";
    box.innerHTML = `<div class="w-full max-w-sm rounded-2xl border-2 border-border bg-card p-5 shadow-xl">
      <p class="${PX} text-[10px] text-foreground">Start from zero?</p>
      <p class="mt-2 text-[13px] leading-snug text-foreground/70">This disconnects your Teamly key, removes the agents this panel installed and clears the panel's saved screens, so Teamly looks the way it does for a new person. Team records and their files stay.</p>
      <div class="mt-4 flex flex-col gap-2"><button data-yes class="${BTN}">Reset Teamly</button><button data-no class="${BTN2}">Keep everything</button></div></div>`;
    document.body.append(box);
    box.querySelector("[data-yes]").onclick = () => { box.remove(); resolve(true); };
    box.querySelector("[data-no]").onclick = () => { box.remove(); resolve(false); };
  });
}
const wantsFresh = new URLSearchParams(location.search).has("fresh");
const fresh = wantsFresh && await confirmFresh();
if (wantsFresh) history.replaceState(null, "", location.pathname + (A.hostChat ? `?chat=${encodeURIComponent(A.hostChat)}` : ""));
if (fresh) {
  await refreshLive();
  for (const i of S?.installed ?? []) if (i.ours) await A.live.fire(i.slug).catch(() => {});
  await A.live.removeKey().catch(() => {});
  for (const k of ["teamly-v2:ui", "teamly-v2:wallet"]) { try { localStorage.removeItem(k); } catch { /* no storage */ } }
  await A.live.uiReset().catch(() => {});
  Object.assign(ui, { onboarded: false, entry: null, goal: null, hired: [], run: null, dept: null, suggested: null, analysis: null, teamName: null, mockOb: null });
  A.wallet.reset();
}

// restore what you did last time — from the file on disk, whichever chat's panel this is
if (!fresh) {
  const saved = await A.live.uiGet().catch(() => null);
  if (saved?.ui) Object.assign(ui, saved.ui);
  if (saved?.wallet?.ledger) A.wallet.data = saved.wallet;
  for (const [name, vals] of Object.entries(saved?.screens ?? {})) Object.assign(screenLocal[name] ??= {}, vals);
  if (!location.hash && ui.lastTab && SCREENS[ui.lastTab]) history.replaceState(null, "", `${location.pathname}${location.search}#/${ui.lastTab}`);
}
A.wallet.onChange = syncUI;

await refreshLive();
render();
