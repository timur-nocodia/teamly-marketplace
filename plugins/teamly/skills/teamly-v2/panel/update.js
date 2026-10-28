// A newer Teamly is out (the server reads teamly.to/skill/latest.json once a day): one strip above every screen.
// "Update" asks the coordinator, which downloads, checks and installs it, then restarts this panel. "Later" hides the
// strip until the next version. A version below minVersion ("required") can't be put off.
const PX = "font-[family-name:var(--font-pixel)] uppercase tracking-wider";

export function updateStrip(u, later, esc) {
  if (!u || !(u.available || u.required)) return "";
  if (!u.required && later === u.latest) return "";
  const note = u.notes?.en || Object.values(u.notes ?? {})[0] || "";
  const btn = (attr, label, tone) => `<button ${attr} class="${PX} shrink-0 rounded-md px-2.5 py-1.5 text-[7px] ${tone}">${label}</button>`;
  if (u.required) {
    return `
    <div role="alert" class="flex shrink-0 items-center gap-2 border-b-2 border-red-300 bg-red-50 px-3 py-2 text-[12px] text-red-800">
      <span class="min-w-0 flex-1">This Teamly (${esc(u.current)}) no longer works with Teamly's servers. Update to ${esc(u.latest)} to keep going.</span>
      ${btn("data-update", "Update", "bg-red-600 text-white hover:bg-red-700")}
    </div>`;
  }
  return `
    <div role="status" class="flex shrink-0 items-center gap-2 border-b-2 border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
      <span class="min-w-0 flex-1"><b>Teamly ${esc(u.latest)} is out.</b>${note ? ` ${esc(note)}` : ""}</span>
      ${btn("data-update", "Update", "bg-[#4f5bd5] text-white hover:bg-[#3f4bc5]")}
      ${btn("data-update-later", "Later", "text-amber-900/60 hover:text-amber-900")}
    </div>`;
}

// Which Teamly is running is never a guess: at the bottom of the Feedback sheet (and in the wordmark's tooltip).
export const versionLabel = (v, esc) => (v ? `<p class="${PX} mt-5 text-center text-[7px] text-foreground/35">Teamly ${esc(v)}</p>` : "");
