# Updating Teamly (installed as a Claude plugin)

Teamly is installed as a Claude plugin, so it updates through Claude, not through a downloaded archive.
Do not run `update.py` or `install.py`: they would put a second copy of the skills next to the plugin's.

When the person asks to update, say it in one line and run, with the Bash tool:

`"$CLAUDE_CODE_EXECPATH" plugin marketplace update teamly && "$CLAUDE_CODE_EXECPATH" plugin update teamly@teamly`

That is the `claude` of the app they are in: a `claude` on the PATH may be an old one without these commands, and in
the PowerShell tool the variable is empty. It is the same as `claude plugin update teamly@teamly` in a terminal.
Then tell them to restart Claude to apply it ("Restart to apply changes").
