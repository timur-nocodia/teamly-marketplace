// Start = the onboarding. Two entries:
// 1) General: ready teams first. Clicking a team IS the answer to "what do you want to get?". Skippable.
// 2) From a reel: the coordinator opens /?entry=reel&agent=mark&task=... → straight to that agent, task prefilled.

function chainAvatars(ctx, chain) {
  return chain.map((slug, i) => {
    const a = slug === "you" ? ctx.A.YOU : ctx.A.agentBySlug[slug];
    return `${i ? `<span class="text-foreground/25">${ctx.icon("chevronRight", "size-3")}</span>` : ""}
      <span class="flex flex-col items-center gap-1">${ctx.avatar(a.sprite, "size-8")}<span class="text-[10px] text-foreground/60">${ctx.esc(a.name)}</span></span>`;
  }).join("");
}

function teamCard(ctx, t, i) {
  const cost = ctx.A.teamCost(t);
  return `
  <div class="${ctx.CARD} p-3.5 animate-[fadeSlideUp_0.4s_ease-out_both]" style="animation-delay:${i * 60}ms">
    <div class="flex items-center justify-between gap-2">
      <p class="${ctx.PX} text-[9px] text-foreground">${ctx.esc(t.name)}</p>
      <span class="${ctx.PX} rounded border border-[#4f5bd5]/25 bg-[#4f5bd5]/5 px-1.5 py-0.5 text-[6px] text-[#4f5bd5]">${ctx.esc(t.label)}</span>
    </div>
    <p class="mt-2 text-[14px] font-medium leading-snug text-foreground">${ctx.esc(t.outcome)}</p>
    <div class="mt-3 flex items-start gap-1.5">${chainAvatars(ctx, t.chain)}</div>
    <div class="mt-3 grid grid-cols-3 gap-1.5 text-[11px]">
      <div class="rounded-md bg-muted px-2 py-1.5"><p class="${ctx.LABEL}">Time</p><p class="mt-1 font-medium">${ctx.esc(t.time)}</p></div>
      <div class="rounded-md bg-muted px-2 py-1.5"><p class="${ctx.LABEL}">Per result</p><p class="mt-1 font-medium">~${ctx.cr(cost)}</p></div>
      <div class="rounded-md bg-muted px-2 py-1.5"><p class="${ctx.LABEL}">From you</p><p class="mt-1 font-medium leading-tight">${ctx.esc(t.needs)}</p></div>
    </div>
    <button data-team="${t.id}" class="${ctx.BTN} mt-3">Hire team · one click</button>
  </div>`;
}

function general(ctx) {
  return `
  <div class="px-4 pb-8 pt-5">
    <div class="flex items-center gap-2.5">
      <img src="./assets/agents/formal01.png" alt="" class="size-12 object-contain animate-[pixelBob_3s_ease-in-out_infinite]" />
      <div>
        <p class="${ctx.PX} text-[10px] text-foreground">What do you want to get?</p>
        <p class="mt-1.5 text-[12px] text-muted-foreground">Pick a team. Each one delivers one result.</p>
      </div>
    </div>
    <div class="mt-4 flex flex-col gap-3">${ctx.A.TEAMS.map((t, i) => teamCard(ctx, t, i)).join("")}</div>
    <div class="mt-5 flex flex-col gap-2">
      <button data-browse class="${ctx.BTN2}">Browse all agents</button>
      <button data-skip class="${ctx.PX} py-2 text-[7px] text-foreground/40 hover:text-foreground/70">Skip — I know what I need</button>
    </div>
  </div>`;
}

function fromReel(ctx) {
  const e = ctx.ui.entry;
  const a = ctx.A.agentBySlug[e.agent];
  return `
  <div class="px-4 pb-8 pt-6 animate-[fadeSlideUp_0.45s_ease-out_both]">
    <p class="${ctx.LABEL}">From the reel</p>
    <div class="mt-3 flex items-center gap-3">
      <img src="./assets/agents/${a.sprite}.png" alt="" class="size-20 object-contain animate-[pixelBob_3s_ease-in-out_infinite]" />
      <div class="min-w-0">
        <p class="text-[17px] font-semibold leading-tight">You came for ${ctx.esc(a.name)}</p>
        <p class="mt-1 text-[12px] text-muted-foreground">${ctx.esc(a.role)} · by ${ctx.esc(a.author)}</p>
      </div>
    </div>
    <p class="mt-4 text-[15px] font-medium leading-snug">${ctx.esc(a.outcome)}</p>
    <div class="mt-3 rounded-lg border-2 border-foreground/10 bg-muted/60 p-3">
      <p class="${ctx.LABEL}">Example result</p>
      <div class="mt-2 flex flex-col gap-1 text-[12px] text-foreground/80">${a.example.map((l) => `<p>${ctx.esc(l)}</p>`).join("")}</div>
    </div>
    <div class="mt-3 grid grid-cols-3 gap-1.5 text-[11px]">
      <div class="rounded-md bg-muted px-2 py-1.5"><p class="${ctx.LABEL}">Time</p><p class="mt-1 font-medium">${ctx.esc(a.time)}</p></div>
      <div class="rounded-md bg-muted px-2 py-1.5"><p class="${ctx.LABEL}">Cost</p><p class="mt-1 font-medium">${ctx.cr(a.cost)}</p></div>
      <div class="rounded-md bg-muted px-2 py-1.5"><p class="${ctx.LABEL}">Got result</p><p class="mt-1 font-medium">${a.results} people</p></div>
    </div>
    ${ctx.chatAsk(`Hire ${a.name} and run: “${e.task}”?`, [
      { id: "reel-yes", label: `Yes, hire ${a.name} and run`, sub: `${a.cost ? ctx.cr(a.cost) : "free"} · ${a.time}` },
      { id: "reel-browse", label: "Show me other agents first" },
    ])}
  </div>`;
}

export function render(ctx) {
  return ctx.ui.entry?.kind === "reel" ? fromReel(ctx) : general(ctx);
}

export function mount(root, ctx) {
  root.querySelectorAll("[data-team]").forEach((b) => {
    b.onclick = () => {
      const t = ctx.A.teamById[b.dataset.team];
      ctx.ui.goal = t.goal;
      ctx.saveUI();
      ctx.hireFlow(ctx, t.chain.filter((s) => s !== "you"), { teamId: t.id, task: t.firstTask, title: `${t.name} team is hired` });
    };
  });
  root.querySelectorAll("[data-sim^='reel-']").forEach((b) => {
    b.onclick = () => {
      const e = ctx.ui.entry;
      if (b.dataset.sim === "reel-browse") return ctx.go("library");
      b.disabled = true;
      ctx.simulateHire(ctx, [e.agent], { task: e.task });
    };
  });
  root.querySelectorAll("[data-browse]").forEach((b) => { b.onclick = () => ctx.go("library"); });
  root.querySelector("[data-skip]")?.addEventListener("click", () => { ctx.ui.onboarded = true; ctx.saveUI(); ctx.go("library"); });
}
