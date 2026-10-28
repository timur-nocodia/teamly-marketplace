// AGENT: what one agent of a team knows and how it was made — ontology, what changed for you (fork),
// tests vs plain Claude — and sharing it to the Teamly library.
// ui.agentRef = { team: <team slug>, slug } for a team agent, or { library: <slug> } for a library card.

function resolve(ctx) {
  const ref = ctx.ui.agentRef ?? {};
  if (ref.team) {
    const t = ctx.S.teams.find((x) => x.slug === ref.team);
    const a = t?.agents.find((x) => x.slug === ref.slug);
    if (a) return { team: t, a, card: a.card ?? {}, path: a.path };
  }
  const lib = ctx.S.library.find((c) => c.slug === (ref.library ?? ref.slug));
  return lib ? { team: null, a: { slug: lib.slug, name: lib.name, role: lib.role, source: "library" }, card: lib, path: lib.path } : null;
}

export function render(ctx) {
  const r = resolve(ctx);
  if (!r) return `<div class="px-4 pb-24 pt-4"><button data-back class="${ctx.PX} text-[7px] text-[#4f5bd5]">← Back</button><p class="mt-6 text-center text-[13px] text-muted-foreground">Agent not found.</p></div>`;
  const { a, card, team } = r;
  const sprite = card.sprite ?? ctx.A.agentBySlug[a.slug]?.sprite;
  // upstream is "slug@1.0.0" or {slug, version, author} (an agent someone sent as a file names its author there)
  const upRaw = a.upstream ?? card.upstream;
  const up = typeof upRaw === "string" ? upRaw.split("@")[0] : upRaw?.slug ?? null;
  // an agent that came as a file is described by what it brought: a library agent with the same name is someone else's
  const fromFile = a.source === "archive";
  const upCard = up && !fromFile ? ctx.S.library.find((c) => c.slug === up) : null;
  const upAuthor = fromFile ? (typeof upRaw === "object" ? upRaw?.author : null) ?? card.author
    : upCard?.author ?? (typeof upRaw === "object" ? upRaw?.author : null);
  const l = ctx.local("agent");
  const ref = JSON.stringify(ctx.ui.agentRef ?? {});
  if (l.ref !== ref) Object.assign(l, { ref, open: null, text: null });  // another agent: don't show the last one's file
  // the job description lives on the library card; a fork without its own takes the original's
  const job = card.job ?? upCard?.job ?? ctx.S.library.find((c) => c.slug === a.slug)?.job ?? null;
  const source = a.source === "archive" ? `From ${ctx.esc(upAuthor ?? card.author ?? "?")} · v${ctx.esc((typeof upRaw === "object" && upRaw?.version) || card.version || "1.0.0")}, installed from a file`
    : a.source === "fork" || up ? `Your version of ${ctx.esc(upCard?.name ?? up)} by ${ctx.esc(upAuthor ?? "?")}` : a.source === "built" ? "Built for you from scratch" : `By ${ctx.esc(card.author ?? "?")}`;
  return `
  <div class="px-4 pb-24 pt-4">
    <button data-back class="${ctx.PX} inline-flex items-center gap-1 text-[7px] text-[#4f5bd5]">${ctx.icon("arrowLeft", "size-3")} ${team ? ctx.esc(team.name) : "Library"}</button>
    <div class="mt-3 flex items-center gap-3">
      ${sprite ? `<img src="./assets/agents/${sprite}.png" alt="" class="size-20 object-contain animate-[pixelBob_3s_ease-in-out_infinite]" />` : `<img src="./assets/agents/create-agent-silhouette.png" alt="" class="size-20 object-contain" />`}
      <div class="min-w-0">
        <p class="text-[17px] font-semibold leading-tight">${ctx.esc((a.name && !(/[а-яё]/i.test(a.name) && card.name) ? a.name : card.name) ?? a.slug)}</p>
        <p class="mt-1 line-clamp-2 text-[12px] text-foreground/60">${ctx.esc((a.role && !(/[а-яё]/i.test(a.role) && card.role) ? a.role : card.role) ?? "")}</p>
        <p class="mt-1 text-[11px] text-foreground/45">${source}${card.version ? ` · v${ctx.esc(card.version)}` : ""}</p>
      </div>
    </div>

    <div class="mt-3 flex flex-wrap gap-1.5">
      ${card.evalWin ? `<span class="${ctx.PX} rounded bg-emerald-50 px-1.5 py-0.5 text-[6px] text-emerald-700">${fromFile ? "The author's test: beats" : "Beats"} plain Claude ${ctx.esc(card.evalWin)}</span>` : ""}
      ${!fromFile && (a.shared || card.sharedAt) ? `<span class="${ctx.PX} rounded bg-[#4f5bd5] px-1.5 py-0.5 text-[6px] text-white">In the library</span>` : ""}
      ${!fromFile && card.results ? `<span class="${ctx.PX} rounded bg-muted px-1.5 py-0.5 text-[6px] text-foreground/60">${card.results} people got a result</span>` : ""}
    </div>

    ${(() => { const rt = card.runtime ?? upCard?.runtime ?? ctx.S.library.find((c) => c.slug === a.slug)?.runtime; if (!rt) return "";
      return `<p class="mt-3 flex items-center gap-1.5 text-[12px] text-foreground/60">${ctx.icon("laptop", "size-3.5")} ${Array.isArray(rt.os) && rt.os.length === 1 && rt.os[0] === "mac" ? "Mac only" : "On your computer"}${typeof rt.why === "string" && rt.why ? ` — ${ctx.esc(rt.why.charAt(0).toLowerCase() + rt.why.slice(1))}` : ""}</p>`; })()}
    ${job ? `
    <p class="mt-5 text-[14px] leading-snug"><span class="${ctx.PX} mr-1 text-[7px] text-[#4f5bd5]">Owns</span>${ctx.esc(job.owns)}</p>
    <div class="mt-3 flex flex-col gap-1.5">
      <div class="rounded-lg bg-muted px-3 py-2"><p class="${ctx.LABEL}">You give</p><p class="mt-1 text-[13px]">${ctx.esc(job.give)}</p></div>
      <div class="rounded-lg border-2 border-[#4f5bd5]/20 bg-[#4f5bd5]/[0.04] px-3 py-2"><p class="${ctx.PX} text-[7px] text-[#4f5bd5]">It does</p>
        <ol class="mt-1 flex flex-col gap-1 text-[13px]">${(Array.isArray(job.steps) ? job.steps : []).map((x, i) => `<li class="flex gap-2"><span class="mt-[1px] flex size-4 shrink-0 items-center justify-center rounded bg-[#4f5bd5]/15 text-[9px] font-bold text-[#4f5bd5]">${i + 1}</span>${ctx.esc(x)}</li>`).join("")}</ol></div>
      <div class="rounded-lg bg-emerald-50 px-3 py-2"><p class="${ctx.PX} text-[7px] text-emerald-700">You get</p><p class="mt-1 text-[13px] font-medium">${ctx.esc(job.get)}</p></div>
    </div>
    ${typeof job.not === "string" && job.not ? `<p class="mt-2 text-[12px] text-foreground/50">Not its job: ${ctx.esc(job.not.charAt(0).toLowerCase() + job.not.slice(1))}</p>` : ""}`
    : card.outcome ? `<p class="${ctx.LABEL} mt-5">Delivers</p><p class="mt-1.5 text-[13px] leading-snug">${ctx.esc(card.outcome)}</p>` : ""}

    <p class="${ctx.LABEL} mt-5">What it knows</p>
    <div class="mt-1.5 flex flex-col gap-1.5">
      ${["ontology.md", "CHANGES.md", "references/rules.md", "evals/evals.json"].map((f) => `
      <button data-file="${f}" class="flex items-center gap-2 rounded-lg border-2 border-foreground/10 px-3 py-2 text-left text-[12px] hover:border-[#4f5bd5]/40 ${l.open === f ? "border-[#4f5bd5]/40" : ""}">
        ${ctx.icon("file", "size-3.5 text-foreground/50")}
        <span class="flex-1">${{ "ontology.md": "Ontology of the task", "CHANGES.md": fromFile ? `What ${ctx.esc(upAuthor ?? "the author")} changed, and you since` : "What changed for you", "references/rules.md": "Rules, each with its source", "evals/evals.json": "Tests (vs plain Claude)" }[f]}</span>
        ${ctx.icon("chevronRight", `size-3 text-foreground/35 ${l.open === f ? "rotate-90" : ""}`)}
      </button>
      ${l.open === f ? `<div id="file-view" class="max-h-80 overflow-y-auto whitespace-pre-wrap rounded-lg bg-muted p-3 font-mono text-[11px] leading-relaxed text-foreground/80">${l.text == null ? "Loading…" : ctx.esc(l.text)}</div>` : ""}`).join("")}
    </div>

    ${team ? shareBlock(ctx, a, card) : ""}
  </div>`;
}

// SHARE: an agent that proved itself on your tasks goes to the Teamly library. The panel shows how far it is
// (the same thresholds the coordinator packages by), then the draft: what becomes public, what stays with you,
// what the next person will be asked. Packaging and publishing happen in the chat — publishing only on your "yes".
function shareBlock(ctx, a, card) {
  const fromFile = a.source === "archive";
  const sh = a.share;
  const d = sh?.draft;
  const tick = (ok) => `<span class="flex size-4 shrink-0 items-center justify-center rounded-full ${ok ? "bg-emerald-500 text-white" : "border-2 border-foreground/20"}">${ok ? ctx.icon("check", "size-2.5") : ""}</span>`;
  const val = (c) => (Array.isArray(c.value) ? c.value.join(" · ") : typeof c.value === "boolean" ? "" : c.value ?? "—");
  if (a.shared || (!fromFile && card.sharedAt) || d?.publishedAt) {  // a received card's sharedAt is the sender's, not yours
    return `<p class="${ctx.LABEL} mt-6">In the library</p>
      <div class="mt-2 rounded-xl border-2 border-emerald-300 bg-emerald-50/60 p-3 text-[12.5px]">
        <p><b>${ctx.esc(d?.name ?? card.name ?? a.name)}</b> is in your library on this computer${d?.publishedAt ? ` since ${ctx.esc(d.publishedAt.slice(0, 10))}` : ""}: you can hire it onto any floor.</p>
        ${d?.zip ? `<p class="mt-1.5 text-[11.5px] text-foreground/55">To give it to someone, send them ${ctx.esc(d.zip.split("/").pop())} (in ~/.teamly/outbox): they install it with “Teamly: install from file or link”. The Teamly portal isn't open yet.</p>` : ""}
      </div>`;
  }
  return `
    <div class="mt-6 flex items-center gap-2"><p class="${ctx.LABEL}">Share to the library</p>${sh?.ready ? `<span class="rounded bg-emerald-100 px-1.5 py-0.5 text-[10.5px] font-semibold text-emerald-700">Ready to share</span>` : ""}</div>
    ${sh ? `
    <div class="mt-2 flex flex-col gap-1.5 rounded-xl border-2 border-foreground/10 p-3">
      ${sh.checks.map((c) => `<div class="flex items-center gap-2 text-[12.5px]">${tick(c.ok)}<span class="flex-1 ${c.ok ? "" : "text-foreground/55"}">${ctx.esc(c.label)}</span><span class="text-[11.5px] text-foreground/45">${ctx.esc(String(val(c)))}</span></div>`).join("")}
      <p class="mt-1 text-[11px] text-foreground/45">Stars come from the rating the coordinator asks for after each task.</p>
    </div>` : ""}
    ${d ? `
    <div class="mt-3 grid gap-2 min-[520px]:grid-cols-2">
      <div class="rounded-lg bg-emerald-50 px-3 py-2"><p class="text-[11px] font-semibold text-emerald-700">Goes public · ${d.public?.length ?? 0} files</p>
        <p class="mt-1 text-[11.5px] leading-snug text-foreground/70">${ctx.esc((d.public ?? []).slice(0, 8).join(", "))}${(d.public ?? []).length > 8 ? "…" : ""}</p></div>
      <div class="rounded-lg bg-muted px-3 py-2"><p class="text-[11px] font-semibold text-foreground/60">Stays with you · ${d.private?.length ?? 0}</p>
        ${(d.private ?? []).slice(0, 6).map((x) => `<p class="mt-0.5 text-[11.5px] leading-snug text-foreground/70">${ctx.esc(x.path)} <span class="text-foreground/40">— ${ctx.esc(x.why)}</span></p>`).join("")}</div>
    </div>
    ${(d.setupQuestions ?? []).length ? `<p class="mt-2 text-[12px]"><b>The next person will be asked:</b> ${ctx.esc(d.setupQuestions.map((q) => q.ask).join(" · "))}</p>` : ""}
    <p class="mt-2 text-[12px] ${d.privacy?.ok ? "text-emerald-700" : "text-red-600"}">${d.privacy?.ok ? "✓ Privacy check: clean" : `✗ Privacy check: ${(d.privacy?.findings ?? []).length} to fix`}</p>
    ${(d.needs ?? []).length ? `<div class="mt-1.5 rounded-lg border border-dashed border-amber-400 px-3 py-2"><p class="text-[11.5px] font-semibold text-amber-800">Before it can go out</p>${d.needs.map((n) => `<p class="mt-0.5 text-[11.5px] text-amber-900">· ${ctx.esc(n)}</p>`).join("")}</div>` : ""}
    <button data-share-cmd="publish" class="${ctx.BTN} mt-3" ${(d.needs ?? []).length ? "disabled" : ""}>Publish to the Teamly library</button>
    <button data-share-cmd="package" class="${ctx.BTN2} mt-2">Rebuild the draft</button>`
    : `<button data-share-cmd="package" class="${ctx.BTN} mt-3">${sh?.ready ? "Package it for the library" : "Package a draft anyway"}</button>
       <p class="mt-1.5 text-[11px] text-foreground/45">The coordinator builds a draft: your settings become questions for the next person, your files and accounts stay with you. Nothing is published without your yes.</p>`}`;
}

export function mount(root, ctx) {
  const r = resolve(ctx);
  const l = ctx.local("agent");
  root.querySelector("[data-back]")?.addEventListener("click", () => ctx.go(r?.team ? "team" : "library"));
  root.querySelectorAll("[data-file]").forEach((b) => {
    b.onclick = () => {
      const f = b.dataset.file;
      if (l.open === f) { l.open = null; return ctx.rerender(); }
      l.open = f; l.text = null; ctx.rerender();
      if (!r?.path) { l.text = "No files for this agent."; return ctx.rerender(); }
      // an agent that came as a file keeps its author's changes in CHANGES.upstream.md; the person's own go to CHANGES.md
      const read = (name) => ctx.A.live.fileText(`${r.path}/${name}`);
      const text = f === "CHANGES.md" ? Promise.allSettled([read("CHANGES.upstream.md"), read("CHANGES.md")]).then(([theirs, mine]) => {
        const parts = [theirs.status === "fulfilled" ? theirs.value : "", mine.status === "fulfilled" ? `${theirs.status === "fulfilled" ? "\n— Your changes —\n" : ""}${mine.value}` : ""].filter(Boolean);
        if (!parts.length) throw new Error("none");
        return parts.join("\n");
      }) : read(f);
      text
        .then((t) => { l.text = f.endsWith(".json") ? JSON.stringify(JSON.parse(t), null, 1) : t; })
        .catch(() => { l.text = f === "CHANGES.md" ? "Nothing changed: this is the library version as is." : "Not written yet."; })
        .finally(() => ctx.rerender());
    };
  });
  root.querySelectorAll("[data-share-cmd]").forEach((b) => {
    b.onclick = () => {
      const prompt = `Teamly: ${b.dataset.shareCmd === "publish" ? "publish" : "package"} agent ${r.a.slug}`;
      navigator.clipboard?.writeText(prompt).catch(() => {});
      const sess = r.team?.coordinator_session;
      if (sess) ctx.A.live.openChat(sess).then(() => ctx.toast("Copied — paste it in the coordinator's chat")).catch(() => ctx.toast(`Copied: ${prompt}`));
      else ctx.toast(`Copied: ${prompt} — paste it in the team's chat`);
    };
  });
}
