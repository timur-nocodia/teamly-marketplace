// Buttons of an agent's dashboard (its canvas page) that go to the team's coordinator chat.
//
//   <script src="http://127.0.0.1:4319/teamly-actions.js" data-team="<team slug>" data-agent="<agent slug>"></script>
//   <button data-teamly-action="recount">Пересчитать</button>
//
// Each action is declared in <agent folder>/config/dashboard.json ({"actions": [{"id", "label", "do"}]}); the panel
// server takes only those, from this page only, and the chat gets «Teamly: dashboard <team>/<agent> <id>» as the
// person's message (the Teamly mod in Claude Code). When the chat doesn't listen, the prompt is copied to paste.
// `window.teamlyAction(id)` does the same from the page's own code; it resolves true when the chat got it.
(() => {
  const me = document.currentScript;
  const base = new URL(me.src).origin;
  const { team, agent } = me.dataset;

  const note = (text) => {
    const el = Object.assign(document.createElement("div"), { textContent: text });
    el.style.cssText = "position:fixed;left:50%;bottom:20px;transform:translateX(-50%);z-index:2147483647;max-width:90vw;" +
      "padding:8px 14px;border-radius:8px;background:#111;color:#fff;font:13px/1.35 system-ui,sans-serif;box-shadow:0 4px 16px #0004";
    document.body.append(el);
    setTimeout(() => el.remove(), 4000);
  };

  async function press(action) {
    let r = null;
    try {
      // text/plain keeps it a simple request: the server checks this page's Origin instead of a preflight
      const res = await fetch(`${base}/api/dashboard/ask`, {
        method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify({ team, agent, action }),
      });
      r = await res.json();
    } catch { /* the panel is not running */ }
    if (r?.delivered) { note("Sent to chat"); return true; }
    if (r?.say) {
      try { await navigator.clipboard.writeText(r.say); note(`Copied: ${r.say}. Paste it in the team's chat`); }
      catch { note(`Paste it in the team's chat: ${r.say}`); }
      return false;
    }
    note(r?.error ? `Not sent: ${r.error}` : "Teamly isn't running: open the team's chat first");
    return false;
  }

  window.teamlyAction = press;
  document.addEventListener("click", (e) => {
    const b = e.target instanceof Element ? e.target.closest("[data-teamly-action]") : null;
    if (!b) return;
    e.preventDefault();
    press(b.getAttribute("data-teamly-action"));
  });
})();
