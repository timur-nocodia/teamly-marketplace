// DASHBOARD: an agent's own page (its canvas, forge SKILL.md «Канвас-страница») inside the office, under the top bar.
// Igor 17.11: a click on an agent in the room opens its dashboard; the top bar stays, and "← Room" goes back.
// ui.dashRef = { team, slug }. The page runs on its own port; the server starts it if it is down (/api/dashboard/open).
// The frame must not reload on every live update, so the screen is `stable`: app.js redraws it only when its HTML changes.
export const stable = true;

function resolve(ctx) {
  const ref = ctx.ui.dashRef ?? {};
  const t = (ctx.S.teams ?? []).find((x) => x.slug === ref.team);
  const a = (t?.agents ?? []).find((x) => x.slug === ref.slug);
  return t && a ? { t, a } : null;
}

export function render(ctx) {
  const r = resolve(ctx);
  const back = `<button data-back class="${ctx.PX} inline-flex items-center gap-1 text-[7px] text-[#4f5bd5]">${ctx.icon("arrowLeft", "size-3")} Room</button>`;
  if (!r) return `<div class="px-4 pt-4">${back}<p class="mt-6 text-center text-[13px] text-muted-foreground">No dashboard here.</p></div>`;
  const lib = ctx.A.agentBySlug[r.a.slug];
  const name = (r.a.name && !/[а-яё]/i.test(r.a.name) ? r.a.name : r.a.card?.name ?? lib?.name) ?? r.a.slug;
  return `
  <div class="flex h-full flex-col">
    <div class="flex shrink-0 items-center gap-3 border-b border-border/60 bg-card px-4 py-2">
      ${back}
      <span class="min-w-0 flex-1 truncate text-center text-[12px] font-semibold">${ctx.esc(name)}</span>
      <button data-knows class="text-[11px] text-foreground/50 hover:text-[#4f5bd5]">What it knows</button>
    </div>
    <div class="relative min-h-0 flex-1">
      <p data-dash-note class="absolute inset-0 flex items-center justify-center p-6 text-center text-[13px] text-muted-foreground">Opening the dashboard…</p>
      <iframe data-dash-frame title="${ctx.esc(name)} dashboard" class="relative size-full border-0 bg-background opacity-0 transition-opacity"></iframe>
    </div>
  </div>`;
}

export function mount(root, ctx) {
  const r = resolve(ctx);
  root.querySelector("[data-back]")?.addEventListener("click", () => ctx.go("team"));
  if (!r) return;
  root.querySelector("[data-knows]")?.addEventListener("click", () => { ctx.ui.agentRef = { team: r.t.slug, slug: r.a.slug }; ctx.saveUI(); ctx.go("agent"); });
  const frame = root.querySelector("[data-dash-frame]");
  const note = root.querySelector("[data-dash-note]");
  frame.onload = () => { if (frame.src) frame.classList.remove("opacity-0"); };
  ctx.A.live.openDashboard(r.t.slug, r.a.slug)
    .then((x) => { frame.src = `${x.url}?t=${Date.now()}`; })  // a page the agent just rebuilt, never the cached one
    .catch((e) => { note.textContent = `Couldn't open the dashboard: ${e.message}`; });
}
