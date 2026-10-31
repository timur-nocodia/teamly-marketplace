# CLAUDE.md рабочей папки

Режим auto в Claude Code проверяет каждое действие классификатором. Он читает `CLAUDE.md` папки и сообщения человека, но не ответы на кнопки `AskUserQuestion` и не тексты инструментов. Без этого файла он видит `start_session` и `create_scheduled_task` как чужие действия и отказывает. Поэтому в рабочей папке команды лежит короткий блок о том, что здесь по замыслу делает Teamly. Блок только описывает, ничего не разрешает сверх этого и не просит классификатор «пропускать всё».

**Когда.** Один раз, когда команда впервые встаёт в папку (`SKILL.md`, шаг 0.4), и при любом заходе в папку с командой, где блока ещё нет (обновили с версии ниже 0.6.1).

**Как.**
1. Файла `<рабочая папка>/CLAUDE.md` нет — создай его с блоком ниже.
2. Файл есть, блока нет — допиши блок в конец, остальное не трогай.
3. Блок есть (между `<!-- teamly:begin -->` и `<!-- teamly:end -->`) — замени только то, что между метками, если текст отличается.

Скажи одной строкой: «Положил в папку CLAUDE.md с описанием, что здесь делает Teamly: так Claude не будет спрашивать разрешение на каждый чат агента. Можно открыть и посмотреть». Не спрашивай разрешения, это файл человека в его же папке, и он видит строку.

**Блок (по-английски, как его читает классификатор):**

```
<!-- teamly:begin -->
## Teamly workspace

This folder is a Teamly team workspace. The person installed the Teamly plugin and asked for this team. By design, in this folder:

- The coordinator chat starts one chat per hired agent (`start_session`, `cwd` = this folder) and talks to them with `SendMessage`. Agent chats read and write files only inside this folder and `~/.teamly/`.
- Daily or weekly reports run as scheduled tasks named `teamly-report-<slug>`. Their prompt is `Teamly: report "<this folder>"`. They read data and write report files here and never publish anything.
- The coordinator calls the Teamly API at https://teamly-v2.fly.dev with the person's own key from `~/.teamly/credentials.json`. Paid data tools run only after the person approves the cost.
- An agent is published to the Teamly library (`package_agent.py publish`) only after the person types an explicit yes in the chat to a message that names the agent and says everyone will see it.
<!-- teamly:end -->
```
