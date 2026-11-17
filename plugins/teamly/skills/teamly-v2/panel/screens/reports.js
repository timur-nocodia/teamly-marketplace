// REPORTS: how often a team reports and what it reported (written by the coordinator: team.reports and
// <team folder>/reports/<date>.md, see references/reports.md). On a floor: the rhythm, the latest reports, "report now".
// In the overview: the latest reports of every team, to read.

const CADENCE = { daily: "Every day", weekly: "Every week", task: "After each task", needs: "Only when you're needed" };
const list = (x) => (Array.isArray(x) ? x : []);

export const cadenceLabel = (r) => (r && CADENCE[r.cadence] ? `${CADENCE[r.cadence]}${r.at && /daily|weekly/.test(r.cadence) ? ` · ${r.at}` : ""}` : null);

// When the next report comes: a date, or "due" once its time has passed (the coordinator makes it on the next turn).
export function nextLabel(r) {
  const t = Date.parse(r?.next ?? "");
  if (!r || !/daily|weekly/.test(r.cadence ?? "") || !Number.isFinite(t)) return null;
  if (t <= Date.now()) return { text: "due now", due: true };
  return { text: new Date(t).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" }), due: false };
}

const reportRow = (ctx, f, team = "") => `
  <button data-report-file="${ctx.esc(f.path)}" class="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-muted/60">
    ${ctx.icon("file", "size-3.5 shrink-0 text-foreground/45")}
    <span class="min-w-0 flex-1">
      <span class="block truncate text-[12.5px] font-medium">${ctx.esc(f.title)}</span>
      <span class="block text-[10.5px] text-foreground/45">${ctx.esc(f.date)}${team ? ` · ${ctx.esc(team)}` : ""}</span>
    </span>
    ${ctx.icon("chevronRight", "size-3.5 shrink-0 text-foreground/30")}
  </button>`;

export function reportsBlock(ctx, t) {
  const r = t.reports;
  const files = list(t.reportFiles);
  const cadence = cadenceLabel(r);
  const next = nextLabel(r);
  return `
  <p class="${ctx.LABEL} mt-5">Reports</p>
  <div class="mt-2 border-2 border-foreground/10 bg-card">
    ${cadence ? `
    <div class="flex items-center gap-2 px-3 py-2.5">
      ${ctx.icon("clock", "size-3.5 shrink-0 text-foreground/45")}
      <span class="min-w-0 flex-1 text-[12.5px]"><b>${ctx.esc(cadence)}</b>${list(r.metrics).length ? `<span class="text-foreground/50"> · ${ctx.esc(list(r.metrics).slice(0, 3).map((m) => m?.name).filter(Boolean).join(", "))}</span>` : ""}</span>
      ${next ? `<span class="${ctx.PX} shrink-0 text-[6.5px] ${next.due ? "border border-amber-400 bg-amber-50 px-1.5 py-0.5 text-amber-800" : "text-foreground/45"}">${next.due ? "Due now" : `Next ${ctx.esc(next.text)}`}</span>` : ""}
    </div>` : `
    <p class="px-3 py-2.5 text-[12.5px] leading-snug text-foreground/60">No reports yet. The coordinator can report daily or weekly, with real numbers and where each comes from.</p>`}
    ${files.length ? `<div class="flex flex-col divide-y divide-foreground/10 border-t-2 border-foreground/10">${files.slice(0, 3).map((f) => reportRow(ctx, f)).join("")}</div>` : ""}
    <div class="border-t-2 border-foreground/10 p-2">
      ${cadence ? `<button data-report-now class="${ctx.BTN2}">Report now</button>` : `<button data-reports-setup class="${ctx.BTN}">Set up reports</button>`}
    </div>
  </div>`;
}

// The newest reports of every team, newest first (overview: reading only).
export function latestReports(ctx, teams, limit = 5) {
  const all = list(teams).flatMap((t) => list(t.reportFiles).map((f) => ({ f, team: t.name ?? t.slug })))
    .sort((a, b) => (b.f.date + b.f.mtime).localeCompare(a.f.date + a.f.mtime)).slice(0, limit);
  return all.length ? `<div class="border-2 border-foreground/10 bg-card flex flex-col divide-y divide-foreground/10">${all.map(({ f, team }) => reportRow(ctx, f, team)).join("")}</div>` : "";
}

// A report is Markdown the coordinator wrote: headings, lists, bold and the numbers table, drawn as such. Everything
// is escaped first, so nothing in the file can become markup of its own.
export function mdToHtml(text, esc) {
  const inline = (x) => esc(x).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
  const cells = (row) => row.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
  const out = [];
  const lines = String(text ?? "").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*\|/.test(line)) {
      const rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(lines[i++]);
      i--;
      const body = rows.filter((r) => !/^\s*\|[\s:|-]+\|?\s*$/.test(r));
      const [head, ...rest] = body.map(cells);
      out.push(`<div class="mt-2 overflow-x-auto"><table class="w-full border-collapse text-[11.5px]"><thead><tr>${(head ?? []).map((c) => `<th class="border-b-2 border-foreground/15 px-1.5 py-1 text-left font-semibold">${inline(c)}</th>`).join("")}</tr></thead><tbody>${rest.map((r) => `<tr>${r.map((c) => `<td class="border-b border-foreground/10 px-1.5 py-1 align-top">${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
    } else if (/^#\s+/.test(line)) out.push(`<p class="text-[15px] font-semibold leading-snug">${inline(line.replace(/^#\s+/, ""))}</p>`);
    else if (/^#{2,}\s+/.test(line)) out.push(`<p class="font-[family-name:var(--font-pixel)] mt-4 text-[8px] uppercase tracking-wider text-[#4f5bd5]">${inline(line.replace(/^#+\s+/, ""))}</p>`);
    else if (/^\s*[-*]\s+/.test(line)) out.push(`<p class="mt-1 flex gap-1.5 text-[12.5px] leading-snug"><span class="text-foreground/35">•</span><span>${inline(line.replace(/^\s*[-*]\s+/, ""))}</span></p>`);
    else if (line.trim()) out.push(`<p class="mt-1 text-[12.5px] leading-snug">${inline(line)}</p>`);
  }
  return out.join("");
}

function openReport(ctx, path) {
  ctx.openSheet(`<div id="report-body" class="pt-2 text-foreground/90"><p class="text-[12px] text-foreground/50">Loading…</p></div>`, (root) => {
    ctx.A.live.fileText(path)
      .then((t) => { root.querySelector("#report-body").innerHTML = mdToHtml(t, ctx.esc); })
      .catch(() => { root.querySelector("#report-body").textContent = "Could not open the report."; });
  });
}

export function mountReports(root, ctx) {
  root.querySelectorAll("[data-report-file]").forEach((b) => { b.onclick = () => openReport(ctx, b.dataset.reportFile); });
  root.querySelector("[data-report-now]")?.addEventListener("click", () => ctx.sendToCoordinator(ctx, "Teamly: report", {
    title: "Report now", what: "The coordinator writes a report now: what's done, the numbers with where each comes from, what's next.",
  }));
  root.querySelector("[data-reports-setup]")?.addEventListener("click", () => ctx.sendToCoordinator(ctx, "Teamly: reports setup", {
    title: "Set up reports", what: "Pick how often (every day, every week, after each task) — the coordinator proposes which numbers to track for this team and where they come from, then reports on that rhythm.",
  }));
}
