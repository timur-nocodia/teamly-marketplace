// Teamly panel → coordinator chat, without copy and paste.
//
// The panel (server.py on 127.0.0.1:4319, open in the right pane of the Code tab) knows which chat it sits in by
// `?chat=<local_… id>`. A button there leaves its `Teamly: …` prompt on the server for that chat (POST /api/ask). This
// module runs inside Claude Code in every chat of the Claude app: it keeps one long poll open on
// /api/ask/wait?chat=<this chat>&via=mod and hands each prompt to `$.prompt.submit({ text, asUser: true })`, the same
// call the engine makes for a typed prompt, so the turn starts as soon as the chat is free. While it polls,
// /api/ask/status answers `listening: true, via: "mod"`, the panel sends instead of copying, and the coordinator starts
// no background `server.py --wait` (SKILL.md, «Кнопки панели»).
//
// Only the prompts of the table «Промпты из панели» in SKILL.md pass (ALLOWED below; tests/test_mod.py holds the two
// together). Anything else the server hands over is dropped: the chat never runs words a web page could have written.
import type { Register } from 'claude-code'

const PANEL = 'http://127.0.0.1:4319'
const CHAT = /^local_[A-Za-z0-9-]{1,64}$/
const SLUG = '[a-z0-9][a-z0-9-]{0,63}'

// SKILL.md, «Промпты из панели»: the ones a panel button sends. `run` and `measure` come from scheduled tasks, never
// from a button, so they stay out. A dashboard's button arrives as `dashboard <team>/<agent> <action>`: the server took
// only an action that agent declared, and the coordinator does what its config/dashboard.json says.
const ALLOWED: RegExp[] = [
  /^Teamly: (new goal|today|optimize without me|share team|feedback|update|rollback|report|reports setup)$/,
  /^Teamly: (build agent|install from file or link|install agent from archive)$/,
  /^Teamly: done — .{1,200} \([^()]{1,120}\), step \d{1,3}$/,
  /^Teamly: test optimization [A-Za-z0-9._-]{1,80}$/,
  new RegExp(`^Teamly: hire ${SLUG} → ${SLUG}( \\(a second one\\))?$`),
  new RegExp(`^Teamly: get team ${SLUG}$`),
  /^Teamly: build agent: .{1,280}$/,
  new RegExp(`^Teamly: build ${SLUG} .{1,250}$`),
  new RegExp(`^Teamly: fork ${SLUG}$`),
  new RegExp(`^Teamly: move ${SLUG} to cloud$`),
  new RegExp(`^Teamly: (package|publish) agent ${SLUG}$`),
  /^Teamly: report a bug( .{1,280})?$/,
  new RegExp(`^Teamly: dashboard ${SLUG}/${SLUG} [a-z0-9][a-z0-9-]{0,79}$`),
]

function allowed(say: unknown): say is string {
  return typeof say === 'string' && say.length <= 310 && !/[\r\n]/.test(say) && ALLOWED.some(r => r.test(say))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    // the panel addresses the chats of the Claude app (local_…); a terminal session has no panel beside it
    const chat = await $.env.get('CLAUDE_CODE_HOST_SESSION_ID')
    if (!chat || !CHAT.test(chat)) return result
    const url = `${PANEL}/api/ask/wait?chat=${chat}&via=mod`
    let misses = 0

    const poll = async () => {
      let again = 0
      try {
        // one long poll: the server answers within 25 s, `say` set when a button was pressed in this chat's panel
        const r = await $.http.fetch(url, { headers: { 'X-Teamly-Panel': '1' } })
        if (r.ok) {
          misses = 0
          const say = (JSON.parse(r.text || '{}') as { say?: unknown }).say
          // not awaited: submit resolves when the turn starts, and the next click must not wait for a busy chat
          if (allowed(say)) void $.prompt.submit({ text: say, asUser: true }).catch(() => undefined)
        } else if (r.status === 400) {
          return // the server refuses this chat id: asking again would never end
        } else {
          again = 60_000 // a panel older than the bridge (404) or a hiccup: look again in a minute
        }
      } catch {
        misses += 1 // the panel is not running yet, or restarting after an update
        again = Math.min(30_000, 2_000 * misses)
      }
      $.clock.after(again, () => void poll())
    }

    $.clock.after(0, () => void poll())
    return result
  })
}
