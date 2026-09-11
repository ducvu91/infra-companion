# Changelog

All notable changes to Infra Companion are documented here.
Format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [0.3.0] — 2026-09-11

### Added

- **Codex works inside the app, paid for by your ChatGPT plan — no API key.** The app runs OpenAI's `codex app-server` as a child process and talks to it over JSON-RPC, the same interface the Codex CLI, the Codex desktop app and the VS Code extension all use. Sign-in is whatever `codex login` already put in `~/.codex/auth.json`: the app **never reads that file** and never passes `OPENAI_API_KEY` to the agent, so a key sitting in your environment cannot quietly start billing you per token. Pick a working folder, describe the job, and the agent reads and edits files and runs commands in that folder — its answers, the commands it runs and their output all stream into the panel as they happen. Opens as a column beside the terminal (the terminal narrows rather than being covered) with **⛶** to expand it into a full tab when a diff gets long.
- **Sign in, switch accounts, and see what is left of your quota — all in the app.** No terminal needed: **Sign in with ChatGPT** opens the browser and the app waits for the callback, with a device-code route for machines where no browser opens. Once signed in the panel shows the account email, the plan, and how much of the quota is used with the days until it resets. **Switch account** signs in over the top rather than signing out first, so a failed sign-in does not leave you with no account at all.
- **Several accounts side by side, through profiles.** Codex keeps exactly one account per config directory, so a second account means a second directory: profiles do that. The default profile shares `~/.codex` with the `codex` you run in a terminal — sign in once, both work. A separate profile gets its own sign-in, and as a side effect does not load the MCP servers from your system config either. Removing a profile deletes its stored credentials with it.
- **Earlier sessions, resumable.** Codex writes every session's transcript under `~/.codex/sessions`, so the history is already there — the panel lists it (first message, when, which model, which folder) and reopening one continues that conversation with everything the agent already knows. The app deliberately keeps no second copy of its own: two sources of truth for one thing drift apart, and Codex's copy is the one that can actually be resumed.
- **Pick the model and the reasoning depth from the chat box.** Both sit in the composer itself — a throwaway question can run `low` and a refactor `high`, which is a per-question choice, not something to bury in Settings. The list comes from the server rather than being hard-coded, because which models and which depths exist changes with the CLI version and with your plan.
- **The app updates Codex itself.** Codex's own `codex update` refuses to run when the CLI came from the Codex desktop app (*"Could not detect the Codex installation method"*), and an outdated CLI is not a small inconvenience — its model list goes stale until **every** model fails. The **⬇ Update Codex** button fetches the current release into the app's own folder via npm, verifies it actually runs, and uses it in preference to whatever is on PATH — without touching the `codex` you use in a terminal. The button appears right where a model error is reported, and a session that is open is reopened on the new binary, because updating the file on disk does not change an already-running process.
- **Errors say what to do, not just what happened.** Three failures that all look like raw JSON from the server now come with the fix: a model that needs a newer Codex, a model the server has retired, and a model that cannot be used with a ChatGPT plan at all. The original message stays underneath — folded away, not deleted.
- **Working folder is filled in for you.** `D:\InfraCompanion-Codex` (or `C:\` when there is no D: drive), created when you press Start rather than when the panel opens, so the app leaves nothing on your machine before you use the feature. The folder you used last always wins over the default.

### Changed

- **The AI column takes tabs.** Codex joins the assistant and the troubleshooter in one column (**✨ Assistant · 🩺 Diagnose · 🤖 Codex**) instead of opening a third one. The panel you are not looking at stays alive, so a half-typed question and a running agent are both still there when you switch back.
- **Enter sends.** In the Codex composer, `Enter` sends and `Shift+Enter` starts a new line, the way every chat box works — `Ctrl+Enter` still sends too. Pressing Enter while an IME is composing (typing Vietnamese with Telex, for instance) inserts the character instead of sending a half-finished sentence.
- **The composer is one rounded box.** Input, model picker and send button share a single frame with a circular **↑** to send, rather than three stacked blocks and a wide button in the middle — in a 400px column the old label spent half a row on what the Enter key already does.

---

## [0.2.26] — 2026-09-10

### Changed

- **Both AI panels share one column with tabs, instead of opening a second column each.** Each docked column is 400px by default, so having the assistant and the troubleshooter open at once ate 800px and left the terminal a sliver — while both of them exist precisely so you can *watch the output while you ask*, which is the first thing that sliver takes away. They now sit in the same column, picked with a tab strip (**✨ Assistant** · **🩺 Diagnose**), and opening either one from the menu, the palette or `Ctrl+I` brings its tab to the front rather than appearing to do nothing because the column was already open on the other tab. The panel you are not looking at **stays alive** — a half-typed question and a diagnostic run waiting for approval are both still there when you switch back — and with only one of them open there is no tab strip at all, just the header as before. The tab strip also carries that panel's own buttons (**⛶ ⚙ ✕**), because a separate row holding three buttons is a row of a 400px column spent on nothing.
- **The chat box is pinned to the bottom of the panel.** The question box used to sit *above* the answer inside one scrolling area, so every long answer pushed it further out of sight and asking a follow-up meant scrolling back up to find where to type. Answers now flow in the scrolling part and the box stays put at the bottom, the way a chat window works. New content scrolls into view on its own **only when you are already at the bottom** — if you have scrolled up to read the output of step 2, step 4 finishing no longer yanks the view away from you.
- **The troubleshooter's *Approve & run* button no longer drifts down the page.** It used to live at the end of the step list, so each completed step pushed it further away and every approval in a long session started with a scroll. The pending command and its **Approve & run** / **Skip** buttons are now in the pinned bottom area, with the command repeated next to the buttons on purpose — it is about to run on a real machine, so it should be readable exactly where you click, not a scroll away. The step in the list above says it is waiting for approval below.
- **⛶ *Open in tab* is an icon in the AI panels.** Next to `⚙` and `✕` in a column this narrow, the bordered *⊞ Open in tab* button took the space two tab labels needed. It keeps its label everywhere else — in the wide tool modals there is no shortage of room, and an unlabelled icon there would just be a guess.

---

## [0.2.25] — 2026-09-09

### Added

- **Command history per host, searchable with `Ctrl+Shift+R`.** Every command that finishes is recorded — what you ran, on which machine, how long it took, and its exit code — and stays searchable months later, so *"how did I do that on app-02 back then?"* has an answer even when the server's own `.bash_history` was wiped, rotated, or never written because the session ended in a disconnect. The search ranks a match at the start of the command above one in the middle, a command from the machine you are standing on above the same command elsewhere, and recent above old; repeats of one command collapse into a single row that says how many times it ran and on how many machines, so twenty `nginx -t` do not push out everything else. Picking a row **inserts the command into the terminal without running it** — you read it, then press Enter yourself, which also means the dangerous-command guard still gets its say instead of being bypassed. `Ctrl+R` is left alone and still reaches the remote shell's own reverse search. Needs shell integration (the OSC 133 snippet from 0.2.24) since that is what marks where one command ends and the next begins.
- **Passwords typed on a command line are redacted before the command is stored.** `mysqldump -pSECRET`, `curl -u user:SECRET`, `--token …`, `--password=…`, `PASSWORD=`-style environment prefixes, and an `Authorization: Bearer …` header typed into `curl -H` keep their shape but lose their value — including when the value is quoted (`-p"a b"`), which is exactly how a strong password gets typed, so the history stays readable as history without becoming a password file — and `-p` on everything else (`cp -pr`, `mkdir -p`, `docker run -p80:80`, `find -print`) is deliberately left untouched, because redacting those would gut the very lines you go looking for. The same redacted text is what goes into the long-command notification, since the notification store is an unencrypted database outside the vault — redacting for one and not the other would make the vault encryption pointless. The command text itself is encrypted with the vault DEK on top of that; the metadata stays in plain columns so filtering and ranking never need to decrypt the whole table, and a row that was redacted is flagged as such so the warning survives any later change to the placeholder text.
- **The command search has a button, not just a shortcut.** It now sits in the `⋯` tools menu, on the Dashboard tool grid, in *All features* and in the Workbench Tools panel as **🔎 Command history**, alongside Snippets and Tunnels where it belongs — `Ctrl+Shift+R` still toggles it. A feature reachable only by a keyboard shortcut is one that people who did not read the release notes never discover.
- **Turning shell integration on is now one button, in the place you find out you need it.** The empty command-history search used to say *"history needs shell integration — paste the OSC 133 snippet from Settings into ~/.bashrc"*: true, but it named no snippet and sent you off to look for it, then to SSH into each machine yourself. It now shows the snippet right there with three ways to use it — **Install on the open host** appends it to `~/.bashrc` over the terminal you already have open (pressing it twice does not duplicate anything, and it says so), **Copy** for pasting by hand or into Ansible/cloud-init to roll it out fleet-wide, and **Show the snippet** to read the eleven lines before trusting them. The note underneath says the part that trips people up: installing into `~/.bashrc` takes effect from the *next* session, so paste it directly if you want it in the session you are in.
- **The history stays on this machine.** It is deliberately **not** part of vault sync: the sync merge picks the newer of two versions of one record, which means nothing for an append-only log, and syncing it would grow every snapshot by every command ever typed. Settings → Terminal has *Export to file* / *Import from file* for moving it deliberately, and the export tells you the file is plain readable text so it does not end up in a shared folder. The same section turns recording off and clears what is stored, with a confirmation because that cannot be undone.

- **The AI assistant is a docked column now, not a window that blocks everything.** It used to open as a modal with a backdrop, so asking it anything meant the terminal behind it was unreachable — while the actual loop is *ask, run, paste the error back, ask again*, and with a backdrop that loop became "close the assistant, run it, reopen, retype the question". It now sits in a column on the right, the way an editor docks its assistant panel: the column **takes real space so the terminal narrows to make room instead of being covered**, which matters because half of asking about infrastructure is reading the output. Drag its left edge to resize (280–720px, remembered), `Ctrl+I` toggles it, and it works in all three layout themes. Inserting a command no longer closes it either, since the next question usually follows the first result; the row above the button says out loud which machine the command will go into, and a suggested command wraps onto a second line rather than being cut off mid-pipe — you are about to run it on a real server. Opening Snippets or Settings mid-question no longer throws the question away, because the assistant is no longer stored in the single "which modal is open" slot. Provider and API-key settings stay a real modal — that is a fill-in-once form with a password field, and blocking the screen there is correct.

- **Either AI panel expands into a full tab.** The docked column is right for the back-and-forth, but not for a twelve-line backup script or a table — so **⊞** on the header opens the same assistant as a tab, with the question you were typing carried over since it is the same component, not a second copy. Inserting a command from the tab switches you to the terminal that received it, because otherwise you would be looking at a toast and an AI screen with no sign anything happened.
- **AI troubleshooting moves out of a blocking window too.** It runs *many* steps, each waiting for you to approve a read-only command, so a backdrop meant that for the whole session you could not look at anything — including the terminal of the machine being diagnosed. It is now a docked column like the assistant, with **⊞** for a tab when step output gets long. Closing it does not end the session: the pill still reports *waiting for your approval*, and the results of earlier steps survive.
### Fixed

- **Console logs are readable again on Windows.** Running `pnpm dev` printed lines like `d┤ng OAuth client tß╗¬` instead of the intended text, because PowerShell 5.1 decodes a child process's stdout using the ANSI code page rather than UTF-8 — the app was writing correct UTF-8 all along. Every log line from the main process is now plain ASCII English, so it survives any shell, any code page, and can be pasted into a bug report as-is. The app's own interface stays in your language; this only affects the technical log.

- **Tool icons are all distinct now.** Several tools shared an icon or, worse, used different characters that render as the same small shape — `⏰` on both schedulers, `🔄` on Sync and folder sync, magnifying glasses on Compare and Command history, and trays on Import and Export. At 16px those are indistinguishable, which is where the confusion actually happens. Eight icons changed, chosen to differ in shape and colour rather than just in code point, and the same tool now shows the same icon in the tools menu, on its tab and in its tab header — fifteen places where a tab was still drawing the old icon are fixed too.
- **Workbench: the host list can be scrolled again.** With more hosts than fit the panel, the ones at the bottom were simply unreachable — the list had no height to scroll inside, so it overflowed the panel instead of scrolling. The host column now keeps its search row and its bottom buttons pinned and scrolls the list between them, as it always did in the Infra theme.
- **Workbench: the bottom panel is findable.** Monitoring, Log and Tunnels live in a panel that starts closed, and the only way in was an unlabelled `⬒` icon at the foot of the activity bar — so unless you already knew the panel existed, you had no reason to look for it. The status bar now carries a **⬒ Panel** button in this theme, and `Ctrl+J` (with the bottom panel) finally appears in the keyboard shortcut list, which is where people go when they cannot find the way in.

---

## [0.2.24] — 2026-09-08

### Added

- **Scheduled jobs.** Run a command, a snippet, or a fleet inventory collection on a cron schedule from inside the app, without touching any server's crontab. Five-field cron or `@daily`/`@hourly`/`@weekly`/`@monthly`, with presets and a live *next run* preview; pick the hosts, a per-run timeout, and when to count the run as failed (any host, all hosts, or never). Each run is kept with per-host exit code, duration and output (head and tail, capped), the last 50 runs per job are browsable from the row, and a failure is recorded in Notifications so a nightly backup check that stops passing is not something you find out about a month later. The schedule lives outside the vault so the scheduler knows it the moment the app starts, but running needs the vault open — a run that meets a locked vault is recorded as **skipped with the reason**, never silently dropped. Pairs with close-to-tray from 0.2.22: the app keeps running with the window closed, which is what makes a schedule worth having.
- **Fleet security check.** One read-only command per host, scored into a to-do list: does sshd still accept passwords or let root log in, which listening ports are reachable from outside rather than loopback, how many failed logins are in the auth log, is fail2ban present, are there `NOPASSWD` sudo rules, accounts with empty passwords or a second UID 0, keys in root's `authorized_keys`, is a firewall active, is SELinux enforcing, is a reboot pending. Each host gets a score out of 100 and its findings sorted worst first, each finding carries a **How to** button that opens the matching runbook. The app changes nothing — no `sudo`, nothing installed — and results are **never written to disk**: they are a snapshot of "which machine is exposing what", exactly the thing that should not be sitting in a file.
- **Shell integration (OSC 133) and long-command notifications.** With a small snippet added to the host's `.bashrc` (Settings copies it for you), the terminal learns where each command starts and ends and what it exited with: the pane shows the last command's status and how long it took, and a command that ran longer than 20 seconds notifies you when it finishes **if you are looking elsewhere** — a different tab, or the window unfocused — so a long `composer install` or `mysqldump` tells you it is done instead of you checking back. Interactive programs (an editor, `top`, a pager) never notify. Both the marks and the notification can be turned off in Settings.
- **Folder diff and auto-upload.** Pair a folder on this machine with a folder on a host: the diff table compares modified time and size to say which side is newer, which files exist on only one side, and which have the same timestamp but a different size (shown as a conflict rather than guessed at). **Push changes** uploads the local-newer and local-only files in one go; **Watch** uploads a file as soon as you save it, creating remote directories as needed and reusing one SFTP session instead of reconnecting per file. Deliberately one way, machine → host: a file that is newer on the server usually means somebody edited it there directly, so it is flagged, not overwritten. A deleted local file is never deleted on the host. An ignore list (`.git`, `node_modules`, `vendor`, `.env`, `*.log`… editable per pair) keeps local-only files out, and paths that would escape the remote root are refused.

### Fixed

- **Runbooks: *Send* said "no connected terminal" even with an SSH tab open.** It only looked at the tab you were *currently* on — and when a runbook is opened as a tab, that tab is the runbook itself, so the check could never succeed. *Send* now falls back to the terminal tab you were on most recently. Deliberately "most recently used" rather than "any terminal it can find": sending an `iptables` line to the wrong machine is a real accident, so the target has to be where you were actually working, and with no connected session anywhere it still refuses instead of guessing. The same fix applies to the AI troubleshooter, which pre-selects the host you are working on and had the same blind spot when opened as a tab.

---

## [0.2.23] — 2026-09-07

### Added

- **Notification centre.** Every alert the app raises — Monitoring thresholds, replication lag, the uptime watcher going down or coming back, a tunnel falling into error, a URL check failing — is now **recorded** in one place instead of only flashing as a toast. 🔔 in the status bar shows the unread count; the *Notifications* tool (menu, palette, or as a tab) lists them grouped by day with a filter per source, *Unread only*, ✓ to acknowledge one and *Mark all read*. Events are kept 30 days in `events.db` next to the vault, unencrypted (they say "app-01 stopped responding at 10:02", not secrets).
- **Event markers on the metrics charts.** Add a marker — "Deploy v2.3", "nginx restarted" — from the notification centre or straight from a host's metrics history, for one host or the whole fleet. Markers appear as dashed vertical lines on every chart (history modal, the inline card chart in the dock), alongside the host's own alerts and recoveries, so a CPU spike can be matched to what happened just before it. Hover a line to read it; markers are kept 180 days.
- **URL checks (synthetic HTTP monitoring).** The uptime watcher only knows whether a TCP port opens; a web fleet behind a load balancer fails with a 502, a blank page or an expiring certificate while the port stays open. The new 🌐 *URL checks* tool probes URLs on a schedule from this machine, even while the vault is locked: HTTP status against an accepted set (`200-399`, `2xx`, `200,301`…), an optional keyword the page must contain, latency, and the TLS certificate's days left (under 14 counts as failing). **Pin IP** connects to a specific backend while Host and SNI still follow the URL, so each machine behind the load balancer can be checked with the certificate still verified. Alerts fire only after N consecutive failures (toast, OS notification and the Monitoring webhook), are recorded in Notifications, appear on the Dashboard's *Needs attention* strip, and clear with a recovery event. Each check shows 24h uptime, average latency, last error and a latency chart; results are kept 30 days.
- **Tail one log across many hosts.** *Watch a log* now takes several machines at once: tick them, one path, and the lines merge in arrival order with a colour-coded `[machine]` prefix per host, status chips per session, and the filter applied to the line content rather than the prefix. Built for "which app server is throwing the 500s" on a fleet behind a load balancer.
- **Import from PuTTY, MobaXterm, WinSCP and Termius.** Hosts → `⋯` → *Import from PuTTY / MobaXterm / WinSCP / Termius…* reads a PuTTY `.reg` export (or, on Windows, PuTTY's sessions **straight from the Registry**), a MobaXterm `.mxtsessions` file, `WinSCP.ini`, or a Termius CSV export (any CSV with a hostname column works). A preview lists what was found, grouped by the original folders; tick what you want and import. Duplicates already in the vault (same address, port and user) are skipped, passwords are never read from the other client, and keys only show their path so you can import them yourself.
- **Runbooks.** A built-in operations cookbook for the jobs you do every few months and research from scratch each time: whitelist or block an IP (iptables-services, firewalld, ufw, nftables, fail2ban — each as its own tab), add a cron job, restrict a path to a few IPs in nginx or Apache (with the load-balancer real-IP caveat), add an nginx or Apache virtual host, issue and renew Let's Encrypt certificates, harden SSH without locking yourself out, add a sudo user with a key, find what fills the disk, systemd basics, MySQL database and user plus dump and restore, nginx access-log analysis, swap, listening ports, time and NTP, Docker basics, and a five-minute security check. Every step carries its command with **Copy** and **Send to the current terminal**; variables like `{{ip}}` and `{{port}}` are filled once at the top and flow into every command; steps that can drop your SSH session or destroy data are flagged and ask for confirmation before copying or sending; each runbook opens with the warnings to read first. **Your own runbooks**: write them in a simple text format (`## step`, `$ command`, notes, `!!` for danger), or *Copy to edit* a built-in one and adapt it to your infrastructure; they are stored in the vault's meta table and shown when the vault is unlocked. 📖 in the `⋯` menu and the palette. Built-in content is in Vietnamese for now.
- **Fleet inventory.** A light asset register: one read-only command per host collects OS, kernel, architecture, CPU count, RAM, root disk usage, uptime, IPv4 addresses, listening ports, virtualisation, whether a reboot is pending, and the versions of PHP, nginx, Apache, MySQL/MariaDB, Node, Docker and Python. Results land in a wide table you can search across every column ("php 7.4", "ubuntu 20", ":3306", "reboot"), cells that changed since the previous collection are highlighted with the old value on hover, the last 20 snapshots per host are kept, and the table exports to CSV. Up to 4 hosts are collected in parallel; the command runs through the login script like every other diagnostic and uses no `$()`, `sudo` or heredocs.

### Changed

- The Dashboard's *Needs attention* strip now also lists URL checks that are currently alerting.
- The uptime watcher passes host labels to the main process so its down/up events read as host names rather than addresses.

---

## [0.2.22] — 2026-09-06

### Added

- **Close to the system tray.** Closing the main window now **hides** it instead of quitting: tunnels, monitoring and the uptime watcher keep running, and your terminal tabs are exactly where you left them when you come back. A **tray icon** shows how many tunnels are up in its tooltip; a left-click reopens the window and a right-click opens a menu that lists **every tunnel with a checkbox to start or stop it** without opening the app, plus *Quit*. The first time the window is hidden a notification says so, so nobody thinks the app has crashed. Settings → **Application** turns the behaviour off (✕ quits as before). If a hidden window needs your answer — a new host key, a password — it comes back on its own instead of the question timing out in silence.
- **Tunnels that start themselves.** Every tunnel row gains a ⚡ button next to the ★ pin: click it and that tunnel **starts automatically when the app opens** — right after the vault unlocks, including the remembered auto-unlock. A lit ⚡ means it is on; the same switch also sits in the tunnel editor. Together with the tray this is "the DB tunnels are simply always there". (The flag has lived in the vault since the first tunnel release; nothing read it until now.)
- **Workbench bottom panel.** The third theme gets the docked panel from its proposal: `Ctrl+J`, ⬒ on the activity bar or the palette opens a panel **under the terminal** with three tabs — 📊 **Monitoring** (the same cards as the floating dock, laid out in a grid), 🪵 **Log** (*Watch a log*) and 🔀 **Tunnels** (the full table with Start / Edit / Delete). Drag its top edge to resize (120–600 px); height, tab and open state are remembered. In this theme starting Monitoring opens the panel instead of the floating dock at the top right; the other two themes keep the dock. All three tabs stay mounted, so a running tail or a half-filled tunnel form survives switching tabs.

### Changed

- The Workbench preview thumbnail in Settings now shows the bottom panel.

---

## [0.2.21] — 2026-09-06

### Changed

- **The Navigator theme starts at Hosts.** Dashboard is **off by default** in the Navigator menu (turn it back on in *Menu layout*, below), so the theme opens on Hosts; the 🏠 button disappears from the tab bar in this theme, since every menu entry already brings you back to the main area, and the *Startup page* setting reads *Home page* there. *Infra default* and *Workbench* keep their Dashboard and their 🏠. If an earlier version remembered you on Dashboard, the app now opens on Hosts instead of a page that is not on the menu; the same goes for any entry you have hidden.
- **The Navigator menu is yours to arrange**, the way the sidebar blocks of the Infra theme already were. A ⚙ at the top of the menu opens *Menu layout*: tick which entries show and **drag to reorder** — Dashboard, SFTP, Tunnels, Snippets, SSH Keys, Workspaces, History and Tools can each be shown or hidden; Hosts stays on because it is the home page, but it can be moved. A hidden entry is still reachable from the Command Palette. *Reset to default layout* restores the original order. Stored per machine, separately from the Infra sidebar's configuration.
- **Two columns for the list pages.** Tunnels, Snippets, SSH Keys, Workspaces and History lay their rows out in **two columns** when the area they sit in is wide enough (about 770 px), and fall back to one column in a narrower window or in the Workbench side panel. This follows the list wherever it is embedded, so a Tunnels tool tab in the Infra theme gets the same treatment.

---

## [0.2.20] — 2026-09-06

### Added

- **A third theme: Workbench** (Settings → Appearance → Theme), the VS Code arrangement. A **48px activity bar** on the far left picks what the **side panel** beside it shows — Hosts (the full host column: search, quick connect, favorites, folding groups, blocks), Tunnels, Snippets and Workspaces (start / run / open right on the row, with a *Manage…* button for the full editor), SSH Keys, History and Tools — while the **main area is always your terminal tabs**. Neither existing theme lets you look up a tunnel or a snippet while a terminal stays on screen: Infra makes the column grow, Navigator sends you home. Click the lit icon again (or `Ctrl+Shift+H`) to close the panel and keep the bar; **drag the panel's edge** to resize it, and the width is remembered. 🏠 goes home and 📁 opens the SFTP page as a tab, since those are work areas rather than lists; every panel is also a palette command. The docked bottom panel from the proposal (Monitoring / Log under the terminal) is not in this release.

---

## [0.2.19] — 2026-09-05

### Added

- **SFTP is a feature of its own.** Until now SFTP only existed as a button on a host row that opened a tab for that host. It is now an entry in its own right — **📁 SFTP in the Navigator menu**, between Hosts and Tunnels; in the Infra theme through the `⋯` menu, the Dashboard grid, *All features* or the palette, where it opens as a tab. The page opens with **your local files on the left** and a *Connect to host* card on the right; **Select host** lists your SSH hosts by group (favorites first, with a search box — Enter picks the only match), and the chosen host's files appear on the right **in place**. *Change host* and *Disconnect* sit in the header; the connection survives moving to other menu entries and coming back, and the page and the tab share one session rather than opening two. Only SSH hosts are offered, since SFTP rides on SSH. The SFTP button on a host row still opens a dedicated tab, and both paths now share one set of pane, arrow and transfer-queue components.

### Changed

- The tool catalogue can now hold tools that open as a **tab** rather than a dialog; the `⋯` menu, the Dashboard grid and *All features* go through one opener, so a tool's usage is counted the same way whichever door it came in by.

---

## [0.2.18] — 2026-09-05

### Added

- **Two themes for the whole window: *Infra default* and *Navigator*** (Settings → Appearance → **Theme**). The Dark/Light switch is still there, renamed **Color mode**, because the two are independent — either theme in either color. **Infra default** is the layout you have today: the left column lists hosts by group and unfolds them in place, and the Dashboard is home. **Navigator** is the Termius-style arrangement: the left column becomes a **menu** — 🏠 Dashboard · 🖥 Hosts · 🔀 Tunnels · 📝 Snippets · 🔑 SSH Keys · 🪟 Workspaces · 🕒 History · ⊞ Tools, with Settings and Help pinned at the bottom — and **nothing unfolds inside the column**: pick an entry and its content opens in the **main area**, where the Dashboard used to be, while your terminal tabs keep working on top exactly as before (🏠 and the palette's *Dashboard* command still take you to the Dashboard). The menu shows a count next to Hosts, Tunnels, Snippets, Keys and Workspaces, and a green dot on Tunnels while one is running; every entry is also a Command Palette command. `«` (or `Ctrl+Shift+H`) narrows the menu to icons only instead of hiding it, since each entry is an icon you can still hit. Two preview thumbnails in Settings show what each theme looks like before you switch. Switching touches no data and is stored per machine; a theme JSON exported from the Custom palette now carries the layout too, and importing one without it leaves your layout alone.
- **The Hosts page** (Navigator → Hosts) is the host book laid out in the main area: **★ Favorites** first, then your **groups as folder cards** — colour band, host count, `x/y up` from the uptime watcher, default user, a PRODUCTION badge, and the same `⋯` menu as the sidebar for *open the whole group / edit / delete* — then **every host in one flat list**, sorted by name, each row carrying its group's colour and name, so the machine you can't place in a folder is still one scroll away. Click a folder to step inside: a breadcrumb back to Hosts, the group's header with *open all N panes*, *+ Host* (with that group pre-selected) and `⋯`, and every host as a wide row — status dot, label, `user@host:port`, a badge for VNC / RDP / Telnet / Serial and for jump hops, and on hover the same actions as the sidebar row (favorite, notes, split, SFTP, duplicate, edit). **Typing in the search box flattens everything** into one list grouped by group name, so a match is never hidden inside a folder, and `user@host[:port]` still offers quick connect. *+ Host*, *+ Group* and an import/export menu (ssh_config, cloud import, export) live in the page header, and a fresh vault gets an empty state with both ways in. A host whose group no longer exists is listed under *Ungrouped* instead of disappearing.
- **History page** (Navigator → History): every recent connection the vault remembers (up to 50), showing the host's name when it was a saved host and an explicit *quick connect — not saved as a host* note when it wasn't; click a row to reconnect.
- **Tunnels, Snippets, SSH Keys and Workspaces open as pages** in the Navigator theme, reusing the exact dialogs you already know in embedded form — there is no second copy of any of them to drift out of sync.

### Changed

- The Dark/Light setting is now labelled **Color mode**; **Theme** now means the layout.
- Filtering and grouping hosts moved into one shared pure function used by both the sidebar and the Hosts page; as a side effect, a host that points at a deleted group now lands in *Ungrouped* in the sidebar too, rather than vanishing from the column.

---

## [0.2.17] — 2026-09-05

### Added

- **The sidebar is a set of blocks you arrange yourself.** The left column was a fixed order — Favorites, then host groups, then Recent — which suits you only if that happens to be how you work. Now it is a list of **blocks** you can switch off and drag into any order, through the **⚙ button** next to the search box: **★ Favorites · 🗂 Host groups · 🔀 Tunnels · 📝 Snippets · 🗂 Workspaces · 🕒 Recent**. Three of those are new here, and each does its most common job **without leaving the column**: a tunnel starts and stops on its row, a snippet opens the run dialog (which still asks which panes to target — running a snippet on the wrong pane is a real accident, so that step stays), and a workspace reopens its whole tab set. Blocks that are on but empty say so rather than rendering as blank space. **The defaults are exactly the old layout** and the three new blocks start switched off, so nothing changes for anyone who never opens the panel. Settings are per-machine.
- **Groups collapse, so the list stops growing without limit.** Every group used to be expanded at once: four groups of five or six hosts already ran off the bottom of the screen, and more hosts only made it longer. Groups now fold, remember it across restarts, and a folded group shows its **host count** — the one thing that still says what is inside. **Searching expands everything** regardless, because finding a host and then hiding it inside a folded group would defeat the search exactly when it matters. A **collapse/expand-all** button sits next to the search box once you have three or more groups.
- **Each group header now has a single `⋯` menu** holding *open the whole group*, *edit* and *delete*, instead of three hover icons crowding the host count. Delete is set apart by a divider and turns red on hover — it is the only entry there that loses data (the confirmation dialog is unchanged).
- **The `⋯` tools menu is grouped and searchable.** It was a flat list a dozen entries long that covered half the host list when opened, mixing tools with contact-book actions. It now has a **search box** (typing searches the **whole** catalogue, not just the daily shortlist), entries **grouped by area** using the same categories as the *All features* tab, *Create group* and *Import ssh_config* moved into a **Manage hosts** section of their own, and *All features / Settings / Help* pinned to the bottom where they don't scroll away.
- **The Dashboard tool grid is one row that arranges itself.** It was two fixed rows in catalogue order, so everyone saw the same tiles whether or not they had ever opened them. Tiles are now ordered by **how much you actually use each tool**, scored with a 30-day half-life so a burst of use months ago no longer holds a tile forever while this week's habit never catches up. Usage is counted wherever a tool opens — the menu, the palette, a tab — not only on the grid, so a tool with no tile can still earn one. An **Arrange** button opens a panel to **pin** tools that should always keep a tile, drag them into order, and see each tool's usage count next to it, with tools that no longer fit the row dimmed rather than silently missing. Pins and counts stay on this machine.

### Changed

- **Recent connections lists only what isn't already above it.** Opening a saved host also wrote a line there, so the bottom of the sidebar was repeating the host list and pushing the real one off screen. It now shows only **quick-connect targets that were never saved as a host** — the one thing with no other way in — and four rows instead of eight.

---

## [0.2.16] — 2026-09-04

### Added

- **Two more sync channels: WebDAV and S3.** The channel system from v0.2.15 gets its next two backends, and they slot in beside the folder and Google Drive channels — enable any mix, each with its own passphrase and status card. **WebDAV** talks to Nextcloud, Seafile, Synology, or a plain Nginx `dav_module` — point it at a folder URL, give it a username and password, done. **S3** speaks Signature V4 with no SDK attached, so it works with anything S3-shaped: AWS itself, MinIO on your LAN, Cloudflare R2, Backblaze B2 — and the key only needs `GetObject` + `PutObject` + `ListBucket` on one bucket. Server credentials are stored encrypted in the vault and only after a connection has actually succeeded; the blob stays end-to-end encrypted with a passphrase of at least 12 characters, so the server operator — including AWS — sees only noise. All the anti-overwrite guards apply to both: a renamed blob or a half-synced store stops the write instead of clobbering every other machine. A 403 from S3 is explained rather than dumped, because S3's 403 famously means three different things (wrong key, missing permission, or *file not found* when the key can't list the bucket).
- **Cloud import now covers AWS EC2, Google Cloud and Azure** (*Cloud import*, the tool formerly labeled DigitalOcean). One dialog, four providers, one flow: pick the provider, add a read-only account, fetch, tick, import — every machine lands as a host with its public IP first, private IP as fallback, and its origin (instance id, region/zone, size, tags) recorded in the host's notes. Accounts are only kept **after a fetch with them has succeeded**, so mistyped credentials never become saved accounts; everything sensitive lives encrypted in the vault and never reaches the UI process. Each provider asks for the least it can: **AWS** wants an IAM key with exactly `ec2:DescribeInstances`; **GCP** takes a service-account JSON key with the *Compute Viewer* role (paste the file, the app builds the signed JWT itself); **Azure** takes an app registration with the *Reader* role — and since Azure keeps IP addresses as separate resources, the app joins VMs, network interfaces and public IPs across three read-only calls so you don't have to. Machines whose address already has a host stay locked out of selection, same as always: re-importing never duplicates the fleet.

---

## [0.2.15] — 2026-09-04

### Added

- **Sign in with Google and sync through Drive** (*Sync → Google Drive*). Until now the folder backend needed a desktop sync client (Drive for Desktop, Syncthing…) already running on every machine; now the app talks to the Drive API directly. Sign in once per machine — the system browser opens, you approve, done; the app holds a refresh token encrypted in the vault and never shows the token to the UI layer. A new machine needs exactly two things: the Google sign-in and the sync passphrase. **Signing in never replaces the passphrase** — the blob is encrypted end-to-end on your machine before upload, so neither Google nor a stolen Google account can read it; losing the account loses one unreadable file, not the fleet. The permission asked for is `drive.file`, which by Google's own rules only reaches **files this app created** — it cannot see, list or touch anything else in the Drive; the one file it makes (`infra-companion-vault.blob`) is visible in My Drive, so the borrowed-machine trick still works: download it from drive.google.com and use *Import from file*. All the anti-overwrite guards from the folder backend apply unchanged — a renamed duplicate or a half-synced Drive stops the write instead of clobbering every other machine. Because this blob lives on a cloud drive, its passphrase minimum is **12 characters** (the folder backend keeps 8). If the connection dies — token revoked, or expired while the OAuth app is still in testing — the Sync screen says so and offers the sign-in button right there, instead of failing quietly in a background cycle. What we deliberately did not build: any server of ours (the app talks straight to Google), any scope broader than `drive.file`, and any way to skip the passphrase.
- **Sync channels run side by side.** Folder sync and Google Drive sync are no longer either-or — trying Drive used to mean turning your folder sync off first. Each is now a **channel** with its own passphrase, salt and status card: enable one, the other, or both (a NAS folder for the LAN, Drive as the off-site copy), sync or turn off each without touching the other. A sync round pulls, merges and pushes every enabled channel in turn, so machines converge no matter which channel each one uses — and a channel that fails says so on its own card instead of silencing the rest. An existing single-channel setup migrates silently, sync key and all. While a Google account is connected, the **status bar shows ☁️ with its email** — one glance answers "which account is this machine syncing through", and clicking it opens Sync.

### Fixed

- **Checking for updates minutes after a release goes out no longer dumps a stack trace.** GitHub points "latest release" at the new version the moment CI creates it, while the update files are still uploading; a check in that window got a 404 wrapped in a full page of HTTP headers. It now says what is actually happening — *the release's update files haven't finished uploading, try again in a few minutes*.

---

## [0.2.14] — 2026-09-04

### Changed

- **DigitalOcean import now holds any number of accounts.** v0.2.13 stored exactly one token, which quietly assumed everyone has exactly one DigitalOcean account — pasting a second token replaced the first. There is now an **account picker**: each token is saved under a name you choose (*Company A*, *personal*), encrypted in the vault as before, and fetching reads whichever account is selected — switch the account, fetch again, import the other fleet. The token you had already saved appears as an account named *DigitalOcean*, migrated silently on first read, nothing to redo. A new token is still only saved after a fetch with it has actually succeeded, so a mistyped token can't become a saved account — and deleting an account deletes its token with it.
- **The Dashboard puts host groups right under the tools.** The group cards — the part of the page you actually click to start working — sat below the stat tiles and the favorites, which are things you read, not things you use. And the tool grid is now **exactly two rows**, ending in an **⊞ All** tile that opens the *All features* tab: the tool list only ever grows, and the choice was between every tile getting narrower, the grid slowly eating the page, or a cut-off with the full catalogue one click away.
- **The group card's two group-wide actions swapped places.** The `⊞ N` chip in the corner now does the group's main job — open all N hosts as panes in one tab — and the footer line reads **View all hosts**. The full list then opens **in place of the cards** with a **← Back** button, not as a popup: a popup covered the whole Dashboard just to answer "what's in this group", and closing it threw away where you were. The inline list stays put while you open several machines in a row. The **SFTP** button on each row now visibly reacts on hover — it used to take the exact same hover colour as the row underneath it, so pointing at it changed nothing on screen and it read as a label, even though clicking it (SFTP) and clicking the row (SSH) do different things.
- **Downloading an update now shows up where you started it.** In *Help → Check for updates*, the download button turned into nothing — progress only appeared in the banner at the top of the window, and the install step lived there too. The button itself now shows the download percentage and becomes **Restart & install** the moment the download completes.
- **The collapsed sidebar keeps a ⚙ Settings button at the bottom.** Collapsing the sidebar removed every entry point that lived in its footer; Settings is the one you notice missing.

---

## [0.2.13] — 2026-09-04

### Added

- **Import hosts from DigitalOcean** (*All features → Import from DigitalOcean*) — the first slice of cloud import. Paste an API token (**read scope is enough**, and the app only ever calls one read endpoint — there is no code path that creates, changes or deletes anything on DigitalOcean), fetch the droplet list, tick what you want, and each droplet becomes a host: public IP first, private IP as the fallback for VPC-only machines, and where it came from — droplet id, region, image, tags — recorded in the host's notes so six months later the host still says what it is. Droplets whose address already has a host in the vault are **locked out of selection**, so running the import again after adding three new droplets creates three hosts, not a second copy of the fleet; the same guard applies within a single run. Imported hosts land in a group of your choice (the default *DigitalOcean* group is reused across runs, not duplicated), with the SSH user and key left inheritable from the group if you don't set them. The token is stored **encrypted in the vault** like the AI API key — it never crosses into the UI process, which only ever learns *whether* a token is saved — and it is only saved after a fetch has actually succeeded, so a mistyped token can't overwrite a working one. Errors come back as what happened (*token rejected*, *timed out*, *not the DigitalOcean API — a proxy in between?*) rather than a generic failure.

### Changed

- **Rotate SSH keys got its own icon (♻️).** It shared 🔄 with Sync, and on the Dashboard grid the icon is how you find a tool.

---

## [0.2.12] — 2026-08-31

### Fixed

- **Opening the cron or disk dialog no longer hammers the server.** Both re-read over SSH in a tight loop for as long as the dialog was open — the translation function is rebuilt on every render, it was listed as an effect dependency, so every result triggered another fetch. On screen it looked like flickering; on the machine it was a continuous stream of `crontab -l` or `du`/`df`. Anyone on v0.2.11 should update.
- **The cron, disk and log dialogs no longer pick a machine for you.** They defaulted to the first host in the list, and the disk one *connected and scanned it immediately* — an SSH session to a machine you never chose, which on a production box is not a small thing. All three now open on *— Pick a machine —* and do nothing until you choose.
- **Settings and Help appeared twice in the `⋯` menu.**
- **Scanning for updates timed out on RHEL-family machines.** `dnf check-update` re-downloads repository metadata whenever the cache has expired, so a scan that was supposed to read a local cache went to the network instead and blew past the timeout on a machine with several repos. It now runs with `-C` (cache-only) — which is what the screen already claimed it did — and the listing step gets a much longer budget, because even reading a large cache is not instant.
- **The update scan no longer pre-ticks every machine in the fleet.** It starts with nothing selected, and *Select all* is one button away. Ticking everything by default meant one absent-minded click opened an SSH session to every host on the list.
- **RHEL-family machines reported "0 security updates" when they had plenty.** Debian and Ubuntu put the word in the repository name (`jammy-security`), so that is what the scan read. On RHEL, Rocky, Alma and CentOS the repository is just `baseos` or `appstream` and the security information lives in separate `updateinfo` metadata — so a machine with 435 pending packages, some of them `openssl` and `kernel`, came back clean on the one number people actually look at. It now asks `updateinfo list --security` as a second, cache-only step and marks the packages it names. Wrong in the direction of reassurance is the worst way for a patch screen to be wrong.
- **The scheduled-jobs screen said a machine had no crontab while it was busily running jobs.** The command was right but it only ever looked in one of the three places cron actually lives: the logged-in user's own crontab. The jobs were root's and the system's. It now has a **scope selector** — *logged-in user* (`crontab -l`), *`sudo crontab -l`* (root's, without logging in as root; it uses `sudo -n` so a machine that wants a password says so instead of hanging on a prompt there is no terminal to answer), and *system* (`/etc/crontab` + `/etc/cron.d/*`) — and a **Read** button, because with two choices to make, fetching after the first one just spends an SSH round trip to answer a question you hadn't finished asking. The system files use a **six-field format** with a USER column between the schedule and the command, so those are parsed and displayed separately — otherwise the command reads as `deploy /usr/local/cron/backup.sh`, which is wrong in a way that is easy to miss because the schedule beside it still looks right. System scope is read-only: it spans several files, and editing those through one text box is too easy to get wrong. The six-field format isn't assumed from the scope either — a root crontab written in system format is common, so the format is **detected from the content** and shown as a checkbox you can override, because a single line cannot settle it: `0 5 * * * sh /x.sh` and `0 5 * * * deploy /x.sh` are the same shape.

### Changed

- **The new tools open in a tab, not just a blocking popup.** Watch a log, scheduled jobs, rotate SSH keys, what is filling the disk, what needs patching, and trusted fingerprints all have the **⊞** button in their header that moves them into a tab — the same thing Monitoring, Tunnels, Processes and Services have had. It matters most for exactly these: a fleet-wide patch scan takes minutes, a key rotation walks machines one at a time, and following a log is *meant* to happen while you work on something else. As a popup, all of them held the whole app hostage until you closed them. Moving to a tab restarts the tool, so a log you are already following is best opened as a tab from the start. Also, the tab router now checks the list of tool-tab kinds instead of a hand-written chain of comparisons — miss a tool in that chain and its tab silently opens as a terminal instead.
- **Every dialog now has a close (×) button.** None of them did. That was survivable while every dialog also closed on a backdrop click, but the ones that deliberately don't — long forms, the security prompts, anything you'd hate to lose a half-typed value in — were left with `Esc` as the only way out, which is not a way out if you don't know it. One button in the shared dialog frame, so all of them got it at once.
- **The `⋯` menu is a shortlist again, and there's a new All features tab.** The menu had grown past twenty entries: a dropdown that long is a dropdown nobody reads, and it only ever grows. It now holds the handful of things used daily, and ends with **All features…**, which opens a tab listing every tool grouped by area with a one-line description of what it does and a search box. New tools go there, not into the menu — Local dev moved out with them. Under the hood the menu, the Dashboard tool grid and the new tab now read from **one catalogue**; adding a tool used to mean remembering two separate lists, which is how they drifted apart in the first place.
- **The disk explorer now says what to do, not just what is big.** It answered *what is taking up space* — `log`, 23.4 GB, 95.5% of `/var` — and then left you to work out the rest yourself. Above the list there is now a verdict: which filesystem this directory is on, how full it is and how much is left, what share of the used space this directory accounts for, and **one sentence on what to do next**, with a button that does it. Four situations get four different answers, because they call for different actions: **one subdirectory dominates** → go into it (and *everything else together is rounding error*, which is the part that stops you reading the other nine rows); **the space is in files sitting directly in this directory** → going deeper will never find it, since `du -d 1` only counts directories, and one enormous `catalina.out` is a common way for a disk to fill; **nothing dominates** → it is spread out, say so rather than implying there is a culprit; **this branch is tiny next to what the filesystem has used** → you are digging in the wrong place, here is the way back up. The filesystem is matched by longest mount point and **at a path boundary**, so `/bootstrap` isn't reported as living on `/boot`, and a directory under `/var/lib/docker` is measured against that mount rather than `/`. With no `df` output the verdict says only what it actually knows instead of inventing an urgency level.
- **The patch scan now tells you the situation instead of listing package names.** A machine with 435 pending updates produced 435 package names, and the screen answered none of the questions you scan for. It now opens with the fleet in one line — how many machines were scanned, how many need patching, how many are up to date — followed by the two things that decide what you do next: how many machines have **security patches** waiting, and how many will need a **reboot** before the new version actually runs (a kernel or glibc update that isn't followed by a restart leaves the machine running the old build, so it is patched on paper and not in fact). Each machine then gets a sentence rather than a list, plus counts by area — kernel, system core, web/PHP, databases, runtimes, other — with kernel and core tinted so they're found before they're read. The package names are still all there, security ones separated out and listed first, behind a **Show N package names** toggle that is closed by default.
- The Dashboard tool grid drops to three rows past 24 tools instead of squeezing everything into two — with the list only getting longer, two rows meant every new tool made every tile narrower.
- **The log viewer suggests the usual paths.** A dropdown of where nginx, Apache, Tomcat, PHP-FPM, MySQL/MariaDB, PostgreSQL, Redis, mail and the system logs normally live, so you don't have to remember them. It lists **both** distro conventions for the same software — `/var/log/apache2/error.log` and `/var/log/httpd/error_log`, `syslog` and `messages` — because the app has no idea which distro is on the other end, and guessing wrong just sends you back to typing. The field stays free-form.

---

## [0.2.11] — 2026-08-30

### Added

- **Watch a log without giving up a terminal tab** (`⋯` → *Watch a log*). Pick a host and a path and the lines arrive in a panel you can filter (plain text or `/regex/`), invert to push noise out of the way, and highlight in place — while your terminals stay free for actual work. Until now `tail -f` cost you a whole tab that then did nothing else. It runs **`tail -F`**, not `-f`: logrotate renames the file out from under you at midnight, and `-f` follows the old inode and goes silent forever while still looking alive. It keeps the last 5000 lines — this is a window, not an archive — and follow-the-bottom turns itself off the moment you scroll up, so reading something doesn't yank you back down. Behind it is the app's first general **streaming exec channel**; the same plumbing is what a "tell me when the long command finishes" feature would need.
- **Read and edit a machine's scheduled jobs** (`⋯` → *Scheduled jobs*). Shows each cron line with its schedule in words — *every 5 minutes*, *daily at 03:00* — and the raw expression for anything too complex to describe honestly, because a wrong guess about when a job runs is worse than no guess. Editing is the crontab text itself rather than a per-row form: real crontabs carry comments and environment variables (`MAILTO`, `PATH`) that do real work, and rebuilding the file from only the parts a form understands is how you delete someone else's line. Saving replaces the whole crontab, so it always asks first — and says so louder when the host is in a group you marked **PRODUCTION**.
- **Rotate an SSH key across many machines** (`⋯` → *Rotate SSH keys*). Pick the new key, optionally the old one to retire, tick the hosts. Per machine it pushes the new key, **logs in with it**, and only then removes the old one. The invariant that makes this safe to run at all: if the new key cannot log in, the old key is kept — no exceptions, on every failure path. It runs one machine at a time so you can stop the moment something looks wrong, and the old key is removed by rewriting `authorized_keys` from a filtered copy rather than a `sed` expression, because that file decides who gets into the machine.

---

## [0.2.10] — 2026-08-30

### Added

- **Find what's filling a disk, without opening a terminal** (`⋯` → *What is filling the disk*). Picks a host, shows every filesystem with how full it is and how much is left, then lets you walk down the tree one level at a time — each directory as a row with a bar sized to its share of the level. "Disk full" is the most common server emergency and answering it has always meant SSHing in and reading `du` output by eye. It goes **one level per step** (`du -d 1`) rather than scanning the whole tree, because on a production box scanning `/` takes minutes and most of the result is never read, and it **never crosses into another filesystem** — without that, `du /` wanders into `/proc`, `/sys` and network mounts and returns a number that answers no question you asked. Directories you can't read are skipped rather than failing the scan, and the screen says so, since the parent total will then exceed the rows beneath it.
- **See which machines need patching, across the fleet** (`⋯` → *What needs patching*). Tick the hosts, scan once, and get a row per machine: how many packages are waiting, how many of those are security updates, and the package names. Machines with security updates sort to the top. Asking this today means SSHing into each box in turn, which for a couple of dozen hosts means nobody asks. It reads `apt` / `dnf` / `yum` / `apk` — detected per host — and is **read-only on purpose**: it does not run `apt update` first, because that needs root and writes to the machine, turning a diagnostic into a change (results are therefore as fresh as each machine's own last cache refresh, and the screen says so). There is deliberately **no button to install anything**: patching is something you want to be present for, and a "patch the whole fleet" button only has to be misclicked once.

### Changed

- **Vault schema v18 drops the last remnants of the removed VPN feature** — a dead `vpn_profiles` table and the `hosts.vpn_profile_id` column that referenced it. Nothing has used them for many versions. The v7 migration that created them is left untouched, as it must be; the cleanup is a new migration at the end of the list.

---

## [0.2.9] — 2026-08-29

### Added

- **The dangerous-command guard now knows *where* the command is about to run.** It only ever matched patterns, so the confirmation for `rm -rf …` looked identical whether it was going to one scratch box or five production database servers — and the most-used path in this app is *open a group as N panes and turn Broadcast on*, which turns one keystroke into N machines. A group can now be marked **PRODUCTION** (inherited by every group under it, like the default user or key). The confirmation says how many machines will receive the command and names the production ones among them, and when a production machine is in scope it asks you to **retype that machine's name** rather than accepting a single click. Nothing changes for a group you haven't marked.
- **Push a public key to a host, from one button.** A host that logs in with a password now has *Push public key to host* next to its password field: pick a key from the vault, and the app appends it to `~/.ssh/authorized_keys` and then **logs in with that key to prove it worked** before reporting success — with the wrong permissions on `~/.ssh`, sshd ignores the key silently, so "pushed successfully" without that check is a claim that is very easy to believe and often wrong. It skips the write if the key is already there (comparing the key itself, not the comment, so pushing from a second machine doesn't duplicate the line), and only offers to switch the host over to key auth *after* the test login passes.
- **A list of the SSH fingerprints you've trusted** (`⋯` → *Trusted fingerprints*). The app has always remembered a host's key on first connect and warned when it changed, but there was no way to see what you had trusted or to remove an entry. After rebuilding a server, the only option was to click past a red warning every single time — and a warning you dismiss by reflex has stopped working. Forgetting an entry makes the next connection ask again as if the host were new, and the removal syncs to your other machines instead of leaving them warning forever.
- **A "Needs attention" strip at the top of the Dashboard**, listing hosts that aren't responding, tunnels that failed, and replicas with a critical diagnosis. It appears **only when something is actually wrong** — a panel that is always present is a panel you stop reading. Hosts with no check result yet are not counted as down, and it stays quiet entirely while the watcher is off, because silence there means "no data", not "all clear".

### Changed

- **A host-group card on the Dashboard is no longer one big button.** It did exactly one thing — open every host in the group as split panes — so reaching a single machine in a group meant going to the sidebar instead, and the row of anonymous status dots could tell you *a* machine was down without telling you *which*. The card now has three separate targets. **Each host is its own chip** carrying its own status dot, and clicking one connects to just that host. **The group name** (or the `⊞ N` count) opens the group's **full host list** — every host with its `user@host:port` and status, SSH or SFTP one at a time, and *open all N panes* at the bottom — which is the only place a group with more machines than fit on the card was ever visible. **The footer keeps the original behaviour**, unchanged: open the whole group as panes in one tab. Cards show up to six host chips before folding the rest into a `+N` that opens the same list, and the footer line is now anchored to the bottom of the card so the cards in a row line up instead of each ending wherever its content happened to stop.

---

## [0.2.8] — 2026-08-28

### Added

- **Read back a password you saved.** The host editor gets a *Show saved password* link next to the password field, and each key with a passphrase gets one in the Keys list. Until now the vault only took secrets in — you could store a password and never see it again, which is an odd position for a client whose pitch is that it doesn't lock your data away, and it left no way to paste that password into a database client or a web panel. **Your master password is required again every time, even while the vault is unlocked**: with *remember* turned on the vault never auto-locks and unlocks itself on startup, so without that step anyone who sits down at a running app could read every credential you own. Five wrong attempts pause it for a minute. The value is masked until you ask, hides itself again after twenty seconds, and never enters the app's shared state. There is also a **Copy directly** button that takes the secret from the vault to the clipboard without putting it on screen at all — better while sharing a screen — and the clipboard clears itself after thirty seconds, including if you quit the app first.
- **Export your hosts to a file you can actually read** — `⋯` → *Export hosts…*, as `ssh_config`, CSV, or JSON. Until now the only way data left the app was the encrypted sync blob, which nothing but this app can open: data went in and never came out, which is a strange position for a client whose whole pitch is that it doesn't lock you into a cloud. The ssh_config it writes works with plain `ssh` in any terminal — group inheritance is resolved first, so a host doesn't lose the user, key, or jump chain it inherits, and `ProxyJump` is rebuilt from the jump chain with real aliases. **The file deliberately carries no secrets**: no passwords, no key material, no notes (the app's own guide tells you to keep app passwords there), no environment variables. It is a flat file — anyone who can open it reads all of it — and the dialog says exactly what is and isn't in it, so nobody mistakes it for a backup. Keys live encrypted in the vault rather than as files on disk, so `IdentityFile` is written **commented out** with the key's name next to it: guessing a path would produce a config that looks right and fails at connect time.
- **Move the vault by file — no sync client, no shared folder.** The Sync dialog gains a *Transfer by file* section: **Export to file…** writes the same encrypted blob anywhere you point it, **Import from file…** reads one back and merges it. It exists for the case the folder backend can't serve: you're sitting at a machine that isn't yours, with nothing but a browser. Download the blob from your cloud drive's web page, import it, work. The two directions are deliberately not symmetric — import only pulls data *in*; sending changes back means exporting and uploading the file yourself, and the dialog says so, because a silent one-way sync is how work disappears.
- **Auto-sync on a timer, and a final push when you quit.** Once sync is on, a dropdown picks the interval — off / 5 / 15 / 30 / 60 minutes, default 15. Until now sync ran only when someone clicked the button, and the merge is Last-Write-Wins: edit on two machines, forget to click, and the older edit is dropped without a word. Quitting pushes once more before the vault locks, because an interval alone still leaves a gap — make a change, close the app, and it sits on one machine until something else overwrites it. A round runs only while the vault is unlocked, and it deliberately does *not* count as activity for the auto-lock timer, so leaving it on won't hold the vault open; the quit push shares the same few-second grace window the local dev stack uses, so a hung network folder can't keep the app from closing. When a round actually pulls something in, the lists reload and a toast says how much — a background sync that changes the data underneath a stale window is worse than no sync at all.

### Fixed

- **Sync no longer overwrites the shared folder when it simply can't see the blob.** `infra-companion-vault.blob` missing was read as "first time here, nothing to merge" and the app wrote its own copy over the top. That reading is wrong in the two ways it actually happens in practice: the file is *there* under a name the app doesn't match — `infra-companion-vault (1).blob`, the name a browser gives a duplicate download — or the cloud client hasn't finished downloading it yet. Either way the write replaced every other machine's data with this one's, silently and irreversibly. The app now looks at what else is in the folder, remembers whether this machine has ever read a real blob from it, and stops with an explanation naming the file it found instead of writing. Overriding is a separate, explicit button.
- **An empty vault no longer creates a blob at all.** Nothing to sync plus nothing on the other side used to still write an empty blob — accomplishing nothing except being in position to overwrite the real data arriving a moment later.

---

## [0.2.7] — 2026-08-20

### Added

- **Create the SSH key right where the host form asks for one.** The key dropdown in *Add host* now ends with *+ Add a new key…* — pick it and a small panel opens in place: either generate a fresh ed25519 pair or import an existing private key (OpenSSH / PEM / PuTTY .ppk, passphrase supported), and the new key is selected for the host the moment it exists. Until now the form could only turn you away with *"create one under Keys"* — and closing a half-filled host form to go make a key is exactly how people ended up without one.
- **Pin a tunnel to the top of the list.** A tunnel list past ten entries is a scanning exercise every time, and the two or three you start daily are buried in it. Each row now has a ☆ next to Start — pinned tunnels rise to the top, marked with a gold stripe on the left edge, and the rest keep their A→Z order below. The order is the same everywhere the tunnels appear: the Tunnels panel (modal or tab), the Dashboard list and the detached always-on-top window, and pinning in the main window reorders the detached window immediately. Pins are per-machine, like host favourites.

### Changed

- **The ★ Favorites section in the sidebar looks like its own block now** — a soft gold tint and border around the whole section instead of a heading that renders exactly like every other group's. It sits at the top of the list, and now it also reads as the thing you put there on purpose.

---

## [0.2.6] — 2026-08-13

### Added

- **A help centre** (`F1`, the version line in the status bar, the ⓘ button next to `⋯`, or `⋯` → ❓ Help). Until now the app said nothing about itself: the version was a line of dead text in the status bar, there was no way to ask whether a newer build existed, and nothing to hand someone when reporting a problem. Four tabs, one per question you actually arrive with.
  - **About** — version, build date and commit, the Electron / Chromium / Node versions underneath, your OS and architecture, the **publisher**, and links to the source, the project page, the user guide and the licence. The publisher comes from the same field the installer uses for its own *Company name*, so the app and Windows can't end up naming two different people.
  - **Check for updates now answers, in words, every time.** The button existed nowhere and the machinery behind it was silent by design: `electron-updater` fires an event when there *is* a new version and says nothing at all when there isn't, so a check that found nothing was indistinguishable from a check that broke. It now reports one of four things — *version X is available* (with a **Download** button, progress shown in the usual banner), *you're on the latest one*, *couldn't check, here is the error*, or *this is a dev build, there is no update metadata to compare against*.
  - **Shortcuts** — the cheat sheet that used to live only on the Dashboard, now reachable from anywhere including inside a terminal (`Ctrl+/` opens straight to it). The four terminal shortcuts are rendered **from your current settings** rather than printed as constants, so the table stops lying the moment you rebind one. Both screens read the same list, so there is one copy to keep true instead of two.
  - **What's new** — the changelog entry for the exact build you are running, embedded at build time so it needs no network, with a link to the full changelog.
  - **Troubleshooting** — one click each to the app data folder, the session log folder and the recordings folder, a link to Issues, and **Copy system information** formatted to paste into a bug report. That text carries the app and OS versions and **nothing about your hosts** — no addresses, no usernames, no host names. Session logs are the opposite: they hold verbatim what your terminal displayed, and the screen says so, because that is the file people attach without rereading.

### Changed

- **The Dashboard shortcut list shows your real terminal shortcuts.** It used to print `Ctrl+Shift+C / V` and `Ctrl+F` as fixed text even after you had rebound them in Settings.
- **The update banner picks up a download started elsewhere.** Starting the download from the help centre left the banner sitting on its own "Download" button while the file came down behind it; it now switches to the progress bar wherever the download was triggered from.
- **The copyright line in the installer is fixed text instead of whatever year the build machine thinks it is.** Left unset, electron-builder stamps the *current* year at build time, so a rebuild in January would quietly relabel the same release.

---

## [0.2.5] — 2026-08-11

### Added

- **Drift checks are kept now, not thrown away** (`⋯` → 🔁 Replication master/slave → **History**). Repairing drifted data is a job that spans days — find the tables today, patch the rows tomorrow, check again the day after — and until now each **Quick scan** wiped the previous result off the screen, taking with it the only thing that answers *"is there less drift than last time, and which tables are still wrong?"*. Every quick scan, exact count and CHECKSUM run is saved automatically; nothing to press.
  - A row per run: date and time, which kind of run it was, `master → slave`, and the totals — *3 tables · 1 column · 2 variables*, or *2/5 tables differ* for an exact count. Open it and you get the full list of differences as it stood at that moment, laid out exactly like the Data drift tab so two runs can be read against each other without re-learning the screen. **All clusters** puts every cluster in one list.
  - Cluster, slave and master names are **copied into the record** as it is written, so renaming a cluster later doesn't rewrite history — and **deleting a cluster leaves its history alone**, because that history is what you use to confirm the repair worked.
  - **Deleting is yours to do**: ✕ on a single row, or **Delete all**, which follows the *All clusters* tick — one cluster or the lot. The 200 most recent runs are kept and older ones drop off by themselves, so the file can't grow without limit while you scan repeatedly during an incident.
  - Only the **differences** are stored, never the tables that matched — a database with three thousand identical tables would otherwise write three thousand useless rows on every scan. When a result is long enough to be truncated, the record says so outright rather than letting a shortened list read as the whole picture; the summary counts stay the real totals.
  - Details are encrypted in the vault like everything else, since the database and table names of a production server are not public information. The summary line stays readable while the vault is locked; opening a record's details needs it unlocked, and says so.
- **Drag a pane to move it too, once you're split.** Grab a pane's **title bar** and drop it on another pane — the two **swap places**. You can drop anywhere on the target, its whole area lights up, so you're not aiming at a 20-pixel strip. Only those two panes move: inserting instead of swapping would shove every pane after it along one slot, which in a grid of running terminals means the whole screen rearranges to move one thing. In **Main left / Main top** this doubles as *promote to main* — drop a side pane onto the big one. Only the title bar is draggable, so selecting text inside a terminal still works exactly as before, and the **⋮** menu (move left/right, set as main) is unchanged.
- **Drag a tab to move it.** The tab bar was fixed in the order things happened to be opened, which stops matching how you're working about ten minutes in. Now you drag a tab along the bar and drop it where you want, with an accent line showing exactly where it will land: the left half of a tab means *before it*, the right half *after it*, and the empty space past the last tab means *to the end*. Dragging near either edge scrolls the bar, so a target that's currently off-screen is still reachable. Dropping only reorders — it doesn't switch tabs, and nothing is reconnected: every session keeps running untouched.
- **Tool names under the Dashboard icons.** The two rows of tool icons added in 0.2.4 were icons only, with the name in a tooltip you had to hover to see. Each tile now carries a short name underneath — the same labels as the `⋯` menu, shortened where the menu name was too long for a tile (*AI troubleshooter* → *Diagnose*, *Compare config* → *Compare*). The tooltip still gives the full name.

---

## [0.2.4] — 2026-08-06

### Added

- **Pick the terminal font from a list instead of typing a CSS name** (Settings → Terminal → **Font**). The old field was a raw `font-family` string, which meant you had to already know the exact family name and got no feedback when you got it wrong. Now it's a dropdown of the fonts **actually present on this machine**, read from your operating system's font folders — the app opens each font file and reads its real family name out of the file, because filenames don't tell you (`segoeui.ttf` is "Segoe UI", `CascadiaMono-Regular.ttf` is "Cascadia Mono"). A **↻** button re-scans, for when you install a font while the app is open.
  - **A live sample** under the dropdown shows `ilI1 O0 {}[]() <=> --> │├─┤` and a shell prompt in the font you're considering, so you can judge the characters that actually matter in a terminal without closing Settings.
  - **It tells you when your font isn't really being used.** A `font-family` that names a font you don't have silently falls back to something else — the app now says so outright: *"this machine doesn't have X → the terminal is rendering with a substitute"*. It also warns when the chosen font **is not monospace**, which otherwise shows up as mysteriously misaligned columns and broken box-drawing.
- **Add a font you downloaded, without installing it into the OS** (**+ Add a font file**). Pick a `.ttf` / `.otf` / `.ttc` / `.woff` / `.woff2` and the app copies it into its own data folder and registers it for the terminal — useful on a machine where you can't install fonts, or when you just don't want a one-off font in your system list. Up to 8 fonts, 2 MB each. The family name is read from the file and stays editable in case the guess is off; files are validated by their **magic bytes**, not their extension, so a renamed non-font is rejected instead of written into the app's data folder.
  - Typing a full CSS stack by hand is still available behind **Type a CSS stack**, for anyone who wants several fallbacks in a specific order.
- **Every tool is now one click away on the Dashboard** — two rows of icons across the top, spread evenly over the full width. The `⋯` menu had grown to twenty entries: a list you had to open, read and scan every time. The icons come from the same labels as the menu, so the two can't drift apart, and hovering one names it. The **uptime watcher** tile stays lit while it's running, since that one is a toggle rather than a panel. The menu keeps every entry: it's still the way in while you're on a terminal tab with no Dashboard in sight.
- **The Dashboard is much wider, and the space is actually used** (it was capped at a narrow column while the feature list kept growing). Favourites go up to five across, the monitoring history charts up to four, and the counters stretch the full width. The four lists at the bottom — recent connections, workspaces, tunnels, keyboard shortcuts — each keep the full width but **split into two columns inside one box**, so a ten-row list is five rows tall instead of ten with half the page blank. They fold back to a single column on a narrow window.
- **Quick connect moved up next to *+ New terminal***, in the header row. Both do the same job — open a session — so they belong in the same place, and it's the first thing your eye lands on rather than a field further down the page. Type `user@host[:port]`, press Enter; a confirmation drops down under the box when what you typed looks like a target.
- **Host groups are cards now, not tiny chips.** A chip only had room for a name and a number, which isn't enough to decide whether to open a group. Each card carries a **full-height band in the group's colour**, a `⊞ N` count chip, **one dot per host** (green up, red down, grey while unknown), the group's default SSH user if it has one, the first few host names, and a footer that says what clicking actually does — *open N panes in one tab*. Deliberately a different shape from the single-host cards under ★ Favorites: those open one tab, these open the whole group, and at a glance you can now tell which is which.
  - The up/down dots and the `x/y up` ratio only appear once the **📡 uptime watcher** has actually checked those hosts. A group with no results yet shows grey dots and no ratio, rather than claiming `0/5` is down.

### Changed

- Three menu icons are now distinct, because the Dashboard shows icons **without labels** and duplicates were impossible to tell apart: **Processes** is 📋 (was ⚙, same as Settings), **Snippets** is 📝 (was ⚡, same as Bulk Execution), and **SSH Keys** gained 🔑. Same features, same places.

---

## [0.2.3] — 2026-08-06

### Added

- **Choose your mouse cursor** (Settings → Terminal → **Mouse cursor**). Nineteen to pick from, in two groups: six of your operating system's own (hand, crosshair, cell, I-beam, grab) and thirteen drawn by the app — white, black and accent-colored arrows, a ring, a dot, an 8-bit pixel arrow, and for the fun of it a sword, a heart, a pine tree, a rocket, a pencil, a lightning bolt and a cat's paw. It applies to the whole app including the terminal, while text fields keep their own I-beam.
  - **Each cursor is a pair, not one picture**: a normal state and a **hover state** for when you're over something clickable. Pick the sword and you don't get a browser hand on every button — you get the sword, scaled up a touch with an accent-colored glow behind it. Both states come from the same drawing, so they can never drift apart, and the glow follows your accent color. The OS cursors get the conventional pairing instead (grab becomes grabbing, the rest become the hand). A **try-out strip** under the picker shows all three states — normal, clickable, text field — side by side so you can judge a cursor without hunting around the app for something to hover.
  - Every app-drawn cursor is outlined twice — a soft dark halo under a thin white rim — so it stays legible on the black terminal, on light panels, and on a busy background image alike. A single outline always vanishes against whatever background shares its color.
  - **Or add one you downloaded** — PNG, GIF, WebP, SVG, CUR or ICO, as many as twelve of them, each with an optional second image for its hover state (the dashed slot next to the thumbnail). Three things are worth knowing before you go shopping for cursors, because none of them announce themselves: Windows **`.ani` files cannot work** in any browser engine, so animated cursor packs are out and the app says so instead of silently doing nothing; an animated GIF keeps only its first frame; and Chromium **ignores any cursor image larger than 128×128 without raising an error**, so anything bigger is scaled down on import rather than left to quietly fail. Each cursor has an **X / Y hotspot** — which pixel is the actual pointing tip — so a ring or crosshair can be centred instead of clicking from its corner; the hover image shares that hotspot, so pick one the same size.
  - The app ships none of the well-known cursor themes on purpose: they come with their own licences. Download the one you want and add it.

### Fixed

- **Garbled text after switching between terminal tabs.** Come back to a tab you had left a few times and the text could turn into mangled shapes — fragments of the wrong letters — until you dragged a selection over it, at which point it snapped back to normal. The GPU renderer keeps only the *coordinates* of each character inside a glyph atlas on the graphics card; a tab that isn't showing is hidden outright, and the browser is free to throw that atlas away while it is. Returning to the tab usually changed neither the width nor the height, so nothing was redrawn and the stale coordinates kept pointing into an atlas that no longer held what they expected. Selecting text worked because it forced those lines to be drawn again. The tab now rebuilds its glyphs whenever it comes back into view — including panes that are visible but not focused in a split. The same repaint runs when the display scale changes, so dragging the window to a monitor at a different scaling no longer corrupts the text either.

---

## [0.2.2] — 2026-08-05

### Added

- **Master ↔ slave replication monitoring, with the fix in hand** (`⋯` → 🔁 **Replication master/slave**, Command Palette, or its own tab). The question this answers is the one you actually ask at 2 a.m.: *is the slave behind, by how much, why, and what do I type now?*
  - **One master, all its slaves, one screen.** A cluster is declared once — master plus however many slaves you have — and each cycle reads the master **once**, then compares every slave against that single snapshot. Lighter on the master than one connection per slave, and it means the differences *between* slaves are meaningful: they were all measured against the same binlog position. Each slave keeps its own connection, its own diagnosis and its own alert state, so one broken slave neither blocks nor silences the others.
  - **It measures drift three ways, because `Seconds_Behind_Master` lies.** That number reports 0 while the IO thread is dead (the slave has applied everything it managed to fetch — which is nothing), and reports hours on a deliberately delayed replica where that is entirely normal. So the panel also shows the **binlog byte gap in both directions** — how far the IO thread is behind the master, and how far the SQL thread is behind what it already fetched — and subtracts any configured `MASTER_DELAY` before deciding anything is wrong. When the two sides are on different binlog files it reports *"3 binlog files behind"* rather than inventing a byte count it cannot know.
  - **Every problem comes with a runbook you can copy.** 15 diagnosis rules, each with read-only checks first and fixes second, with the real values already filled in: error 1236 knows which binlog file went missing and says plainly that `START SLAVE` will not help; error 1062 pulls the table name out of the error message and builds the `SELECT` for both sides so you can compare the row *before* deciding; a corrupt relay log gets a `CHANGE MASTER TO` with your actual `Exec_Master_Log_Pos` already in it. Commands that can lose data are labelled and ask for confirmation before they even reach your clipboard — and the app never runs any of them itself.
  - **Two ways to reach the database, whichever your network allows.** It prefers a direct MySQL connection tunnelled through the host's existing SSH jump chain, and falls back to running `mysql` over SSH when port 3306 is closed. By default it uses the credentials already on the server (`~/.my.cnf` or unix_socket auth for your SSH user), so the app never touches a database password; if you do give it one, it's encrypted in the vault and reaches the server only through a temporary 0600 `.cnf` file — never on a command line where `ps` would show it.
  - **A different MySQL account per machine, if that's how yours are set up.** The cluster keeps one default user and password, and the master plus every slave can override it individually (⚙ on the row) — override just the user, just the password, or both; anything left blank still falls back to the cluster default. The ⚙ lights up wherever an endpoint has its own, so you can see which ones differ without opening them.
  - **Or point it at one of your saved tunnels** — pick a tunnel instead of a host for either end. This is the case where MySQL isn't on the SSH host at all but on another machine inside the network (`10.20.30.40:3306`), reachable only through the tunnel. The app starts that tunnel if it isn't running and connects to its local end, so it reuses the exact route the tunnel already worked out — including the one that has to go through `nc` on the innermost machine, which a plain `direct-tcpip` from the gate gets wrong. Tunnel mode needs a MySQL user and password (the connection starts on your machine, so the server's own credentials don't apply) and says so in the form.
  - **Background alerting that survives the vault locking.** Turn on *Watch in background* per cluster and you get toast, OS notification and webhook (Slack / Google Chat / Discord / Telegram) when replication breaks, when a slave starts accepting writes, or when lag crosses your threshold — with the same hysteresis the resource monitoring uses, so a value hovering at the threshold doesn't flap. Thresholds are set per cluster but each slave breaches and recovers on its own; alerts are labelled `<cluster> · <slave>` and the webhook payload carries the slave as its own field. Connections stay open, so alerts keep firing after the vault auto-locks at 15 minutes.
  - **Data drift, not just replication status** (the *Data drift* tab). Replication can say `Yes/Yes/0s` while the data has quietly diverged — someone wrote to the slave, an old `sql_slave_skip_counter` left a hole, or `binlog_format=STATEMENT` made `NOW()` disagree. A quick scan compares the table list, columns, indexes and the configuration variables that matter (`server_id`, `read_only`, `binlog_format`, binlog retention…), marking as *expected* the ones that are supposed to differ. Row counts there are InnoDB **estimates** and labelled as such; to conclude anything you tick the suspicious tables and run an exact `COUNT(*)` or `CHECKSUM TABLE`. Runs against one slave at a time — pick which when the cluster has several. If replication filters are in play, out-of-scope tables are dimmed: a difference there is intentional.
  - **Cheap enough to leave running.** A cycle is nothing but in-memory metadata reads: `SHOW MASTER STATUS` once for the whole cluster, `SHOW SLAVE STATUS` per slave, and a direct `SELECT @@global.read_only` — about 32 statements a minute for a master plus three slaves at the 15-second default. The expensive `SHOW GLOBAL VARIABLES` is read on connect and then only every 5 minutes, because `server_id` and `binlog_format` don't change between polls; `read_only` is kept on the fast path anyway, since a slave that starts accepting writes needs to be caught in seconds. Connections are held open (one per endpoint), and a slave measured through the CLI path shows an amber badge — that route spawns a `mysql` process per cycle, so the driver is worth preferring when the port or a tunnel is available.
  - Works with MariaDB and MySQL, including **MySQL 8.4 where `SHOW SLAVE STATUS` no longer exists**; the app detects the version and uses the right statement. Reading status needs `REPLICATION CLIENT` — the app says so up front instead of failing with a confusing permission error.

### Changed

- The breach / dead-band / recover state machine behind threshold alerts moved into a shared module, so resource monitoring and replication alerting cannot drift apart in how they decide something is wrong. Behaviour for existing monitoring alerts is unchanged.

---

## [0.2.1] — 2026-08-01

> **If you are on macOS or Linux, take this release instead of 0.2.0.** The 0.2.0 tag only produced a Windows installer: the macOS and Linux build jobs stopped at the test step because of the first item under *Fixed*, so no `.dmg` / `.AppImage` was published for it. Nothing about the Windows 0.2.0 build was affected.

### Added

- **Open the long-running tools in a tab instead of a popup** — **AI troubleshooter**, **Tunnels**, **Processes** and **Services** each have an **⊞ Open in tab** button in their popup header (and a Command Palette entry). A popup is modal: while the AI works through a diagnosis step by step, or you watch a tunnel come up, the rest of the app is blocked. In a tab you can keep working, switch away and come back — the session keeps running, because the tab and the popup are the *same* component reading the same state.
- **Tunnels in their own always-on-top window** (⧉ **Detach** in the Tunnels header, or the Command Palette) — the same idea as the detached monitoring window: a small window that stays on top and lets you see and start/stop tunnels while your DB client or browser covers the app. It shares the app's live tunnel events, so it needs no second connection of its own.
- **Tunnels are sorted by name (A→Z)** everywhere they appear — the list, the tab, the detached window and the Dashboard. Sorting is natural and case-insensitive, so `db2` comes before `db10` and `DB2` before `db11`. Previously they came back in creation order, which tells you nothing once you have a dozen of them.
- **Edit a local site — custom domain, site kind, docroot, PHP version** (✎ on any site row). Until now everything about a site was decided once, when you added it, and nothing could be corrected afterwards:
  - **Any domain you want**, not just the generated `<slug>.localhost` — `myshop.test`, `blog.local`, or a real domain. The app validates it (no spaces/newlines — those would break the nginx config), refuses a domain already used by another site or by its own database tools, and regenerates the vhost immediately. If the domain doesn't end in `.localhost` it also tells you right there that your machine won't resolve it on its own, and points at the two ways to fix that.
  - **Override the detected kind** (WordPress / PHP / static) or press **Re-detect**, which now also tells you *why* it guessed — e.g. *"Guessed WORDPRESS because of: wp-config.php"*. Detection runs on the folder contents and can legitimately be wrong (you pointed at a parent folder, or a stray `wp-*.php` sits in the repo), and a wrong guess used to be permanent.
  - `artisan` now wins over WordPress markers, so a **Laravel project that happens to contain a `wp-*.php` file is no longer labelled WordPress**, and its docroot is `public/`.
- **Serve sites without a port in the URL** — two independent ways, because port 80 isn't always available:
  - **Settings → Local dev → Use port 80** — sites become `http://my-site.localhost/`. Windows doesn't require admin rights for port 80, but it's often already held by IIS / *World Wide Web Publishing Service* / http.sys; when that happens the app **falls back to your port range and says so** in the warnings instead of failing to start.
  - **🎯 Open without a port** on any site row — opens a Chromium window whose DNS override maps the site's domain straight to `127.0.0.1:<real port>`. The URL has no port, **no hosts file entry is needed**, and it works with any custom domain even while something else owns port 80. (Same mechanism as *point a domain at a server*; it only applies to that browser window.)

### Fixed

- **The URL on a site row could point at a dead port** — it was stored when the site was added, so after changing the port range (or switching port 80 on) the link opened a port nothing was listening on. It now always reflects the port nginx is actually using.

- **Browser detection built Windows paths with the host platform's separator** — the *point a domain at a server* feature looks for Chrome/Edge/Brave/Vivaldi at their standard install paths, and joined those paths with the separator of whatever OS was running. On Windows that's correct; on macOS/Linux the same input produced `C:\Program Files/Google\Chrome\…` (a `/` spliced into the middle), so the detection unit tests failed there and took the release build with them. Those paths are Windows paths by definition, so they're now always joined the Windows way — identical output on every platform. No behaviour change for users, who run this on Windows.
- **Secret scanning no longer trips over a test fixture** — the WordPress `wp-config.php` rewrite test contains two invented database passwords so it can assert the generated file byte for byte. The generic-API-key rule flagged one of them as a leak and failed the scan; the file is now allowlisted by path in `.gitleaks.toml` (with the reasoning written next to it), the same way three PEM-header false positives already were.

---

## [0.2.0] — 2026-07-29

Two additions that take the app past "SSH client": it can now **run your PHP/WordPress sites locally** (no Laragon/XAMPP), and it can **point a domain at one specific server** so you can test a single machine in a load-balanced cluster.

### Added

- **Local dev stack — run local PHP / WordPress sites without Laragon or XAMPP** (Windows for now, **opt-in** under **Settings → Local dev**; nothing is written to disk until you enable it). The app downloads and supervises its own portable runtimes, so the installer stays the same size and you decide what lands on your machine:
  - **Runtimes it installs for you** — PHP 8.3 / 8.4 (NTS), Nginx 1.30, MariaDB 11.4 LTS, plus optional tools: **Adminer**, **phpMyAdmin**, **Composer**, **WP-CLI**, **Node.js 24 LTS + npm**, **mkcert**. Every download is checked against a **SHA-256 pinned inside the app**; where upstream publishes no checksum (nginx) the app computes one and records it in a provenance file next to the runtime, and says so in the UI. Downloads stream with progress and fall back to mirrors, each binary is smoke-tested right after install (so "missing Visual C++ Redistributable" is reported *then*, not at first start), and a **📁 install-from-file** path exists for when a corporate network or antivirus blocks the download.
  - **Service manager** — start/stop/restart Nginx, MariaDB, and a pool of `php-cgi` workers individually or all at once, with per-service state, PID, port, uptime, restart count, and the **last 20 lines of stderr when something crashes** (so you get the reason, not just "stopped"). Crashes auto-restart with backoff; shutdown is always graceful (`nginx -s quit`, `mariadb-admin shutdown` — never a hard kill on `mysqld`, which would mean InnoDB crash recovery next start). If the app itself was killed, **orphan processes left holding your ports are detected and reaped** on the next start — identified by executable path, never by PID (Windows recycles PIDs fast enough to kill an innocent process).
  - **Sites** — point at a project folder you already have; the kind (static / PHP / WordPress) is auto-detected. Every config file (nginx vhost, `php.ini`, `my.ini`) is **regenerated from the database on each apply**, and every reload is gated by `nginx -t` so one bad vhost can't take the whole stack down. Sites are served at `http://<slug>.localhost:<port>` — **no hosts-file edit and no admin rights**, because browsers resolve `*.localhost` to loopback themselves (RFC 6761). Site logs go into the app's own area, never scattered into your project folder, and **⌨ Terminal** opens a shell at the site root with PHP, `composer`, `wp`, `node` and `npm` already on `PATH`.
  - **Databases** — MariaDB listens on **3307+ (not 3306)** so an existing XAMPP/Laragon/MySQL install keeps working; the data directory lives **outside** the runtime folder, so upgrading or removing a runtime never touches your data. One click provisions a **database + user + grant per site**, `root` gets a generated password (not a blank one — a vulnerable local site would otherwise reach every other site's data), and you get **.sql export / import**, a **"write these credentials into `wp-config.php`"** action (backs the file up first, and refuses if the file doesn't actually look like `wp-config.php`), plus **Adminer** or **phpMyAdmin** to browse the data.
  - **Ports** are allocated automatically inside a range you choose, remembered per purpose (so a bookmarked URL keeps working), and Windows/Hyper-V reserved ranges are skipped.
- **Point a domain at a specific server — without touching your hosts file** (`⋯` → **🎯 Point domain at a server**, or the Command Palette). Testing one machine in a load-balanced cluster used to mean opening `C:\Windows\System32\drivers\etc\hosts` as admin and editing an IP by hand, every single time. Instead, list the domains once (`www.example.com`, or `*.example.com`) plus the IP of each server, then click a server and hit **Open**: the app launches a Chromium browser window whose **DNS override is scoped to that window only**. Three consequences worth the change:
  - **No hosts file, no admin rights** — nothing to clean up if the app dies, and no other application on the machine is affected.
  - **HTTPS still validates** — the hostname in the URL is unchanged, so SNI and the `Host` header stay real and the certificate matches (unlike browsing `https://<ip>/`).
  - **All servers at once** — *Open all N* gives you one window per server, each with its own cookie jar, so logging into LB1 doesn't clobber your session on LB2. A hosts file can only ever point at one of them.

  There's also a **Copy curl command** button (`curl --resolve`, the same trick from a terminal). Requires a Chromium browser (Chrome / Edge / Brave / Vivaldi — Firefox has no equivalent flag), and it has no effect if the machine routes through a system proxy, since the proxy resolves DNS itself.

### Known limits of the new local dev stack

Windows only for the moment (the OS-specific work is isolated behind one adapter). `.test` domains and local HTTPS are not wired up yet — mkcert installs and is on `PATH`, but issuing and trusting a certificate is still a manual `mkcert -install`. There is no WordPress downloader (point the app at a folder you already have) and no local↔server deploy or public-share link yet.

---

## [0.1.34] — 2026-07-28

### Fixed

- **Tunnels through a login-script host reach the right machine again (regression from v0.1.31)** — when the via-host's login script `ssh`-es into another machine (you land on a gate, the script runs `ssh app-06`), the destination you typed is an address **on the inner machine's network**. v0.1.31 started sending every concrete destination out as a native `direct-tcpip` channel from the **SSH endpoint** (the gate) instead: private ranges like `192.168.1.x` usually exist on both sides, so the gate either opened the connection to a completely different box or had its SYN dropped by a firewall. sshd only confirms the channel *after* its `connect()` returns, so a dropped SYN left the channel hanging with no error — the tunnel stayed green while the DB client sat waiting for a greeting that never arrived (*"Lost connection to server at 'handshake: reading initial communication packet'"*). Local forwards through a login script with a nested `ssh` now go through **`nc` on the inner machine first** (as they did up to v0.1.30), and only switch to a native forward if that path dies before the destination has said anything — so the v0.1.31 case (destination reachable only from the gate) still works, automatically. Login scripts with only `su`/`sudo`, and hosts without a login script, keep taking the native path.
- **Switching route mid-connection is invisible to the client** — anything the client already sent is replayed byte-for-byte into the new channel, so client-speaks-first protocols survive the switch too.
- **A `direct-tcpip` that never gets confirmed no longer hangs the client** — if the SSH endpoint doesn't confirm the forwarded channel within 15 s (typically a firewall silently dropping packets on the way to the destination), the connection is dropped and the tunnel shows *"no response — firewall in the way?"* instead of leaving the client to time out on its own.
- **`nc` that can't reach the destination is now reported** — the marker is printed *before* `nc` runs, so "marker seen" never meant the destination was reachable; a `nc` that fails to connect used to produce the same silent empty stream. Its stderr (or an explicit "couldn't reach *dest*") now lands in the tunnel's status detail.

---

## [0.1.33] — 2026-07-26

### Fixed

- **Terminal auto-complete no longer steals focus / locks the screen** — with the suggestion dropdown open, pressing **Tab** to insert a command also moved keyboard focus off the terminal (onto the lock-vault button), so the next **Enter** locked the app instead of running the command. The dropdown's navigation keys (Tab / Enter / ↑ / ↓ / Esc) now suppress the browser's default behaviour, so focus stays in the terminal and Enter runs the command you just inserted.
- **Compare "Columns" view fits all servers on screen (up to 5)** — comparing configs across servers in the Columns view previously forced a horizontal scroll, so you could only see one column at a time. With **5 servers or fewer**, all columns now share the width and stay visible side by side; long lines wrap and you scroll **vertically** (rows stay aligned by line number for easy comparison). With more than 5 servers it keeps a minimum column width and scrolls horizontally.

---

## [0.1.32] — 2026-07-23

### Added

- **Terminal auto-complete for your own commands** — define abbreviations (trigger → full command) under **Settings → Auto-complete**, then typing the first few characters of one in any SSH/local terminal pops up an **IDE-style suggestion dropdown** next to the cursor. **↑/↓** to pick, **Tab** (or **Enter** on a picked item) to insert the full command, **Esc** to dismiss. Perfect for long commands the shell can't Tab-complete — `docker compose …`, `kubectl …`, `systemctl …` one-liners, etc. Aliases are stored on this machine and the whole feature can be toggled off.
- **Compare config across many servers at once** — the config-compare tool now takes **any number of hosts** (not just two) and offers **three views you choose before diffing**: **Baseline** (one server as reference; every other shows how many lines differ + a side-by-side diff), **Group** (servers with identical content are grouped, and differing groups diff against the largest), and **Columns** (all servers side by side with differing lines highlighted, plus an "only differing lines" toggle). Pick hosts fast with **quick-pick chips by group or workspace**, and re-use a path from the **recent-paths history**. It can also open in its **own tab** now (**⊞ Open in tab**, or the Command Palette), not just the popup.

---

## [0.1.31] — 2026-07-22

### Fixed

- **Port-forward tunnels through a login-script host now connect (native `direct-tcpip` preferred over `nc`)** — when the tunnel's via-host had a login script (su / sudo / nested `ssh`), the app forced *every* forwarded connection through `nc <dest> <port>` running inside the shell. For a concrete destination address (e.g. a database IP), that path is both unnecessary and fragile — pushing a binary protocol like MySQL through a shell/su pipeline corrupts the stream, so clients failed at *"reading initial communication packet"* even though the tunnel showed green. A login script affects the interactive shell, **not** the SSH transport, so a native forward from the via-host works exactly like `ssh -J` / other SSH clients. The app now prefers native `direct-tcpip` whenever the destination is a concrete address, and only falls back to the `nc`-in-shell path if that native forward is refused (destinations reachable only after a nested `ssh` inside the login script). Loopback destinations (`localhost` / `127.0.0.1`) with a login script still use `nc`, since there they mean the deep host's localhost.
- **Tunnel forward failures are no longer swallowed silently** — a local-forward tunnel that couldn't reach its destination stayed green while every connection died with no explanation. The real reason (e.g. *"administratively prohibited"*, missing `nc`, destination refused) is now surfaced in the tunnel's status detail.

---

## [0.1.30] — 2026-07-22

### Added

- **Open Monitoring in its own tab** — besides the floating dock and the detached always-on-top window, you can now open the monitoring dashboard as a **full tab**, just like a server tab. Use **⊞ Open in tab** in the monitor config dialog, click **⊞** on the dock header, or run it from the Command Palette. Its **charts and text are noticeably larger** in a multi-column grid, so a wall of hosts is easy to read at a glance. Opening the tab **hides the floating right-side dock** (no more duplicate view), and the tab has a **minimize (–) button** that switches back to the dock — so you can flip between tab and dock at will. It reads the same live data in every mode.

### Changed

- **Shorter tool-menu labels** — the ⋯ tool menu dropped the parenthetical descriptions that cluttered each row: *"Uptime watcher (green/red dots)" → "Uptime watcher"*, *"Processes (top)" → "Processes"*, *"Services (systemd)" → "Services"*, *"Compare config (2 hosts)" → "Compare config"*, *"Sync (E2EE)" → "Sync"*. The feature screens themselves keep their descriptive titles.

### Fixed

- **Installed app no longer borrows the "Electron" name/icon on the taskbar** — the packaged app and the dev build shared one Windows AppUserModelID, so if you ever pinned the dev build once, Windows tied that identity to `electron.exe` and the installed app's taskbar button then showed the Electron name/icon and pinning it reopened the Electron welcome screen. The dev build now uses a separate AppUserModelID (`…​.dev`), so the installed app always keeps its own clean identity. (One-time cleanup on an already-affected machine: remove the stray *Electron* Start-menu shortcut and restart Explorer.)

---

## [0.1.29] — 2026-07-21

### Fixed

- **SSH "Key + Password" auth now actually completes the login** — the 2-factor method added in v0.1.28 presented the key but never sent the password against servers that require `publickey` **then** a password: the underlying SSH library walked its authentication methods once in a fixed order (`password` before `publickey`) and gave up right after the key's partial success, so the password was never sent a second time. The app now forces the correct order (key first, then password) and also answers a **PAM keyboard-interactive** password prompt — the usual case on RHEL / AlmaLinux — so `AuthenticationMethods publickey,password` (and `publickey,keyboard-interactive`) now logs in just like it does in PuTTY / OpenSSH.

---

## [0.1.28] — 2026-07-21

### Added

- **SSH "Key + Password" auth (2-factor)** — a new authentication method for servers that require *both* a public key **and** an account password in the same login (OpenSSH `AuthenticationMethods publickey,password`). Pick **SSH Key + Password** in the host (or group) editor, choose the key, and enter the password; the app presents the key first and answers the password prompt when the server asks for it. Leave the password blank to be prompted at connect time. No vault migration — it reuses the existing key/password fields.
- **Name your tunnels** — the tunnel editor now has an optional **Name** field, so a long list of port-forwards stays readable (e.g. *"Prod DB"*, *"Staging Grafana"*). The list shows the name on top with the actual route (`:port → host:port`) underneath, so you always see where a named tunnel points. Leave it blank and it falls back to the route description as before — no migration needed.

### Fixed

- **Paste no longer fires twice or ignores your custom shortcut** — the terminal's built-in browser paste ran *on top of* the customizable Paste shortcut, so Ctrl+Shift+V pasted twice and kept pasting even after you rebound Paste to a different key. The native paste is now suppressed and pasting goes through a single path: your bound shortcut (default Ctrl+Shift+V) or right-click. As a result, plain Ctrl+V no longer auto-pastes unless you bind Paste to it — matching standard terminal behavior.

---

## [0.1.27] — 2026-07-20

### Added

- **Customizable keyboard shortcuts** — a new **⌨ Keyboard shortcuts** tab in Settings lets you rebind the terminal shortcuts: **Copy selection**, **Paste**, **Find**, and **AI explain selection**. Click a shortcut, press the new combo (must include Ctrl/Alt/Meta, or be an F-key), and it applies immediately to open terminals — no restart. Esc cancels recording, a ⚠ flags conflicts, and one button resets all to defaults (Ctrl+Shift+C / V / E, Ctrl+F). Right-click paste keeps working regardless.

### Fixed

- **Empty groups can now be renamed and deleted** — groups with no hosts were hidden from the sidebar entirely, so once you created one you were stuck with it. Empty groups now show up (when you're not searching) with a subtle "no hosts yet" hint, and every group header gained a **trash button** for quick deletion (with confirmation). Deleting a group never deletes its hosts — they move to *Ungrouped*.

---

## [0.1.26] — 2026-07-20

### Added

- **Compare config across 2 hosts** — new **🔍 Compare config** in the ⋯ menu: pick two SSH hosts and a file path (by default the *same* path on both sides — the common case of the same config on many servers) and get a **side-by-side, line-by-line diff** with added / removed / changed lines highlighted, line numbers on each side, and a `+ / − / ~` summary. File contents are read over a **dedicated exec channel** (`cat`, capped at 1 MB, `test -f` guards against directories) — it never touches an open terminal and works through login-script hosts like Bulk/Processes.
- **Split: merge all *or* pick tabs** — the **Split** button now opens a small menu instead of always grabbing every open terminal: choose **Merge all** (old behavior) or tick **only the tabs you want** to combine into one split view. Splitting back and re-splitting no longer sweeps in servers you didn't want.
- **Reorder panes & choose the main window** — every split pane header gains a **⋮ menu** with **Set as main window** (promote any pane to the large slot in the *main-left* / *main-top* layouts — previously stuck on whichever pane happened to be first) plus **Move left/up** and **Move right/down** to rearrange panes freely.

### Notes

- No vault/schema migration in this release — these are UI/tooling additions only.

---

## [0.1.25] — 2026-07-19

### Added

- **TOTP 2FA autofill in login scripts** — hosts that ask for a Google Authenticator code on login can now log in hands-free: paste the account's **base32 TOTP secret** into the host editor (stored encrypted in the vault; it never leaves the main process), then use the **`{{totp}}`** token in a login-script *send* field (e.g. expect `Verification code:` → send `{{totp}}`). The app substitutes a **fresh 6-digit code at the moment the step is sent**, so slow multi-hop chains don't hand over an expired code. RFC 6238-compatible (verified against the RFC test vectors).
- **Group colors on tabs, panes and the sidebar** — give a group an accent color in the group editor (production red, staging yellow, …) and every host in it gets a colored stripe on its **tab**, its **split-pane header** and its **sidebar row** — one glance tells you which terminal is production before you type into it.
- **Background uptime watcher** — toggle **📡 Uptime watcher** in the sidebar ⋯ menu and the app TCP-checks every saved host once a minute **without opening any session**: a green/red dot next to each host in the sidebar shows reachability (hover for latency). Turns off cleanly; state is remembered.
- **Process viewer (top)** — **⚙ Processes** in the ⋯ menu / command palette: pick a host and get a live `top`-style table (CPU%, MEM%, RSS, runtime, command) over a dedicated exec channel — no terminal tab needed, login-script hosts work like Bulk. Sort by CPU or RAM, filter, optional 5s auto-refresh, and **kill** (TERM or force -9) with a confirmation.
- **Services manager (systemd)** — **🧰 Services** in the ⋯ menu / palette: list every systemd service on a host with its state, **start / stop / restart** with confirmation (root may be required — systemctl's own error is shown if not), and read the last 120 lines of **journalctl** for any unit right in the window.

### Notes

- The vault schema migrates automatically (v11: encrypted TOTP seed per host + group color). Synced vaults carry both fields; older app versions simply ignore them.
- `{{totp}}` substitution applies to interactive terminal sessions. Exec-channel features (Bulk/Monitoring/SFTP) don't substitute it — OTP prompts don't appear on those paths in practice.

---

## [0.1.24] — 2026-07-18

### Added

- **Pop the monitor panel out into its own window** — the dashboard monitor now has a **⧉ pop-out** button in its header. It opens a small, always-on-top window that keeps showing your hosts' live metrics **even when the main app is minimized** or hidden behind other windows. While popped out, the in-app dock hides so there's only one monitor on screen; move and resize the window freely, **⧉ Merge back** returns it to the in-app dock, and **■ Stop** ends monitoring from either place. It draws from the same monitoring session — no extra SSH connections are opened.
- **Pick hosts to monitor by workspace or group** — the **⚠ Monitoring** dialog has new **Quick select** chips: click a group or a saved 🗂 workspace to tick all of its SSH hosts in one go (click again to untick them), instead of hunting through the host list one by one.

### Changed

- **The app icon now fills its frame** — the logo mark used to sit small in the middle with a lot of empty space around it, so it looked tiny in the taskbar and title bar. It has been recropped to fill the icon and now reads clearly at every size.
- **The monitor panel is easier to resize** — a visible **◢** grip in the bottom-right corner makes it obvious you can drag the panel larger or smaller (both width and height).

---

## [0.1.23] — 2026-07-16

### Added

- **Split layouts** — when panes are split you can now arrange them five ways instead of only the automatic grid: **Auto grid**, **Side by side** (columns), **Stacked** (rows), **Main left** (one large pane on the left, the rest stacked beside it), and **Main top** (one large pane on top, the rest in a row below). Switch instantly from the **▼** next to the **Split ON** button, or set the default in **Settings → Terminal → Split layout**. Dragging the dividers to resize still works (for the *main* layouts you drag the main/secondary split).
- **Pane frame styles** — choose how each split pane's header looks in **Settings → Terminal → Pane frame**: **Compact bar** (status dot + title + ✕, the default) or **Mac style** (rounded window corners with a round red close button). 
- **Command palette button on the terminal toolbar** — the palette was previously reachable only via `Ctrl+Shift+P`, which many people never discover; there's now a **⌘ Commands** button on the toolbar that opens it. The shortcut still works exactly as before.

### Changed

- **The terminal scrollbar is now thin and unobtrusive** — it was stubbornly wide because xterm ≥6 draws its own overlay scrollbar (VS Code style, 14px, sized inline by JS), so the previous CSS never touched the element actually on screen. It's now slimmed to ~7px with a subtle theme-matched thumb that fades when idle. (Root cause of the earlier "the scrollbar won't shrink" was a global `scrollbar-width` rule that silently disabled all custom scrollbar styling in modern Chromium — removed.)
- **Split-pane headers are a touch smaller** so they take less vertical space, and the **Split ON** button now matches the height of the neighbouring toolbar buttons.

---

## [0.1.22] — 2026-07-15

### Added

- **AI troubleshooter now keeps a history** — every diagnosis session (its symptom, the read-only commands that ran with their output, and the final conclusion) is saved locally when it finishes, stops, or errors. Reopen the **🩺 AI troubleshooter** and past sessions appear under **Diagnosis history**: click one to review it read-only, or delete it. The last 50 sessions are kept; the steps and conclusion are **encrypted with your vault key** at rest (server output can be sensitive), so viewing history requires the vault to be unlocked.
- **The AI troubleshooter can be minimized** — while the AI is thinking or running a command you no longer have to sit and wait: press the **–** button to drop the window to a small pill (bottom-right) and keep using the rest of the app. The pill shows live status (analyzing / running / **needs your approval** / done) so you know when to click it back open; the session keeps running in the background the whole time.
- **AI troubleshooter added to the ⋯ menu** — it was previously reachable only from the command palette; it now has its own entry (🩺 AI troubleshooter) in the sidebar tools menu.

### Fixed

- **AI diagnosis conclusion no longer gets cut off mid-sentence** — the final conclusion (root cause + fix steps) is the longest part of a session and, in Vietnamese, consumes 2–3× more tokens than English, so the old fixed 1,500-token cap truncated it right where it mattered most. The diagnose output budget is raised to 4,096 tokens, and for Claude a continuation pass automatically resumes generation whenever a response is cut by the token limit — so conclusions come through complete no matter how long. The higher budget also applies to OpenAI/Gemini/Ollama (Ollama's `num_predict` was previously capped low enough to clip output).

---

## [0.1.21] — 2026-07-14

### Added

- **Sensitive command guard** — press Enter on a command that matches your watch-list (e.g. `rm -rf`) and a confirmation popup appears *before* it runs. Built for the classic accident: hitting ↑ to recall a command and running the wrong one — so the check reads the actual command line from the terminal (recalled commands are echoed by the server, not reconstructed from keystrokes), which means it catches history-recalled commands too. On by default with a sensible starter list (`rm -rf`, `rm -r`, `sudo rm`, `mkfs`, `dd if=`/`dd of=`, `shutdown`, `reboot`, `poweroff`, `halt`, writing straight to a disk device, the classic fork bomb); edit or clear the list in **Settings → Sensitive command guard**. Patterns match at a command position (literal, e.g. `rm -rf`) or as a regex when wrapped in `/…/`. The Cancel button is focused by default, so a reflexive second Enter cancels rather than running; the guard adds no per-keystroke latency and automatically stands down inside full-screen apps (vim, less, htop) so it never interrupts an editor.

### Changed

- **Settings is now a full screen instead of a small dialog** — the old modal had grown cramped, so Settings opens as a full-window screen with a left-hand category rail (Appearance, Background image, Terminal, Sensitive command guard) and a scrollable content pane, giving each group room to breathe. Everything it did before is unchanged (Esc still closes it); it's just laid out properly now.

---

## [0.1.20] — 2026-07-13

### Changed

- **Typing latency over SSH (especially multi-hop chains) is dramatically lower** — two fixes that together close most of the gap with native clients like Termius:
  - **TCP_NODELAY on the SSH socket** — the `ssh2` library never disables Nagle's algorithm, so each keystroke (a tiny packet) could sit in the OS buffer waiting for the previous packet's ACK before being sent; over a high-RTT gate this made typing feel rubber-bandy. Every connection now sets `TCP_NODELAY` on the first-hop socket, exactly like OpenSSH does for interactive sessions — this benefits terminals, SFTP, tunnels, Bulk, and Monitoring alike since they share the same chain builder.
  - **GPU-accelerated terminal rendering (WebGL)** — the terminal now renders on the GPU instead of the DOM renderer, making echo-to-glass and scrolling visibly smoother. The old reason for avoiding WebGL (stale "black frame" background when switching light/dark themes) is handled properly by clearing the glyph texture atlas on theme change; if the GPU context is lost (old drivers) the terminal falls back to the regular renderer automatically, and a new **Settings → Terminal → GPU acceleration** toggle lets you turn it off entirely.

---

## [0.1.19] — 2026-07-13

### Fixed

- **Pasting multiple lines no longer inserts blank lines between them** — right-click paste and Ctrl+Shift+V used to send the clipboard text raw; Windows clipboards carry `\r\n` line endings, and editors like vim/nano treat CR and LF as *two* newlines, so every pasted line gained an empty line after it. Both paths now go through xterm's `paste()`, which normalises line endings to `\r` (like pressing Enter) and honours bracketed-paste mode when the remote app has it enabled (vim stops cascading auto-indent on paste, too).
- **SFTP through a login script ending in `su`/`sudo` can now actually write files** — `su`/`sudo` steps that came *after* the last `ssh` hop (or a login script with no `ssh` hop at all, e.g. just `sudo -i`) were silently dropped when deriving the SFTP command, so the SFTP session ran as the plain ssh user and saving a file owned by the elevated user failed with *Permission denied*. The SFTP subsystem can't pass through `su`, so in that case the app now runs the `sftp-server` binary directly **under the target user** (probing the common distro locations: `/usr/libexec/openssh/`, `/usr/lib/openssh/`, `/usr/lib/ssh/`, `/usr/libexec/`), with the same keep-stdin password feeding used everywhere else. Login scripts whose `su`/`sudo` comes *before* the final `ssh` are unchanged.

---

## [0.1.18] — 2026-07-13

### Changed

- **AI Explain panel — long answers no longer clipped at the bottom** — the panel's max height is now computed from its *actual* top position (docked or dragged), so the bottom edge always stays inside the app frame and long explanations scroll instead of running off-screen (previously a panel dragged/docked lower than the default could extend past the window bottom, hiding the tail of the answer).
- **AI Explain panel — easier widening for long content** — a **⛶ maximize** button in the header grows the panel to near the full frame in one click (❐ restores the default size); the resize grip now allows widths up to almost the full window (was 85 vw) and a subtle **◢ mark** shows where the grip is (Chromium's native grip is invisible on dark themes). The drag-hint tooltip now mentions that the corner resizes both width *and* height.

### Added

- **Copy buttons on AI explanations** — every fenced code block (config snippets, commands…) rendered in the AI Explain panel — and in plugin panels, which share the same mini-markdown renderer — gets a hover **📋 copy** button with a "Copied ✓" confirmation, and the panel header gains a **📋 copy-all** button that copies the whole explanation as markdown.
- **Manual ↻ Reconnect after a session dies** — when a connection is lost and the 3 automatic retries fail (or a shell exits), the failure overlay now offers a **↻ Reconnect** button next to Close: one click opens a fresh session **into the same pane** — layout, split position, and broadcast membership are kept, and the previous scrollback is carried over so you can still see what happened before the drop. Each click is a full new attempt (with its own 3-retry cycle once connected); if reopening fails (host deleted, password prompt cancelled…) the overlay returns so you can try again.

---

## [0.1.17] — 2026-07-12

### Added

- **Port-forward tunnels through login-script gates** — a Local (L) tunnel whose **via host** is reached by a **login script** (nested `ssh` in a shell, e.g. `gate → app-01 → app-05`) now forwards by running `nc <dest> <port>` on the innermost machine over an exec channel (the same nested-command mechanism Bulk/Monitor use), instead of `-J` `forwardOut` which those hosts reject. This lets you reach, say, a **database only pingable from the deepest hop** straight from `127.0.0.1:<local port>`. Requires `nc` on the far end (and `sshpass` on intermediate hops if they authenticate by password — same caveat as Bulk/Monitor).

### Changed

- **Edit existing tunnels** — the Tunnels dashboard gains an **Edit** button on each rule (previously only Start / Delete); it reopens the form pre-filled and updates the rule in place (a running tunnel is stopped so the next Start picks up the new config).
- **Sidebar shows the full host name when idle** — the row's action buttons (split/SFTP/VNC/duplicate/edit and the **note**) are now fully hidden until you hover, instead of reserving space and truncating the name; the note icon in particular only appears on hover.
- **Clearer "can't resolve hostname" error** — the DNS-resolution failure message now explains it's a client-side lookup and points to the fixes (set a Jump host so the name resolves on the gate, add a `hosts` mapping, or use the IP) instead of the bare "Không phân giải được hostname".

### Fixed

- **Windows taskbar icon** — the app now sets the **window icon explicitly at runtime on Windows for both dev and packaged builds** (`build/icon.ico` in dev; bundled `resources/icon.ico` via `extraResources` when packaged). Previously the packaged app set no window icon, so the running app's taskbar button fell back to the per-AppUserModelID icon — which Windows had cached as the Electron atom from earlier `pnpm dev` runs, showing the wrong icon even though the exe and Start-menu shortcut had the correct one. Note: a stale taskbar icon may still need a Windows icon-cache refresh (or reboot) to clear on a machine that ran the old dev builds.

---

## [0.1.16] — 2026-07-11

### Added

- **AI troubleshooter (F48) — step-by-step diagnosis with approval** — describe a symptom ("web returns 502", "server unusually slow") and the AI proposes **one read-only diagnostic command at a time**, with its reasoning. You **approve each step**; the command runs over a **separate SSH exec channel** (your open terminal is never touched — clean output capture, jump-host / login-script aware), the output is fed back, and the AI proposes the next step until it reaches a conclusion + suggested fix. **Read-only is enforced twice**: a system prompt that only allows information-gathering commands, plus a guard in the main process that blocks anything that writes/deletes/restarts (`rm`, `systemctl restart`, `kill`, redirection to files, package installs…) — the guard is the last line, per-step approval is the real gate. Open from the command palette (*🩺 AI troubleshooter*). Reuses the existing AI provider config (Claude / OpenAI / Gemini / Ollama).
- **Remote desktop — VNC & RDP (F13)** — connect to graphical desktops that live behind your SSH jump hosts:
  - **VNC embedded in a tab** — pure-JS [noVNC](https://github.com/novnc/noVNC) rendering the remote screen right inside Infra Companion. The main process opens a local WebSocket↔TCP bridge (bound to `127.0.0.1`, one-time token) that tunnels through the host's jump chain to the target's VNC port — so a VNC box reachable only from a gate just works. Scales to fit, prompts for the VNC password in-tab, reconnect button on drop.
  - **RDP over a tunnel** — forwards the target's `3389` through SSH (jump-host aware) to a local port and launches the OS RDP client (Windows `mstsc.exe`, with the username pre-filled) pointed at it; closing the RDP window tears the tunnel down. On macOS/Linux it opens the tunnel and tells you where to point your RDP client. A small dock lists open RDP tunnels with a **Stop** button.
  - Host editor gains **VNC / RDP** protocol options (default ports 5900 / 3389) with an optional **jump-host** chain for tunneling; open from the sidebar's 🖥️ button.
  - *Known limitation:* remote-desktop tunneling supports **jump-host chains** (SSH `-J` style); a target reachable only via an interactive **login-script gate** is not yet supported (planned).

---

## [0.1.15] — 2026-07-09

### Added

- **Service uptime on monitoring cards** — each card now shows how long well-known services have been running (`⟳ httpd 30d · java 12d` — oldest process per name, covering httpd/apache2/nginx/java/node/php-fpm/mysqld/mariadbd/postgres/redis), *alongside* the server uptime, not replacing it: server uptime tells you when the machine last rebooted (kernel patches!), service uptime tells you when Tomcat/Apache last restarted. Agentless like everything else — one extra `ps` in the same poll command; hosts where `ps`/`grep` differ simply omit the line.
- **Metric explanations on hover** — every number on a monitoring card now has a plain-language tooltip: the `us / sy / wa / st / r / swap` diagnostic row (e.g. *st = CPU stolen by the hypervisor for other VPS on the same physical host; sustained ≥10 means your provider oversold the box*), the Load/CPU/RAM/Disk bars, network rate, TCP connections, inode and top-process tags. Hover any value to learn what it means and when to worry (cursor shows *help*).
- **Inline history charts on the dashboard** — clicking 📈 on a card now expands **1-hour Load / CPU / TCP-connection charts right inside the dock** (auto-refresh every minute) instead of jumping straight to a modal; a *⤢ Details & 24h* link still opens the full history window with all metrics and ranges.
- **Monitoring history on the Home dashboard** — the 🏠 Dashboard gains a **📈 Monitoring history** section listing every server that has ever been monitored (data retained 30 days in `metrics.db`), newest first, each with its **24-hour Load chart** and last-monitored time; click a card to open the full history window. Works even when monitoring isn't currently running — it reads recorded history, so you can review yesterday's incident after a restart.
- **All floating panels are now movable and resizable** — grab the header of the ✨ **AI Explain** panel, the 📊 **Monitoring dock**, or a 🧩 **Plugin output** panel to drag it anywhere (each still starts docked in its usual corner), and drag the bottom-right corner to resize it — comfortable for reading long AI answers, watching many hosts, or wide plugin tables. Position is remembered for the session and each panel is clamped to the window so it never gets stuck off-screen. (Shared `useDraggablePanel` hook — one behaviour across all three.)

### Fixed

- **Dev-run taskbar icon** — running from source (`pnpm dev`) now shows the Infra Companion logo on the Windows taskbar and title bar instead of the default Electron icon (packaged builds already used the icon embedded in the exe).

---

## [0.1.14] — 2026-07-08

### Added

- **Monitoring 2.0 — real CPU, steal, connections, and more** — the monitor now answers *why* a server is slow, not just *that* it's slow. Each 3-second poll additionally collects: **real CPU% split into user / system / iowait / steal** (computed as deltas of `/proc/stat` between polls — sustained steal ≥10% means your VPS host is overselling CPU and is highlighted in red), **run queue** (processes waiting for CPU), **swap usage**, **all real mounts** (the fullest one is shown, e.g. `Disk /var`) plus **inode%**, **network in/out rate**, **TCP connection counts** (ESTABLISHED / TIME_WAIT — the most direct "we're being scraped" signal), and the **top CPU process** — all still agentless over the same single SSH command. The Load row stays. Load thresholds are no longer capped at 100% (normalized load on busy servers legitimately runs 300-400%+; cap is now 10 000) and its chart auto-scales; **new alert thresholds for CPU steal (default 20%) and TCP connections** (default off) join Load/RAM/Disk/offline; history charts add CPU, steal and connections.
- **Monitoring alert thresholds (F04)** — set Load/RAM/Disk % thresholds (global defaults + per-host overrides) and an offline alarm right in the Monitoring modal. Alerts fire after a sustained ~9s breach (3 polls) with a dead-band hysteresis so a metric flapping at the threshold never spams; while still breached it re-alerts every 15 minutes, and recovery is announced once. Delivery: in-app toast + **Windows notification** (default on) + optional **webhook** — paste one URL and the app auto-detects **Google Chat**, Slack, Discord or Telegram (generic JSON for anything else), with a *Send test* button. Alert rules live in `monitor-settings.json` (userData), deliberately outside the vault so alerts keep firing even while the vault is auto-locked.
- **Metrics history + charts (F32)** — monitor samples are now downsampled (1-minute buckets kept 48 h, 10-minute buckets kept 30 days, auto-pruned) into a separate unencrypted `metrics.db` (SQLite via `node:sqlite` — zero new dependencies, a few MB/month). The 📈 button on each monitoring card opens **1 h / 24 h charts** for Load (per-CPU %), RAM and Disk; offline periods show as gaps. History survives app restarts; recording only happens while monitoring runs.
- **AI explain selection (F46)** — select any output in the terminal and hit the floating **✨ Explain** button (or **Ctrl+Shift+E**): the selection goes to your configured AI provider (mode *explain-error*) and the answer appears in a minimizable dock panel on the right — no modal, keep typing while you read. Selections over 6 000 chars keep the tail (errors live at the end). If AI isn't configured yet it opens the AI settings for you.

---

## [0.1.13] — 2026-07-08

### Added

- **Dashboard home screen** — the app now boots into a **Dashboard** instead of auto-spawning a local PowerShell terminal. The dashboard is the *home screen behind your tabs*, not a tab itself: the **🏠 button** at the left of the tab bar takes you there anytime (it lights up while you're home), clicking any tab takes you back, and closing the last tab lands you home instead of an empty screen. It shows quick stats (hosts, groups, connections today / last 7 days), a **Quick connect box** (`user@host[:port]` + Enter), your **★ favorite hosts** (one click to SSH), **host group chips** (open a whole group as split panes in one click), the **recent connections** list (click to reconnect), your saved **Workspaces** (restore a full tab/split layout in one click), **Tunnels with live status and Start/Stop right on the card**, and a **keyboard-shortcut cheat sheet** — plus a *＋ New terminal* shortcut so the old one-click shell is still one click away. (Monitoring stays in its dedicated dock on the right — the dashboard doesn't duplicate it.) Also reachable from the command palette (*🏠 Dashboard*). Prefer the old behavior? **Settings → Startup page → Terminal** restores boot-to-shell (`infra.startup.page`).

- **Marketplace package signing (ed25519)** — every registry entry now carries an ed25519 signature covering `id + version + file checksums`; the app verifies it against a **public key embedded in the binary** and silently drops unsigned/tampered entries before they even appear in the Marketplace tab. This closes the "compromised registry/CDN" scenario: an attacker who can rewrite `plugins.json` (and its sha256 fields) still cannot forge signatures without the maintainer's private key, which never leaves the maintainer's machine (`~/.infra-companion/registry-signing-key.pem`, generated by `scripts/registry-keygen.mjs`; `scripts/build-registry.mjs` now refuses to build an unsigned registry). A CI test re-verifies every committed registry entry against the embedded public key, so a payload-format drift or unsigned entry fails the build.
- **Access Log Analyzer v1.4.0 — top ASN / network organization** — new section *7. Top 15 ASN_ORGANIZATION*: when the log carries GeoIP enrichment (`... | ASN_NUMBER: 45899 | ASN_ORGANIZATION: VNPT Corp`), the plugin ranks which network organizations send the most traffic; logs without that field just show a skip note. Traffic concentrated in hosting/datacenter ASNs (OVH, AWS, Tencent…) is almost certainly bots and can be blocked by ASN range; residential ISPs need more care. Command title is now "7 thông số"; registry re-signed.
- **Marketplace web page** — the plugin catalog is now browsable without the app at [`/plugins.html`](https://xshiroenguyenx.github.io/infra-companion/plugins.html) on the landing site: it renders the same signed `registry/plugins.json` (same origin, no server), one card per plugin with version/author/description and install steps. The card template already handles a future `price`/`buyUrl` field (PAID badge + Buy button) — groundwork for the paid-plugin storefront.

---

## [0.1.12] — 2026-07-07

### Added

- **Plugin Marketplace (F52, v1)** — the Plugins modal now has a **🛒 Marketplace tab**: a public JSON registry (static file on GitHub Pages — zero servers) lists community plugins; one click **installs or updates** them into your plugins folder. Safety first: every file in the registry carries a **SHA-256 checksum verified before writing**, file names are strictly validated (no path traversal), the downloaded `manifest.json` must pass the same validation as local plugins, and nothing is written unless *all* files verify. Registry is regenerated from `docs/examples/` via `node scripts/build-registry.mjs`; override the registry URL with `INFRA_REGISTRY_URL` for testing. The three sample plugins (Hello World, Output Highlighter, Access Log Analyzer) are the first catalog entries.
- **Secret scanning in CI** — new `secret-scan.yml` workflow runs [gitleaks](https://github.com/gitleaks/gitleaks) on every push/PR plus a weekly full-history sweep; complements GitHub Push Protection (which only checks new pushes against known patterns). Deliberately has no `paths-ignore` so docs/markdown are scanned too.

### Fixed

- **Plugin pill no longer covers the Monitoring dock header** — the minimized plugin pill (top-right) sat exactly on the Monitoring dashboard's `–`/Stop buttons; the dashboard now shifts down (top-14 → top-24) whenever a plugin panel is open, so both stay clickable.

---

## [0.1.11] — 2026-07-06

### Added

- **Collapsible sidebar** — the left host list can now be collapsed to a thin rail so the terminal gets the full width: the `«` button next to the search box, **Ctrl+Shift+H**, or the palette command *Collapse/expand host list*. The collapsed rail keeps a `»` button to expand; the state is remembered across launches (localStorage). Terminals re-fit automatically on toggle.
- **Resizable split panes** — the borders between panes in a split tab are now **draggable**: grab the line between two panes (cursor changes) and drag to give one pane more room; the whole column/row resizes so the grid stays aligned. Panes can't shrink below ~12% (still readable), terminals re-fit live while dragging, and **double-clicking a divider resets to equal sizes**. Sizes reset when panes are added/closed.
- **Minimizable docks** — both the plugin panel (top-right) and the Monitoring dashboard (right edge) now have a `–` button that shrinks them to a small pill: the plugin pill (`🧩 title`, top-right) restores on click and **auto-restores when the plugin pushes new content** (e.g. a section re-run finishes); the monitoring pill (`📊 n hosts`, bottom-right so the two pills never overlap) carries a status dot showing the worst host state (green/amber/red) while minimized, and monitoring keeps polling in the background.

### Fixed

- **Terminal scrollbar hidden** — the xterm viewport scrollbar took horizontal space in every pane (noticeably with 4-6 splits); it's now fully hidden. Wheel / PgUp-PgDn scrolling unchanged.

---

## [0.1.10] — 2026-07-06

### Added

- **Plugin API: `api.ui.prompt({ title?, label?, placeholder?, value? })`** — a plugin can now ask the user for one line of text via a modal dialog (same prompt pipeline as the host-key/password questions). Resolves to the entered string (may be empty) or `null` on Cancel; waits up to 120s instead of the usual 8s API timeout. Declared as the `ui.prompt` permission in `manifest.json` (v1: displayed only).
- **Plugin panels: `cmd:` action buttons** — a markdown link of the form `[label](cmd:command.id?arg)` renders as a small button that invokes that command **of the panel's own plugin**, passing the text after `?` as `ctx.arg` (URI-decoded). Command handlers receive the new optional `ctx.arg: string`. This lets a plugin build interactive reports (re-run a part, drill down) without any HTML.

### Changed

- **Access Log Analyzer v1.2.0 asks for the log path when invoked** — a dialog pre-filled with the last-used path opens first; leave it **empty to use the default** (`/etc/httpd/logs/ssl_access_log`) or type e.g. `/var/log/nginx/access.log`. The last entered path is remembered (plugin storage). Input is validated (letters, digits, `. _ / -` only) so the generated one-liner can't be broken by spaces/shell metacharacters. Editing `index.js` is no longer needed to analyze a different vhost's log.
- **Access Log Analyzer handles custom log formats with a leading vhost** — logs like `www.site.com:443 1.2.3.4 - - [...] "GET … " 200 …` (vhost:port prepended, extra `| Country Code | ASN …` fields appended) shift every column by one. The plugin now **auto-detects the offset** from the first line (column 1 is an IP → standard combined; otherwise → +1) and, when a vhost is present, prints top URLs as `vhost/path` since one file aggregates many domains. Timestamp (`[`-split) and User-Agent (`"`-split) parsing were already position-independent. A `FIELD_OFFSET` constant at the top of `index.js` overrides auto-detection for more exotic formats. The empty-file error message now lands inside section 1 (previously it was dropped by the marker parser, so a wrong path showed six silently-empty sections).
- **Access Log Analyzer v1.3.0: each panel section shows its shell command and is individually editable/re-runnable** — every section now displays the exact pipeline it ran (`$ awk … | sort | …` above the output) plus two buttons: **↻ Chạy lại** re-runs just that section on the same host/log (fresh `tail` sample), and **✎ Sửa lệnh** opens a dialog pre-filled with the current command — edit it (e.g. change `head -15` to `head -50`), press OK and only that section re-runs and updates in place. Edited commands are remembered per section (plugin storage) and also used by the next full analysis; clearing the field restores the default. Edits are validated (single line, no `!` — interactive bash history expansion would kill the whole line, no `@ALOG` marker text).

---

## [0.1.9] — 2026-07-03

### Added

- **Access Log Analyzer — third sample plugin** ([docs/examples/access-log-analyzer](docs/examples/access-log-analyzer)) — one Command Palette command analyzes the web-server access log **on the host of the active SSH session**: top 15 IPs, requests per minute (last 30 marks), top URLs, top User-Agents, status-code distribution, and what the most suspicious IP is calling — results open in a panel together with a short how-to-read guide. It types a single, fully visible shell one-liner into the session (`tail` + `awk` over the last 50 000 lines), so it works on any Linux box with no agent. Log path and sample size are constants at the top of its `index.js` (default `/etc/httpd/logs/ssl_access_log`) — edit + **Reload** to adapt to nginx etc.

### Changed

- **Plugin panels no longer block the app** — a panel now docks to the **top-right corner**, translucent (fully opaque on hover), with no backdrop: you can keep typing in the terminal while reading the result. Close it with the ✕ button; Esc is deliberately left to the terminal (vim…).
- **Monitoring dashboard is now a docked panel, independent of modals** — picking hosts and pressing *Start* closes the picker and docks a compact dashboard to the right edge (one card per host, translucent, hover to focus). It keeps monitoring while you open other modals, switch tabs or run plugins, and disappears **only when you press Stop** — previously, closing the modal (or opening any other one) silently stopped monitoring. Re-opening `⋯ → Monitoring` pre-ticks the hosts being watched; *Start* replaces the watched set.

### Fixed

- **Plugin-typed commands could be killed by bash history expansion** — the analyzer's one-liner contained a `!` inside double quotes; interactive bash expands history *before executing* (`bash: !: event not found`) and discards the entire line, so nothing ran and the plugin timed out after 30s. Generated commands no longer contain `!`.

### Notes

- Renderer + sample plugin + docs only — DB schema unchanged (still **v9**), no core/main-process changes.

---

## [0.1.8] — 2026-07-02

### Fixed

- **Monitoring & Bulk exec were broken for hosts reached through a login script** (e.g. `ssh inner-host` typed on a gate). Since v0.1.3 the internal command builder returned a full SFTP command (`ssh … -s sftp`), which Monitoring/Bulk then wrapped in *another* `ssh` — producing a garbage command whose output was empty. The dashboard showed *"Không parse được metrics (không phải Linux?)"* even for perfectly normal Linux hosts (e.g. AlmaLinux behind a gate). Both features now build the correct nested command.
- **Login-script coverage for Bulk / Monitoring now matches SFTP** — `su` / `sudo` steps and password-protected `ssh` hops (via `sshpass` on the gate) are traversed correctly instead of silently stopping at the gate host.
- **Monitoring reports the real error** — when metrics can't be parsed, the host card now shows the remote stderr (e.g. `Permission denied`, `sshpass: command not found`) instead of guessing "not Linux?".

### Internal

- Login-script → exec-command building extracted into a shared module ([packages/core/src/connection/loginScript.ts](packages/core/src/connection/loginScript.ts)) used by SFTP, Bulk and Monitoring — one code path, no more drift between the three. +10 unit tests (71 total).

---

## [0.1.7] — 2026-06-22

### Added

- **Background image from a URL** — besides picking a local file, you can now paste an **image link** in **Settings → Background image** and click **Add**. Works with direct image URLs and with **Google Drive** and **Dropbox** share links (the app rewrites them to a direct-download form automatically). The image is fetched in the main process (so it isn't blocked by browser CORS), then downscaled and stored locally as before — pasting a new link or picking a new file simply replaces the old one, so nothing piles up. Per-machine preference, not synced.

### Notes

- The link is only used to fetch the bytes once; the app never keeps the remote URL — it stores a re-compressed local copy, so the wallpaper keeps working offline. Fetches are limited to http/https, time out after 20s, cap at 25 MB, and the content is validated as a real image (by magic bytes) before use. A non-public Drive link returns an HTML page and is rejected with a clear message.

---

## [0.1.6] — 2026-06-21

### Added

- **Plugin system (v1)** — extend the app with trusted JavaScript plugins, no core changes needed. Plugins live in `<userData>/plugins/<id>/` (a `manifest.json` + a CommonJS `index.js`) and run in an isolated Node `worker_thread` (a buggy plugin can't crash the app), reaching the app only through a controlled `api` — they never touch the vault or secrets. A plugin can: **add commands** (shown in the Command Palette and the Plugins menu), **observe terminal output and write to a session**, **show a markdown/text panel**, **store its own JSON data**, and **notify**. Manage them in **⋯ → 🧩 Plugins**: enable/disable, reload after editing, open the folder, view per-plugin logs/errors, and **Rescan** to pick up newly added plugins without restarting. Ships with API docs and two example plugins.
- **Theme studio** — customize the full UI palette (background, panels, modals, inputs, hover, borders, text, danger/success/warning) per base theme in **Settings → Appearance → 🎨 Custom palette**, applied live with one-click reset. **Export / import a theme as JSON** to share or back up your look.
- **Favorite hosts** — pin hosts with the ⭐ button; pinned hosts appear in a **Favorites** section at the top of the sidebar for quick access (respects the search filter). Stored per-machine.

### Notes

- Plugin usage & API are documented in the **Plugins** section of [docs/USER-GUIDE.md](docs/USER-GUIDE.md); example plugins under [docs/examples/](docs/examples/).
- Plugin code, theme palette overrides, and favorites are stored per-machine (not part of E2EE vault sync in v1).

---

## [0.1.5] — 2026-06-20

### Added

- **Mouse copy & paste in the terminal** — select text by dragging, then **left-click inside the highlighted block to copy it** (a brief *"Copied"* toast confirms). **Right-click anywhere to paste** the clipboard at the prompt. Works in every pane and respects Broadcast mode (paste reaches all panes when broadcasting), just like the existing `Ctrl+Shift+C` / `Ctrl+Shift+V` shortcuts, which still work.

---

## [0.1.4] — 2026-06-13

### Added

- **Workspaces** — save the current layout (all tabs, split panes, and broadcast state) under a name and restore it in one click. In **⋯ → Workspaces** (or the Command Palette): *Save current layout*, then *Open* / *Rename* / *Delete* saved ones. Opening adds the layout's tabs as fresh sessions. Stored per-machine (referencing host IDs, so synced hosts resolve on any machine).
- **Notes per host** — attach an encrypted Markdown note to any host (server purpose, handoff info, app passwords…). Edit it in the host editor; hosts with a note show a 📝 button in the sidebar for a quick read-only view. Encrypted at rest in the vault and synced with the host.
- **Terminal appearance** — customize the terminal font family, font size, line height, and cursor style (block / bar / underline) in **Settings → Terminal**. Applies live to all panes and persists per-machine.
- **Custom accent color** — pick your own accent (color picker in **Settings → Appearance**); applied app-wide over the dark/light theme, with a one-click reset to the theme default.
- **tmux session resume (per-host)** — opt-in toggle in the host editor: after login the app runs `tmux new-session -A -s ic-main`, so the session lives on the server. If the network drops (or you reopen the host later), it re-attaches the still-running session and you resume where you left off. Requires tmux on the server.

### Notes

- Vault schema migrated to **v9** (`hosts.notes_enc` for notes, `hosts.tmux` flag); both fields participate in E2EE sync.

---

## [0.1.3] — 2026-06-13

### Added

- **Background image** — set a wallpaper that fills the whole window behind the UI. In **Settings → Background image**: pick an image (auto-downscaled and stored locally), then tune **opacity**, **blur**, **fit** (cover / contain), and **position** (center / left / right / top / bottom). Chrome panels (sidebar, tab bar, status bar, toolbar) become translucent so the image shows full-frame, while modals and menus stay opaque for readability. Per-machine preference — not synced.
- **Open a whole group at once** — a grid button on each group header (and an *Open group* entry in the Command Palette) opens every host in that group as split panes in a single tab, ready for Broadcast. Ideal for monitoring a cluster side by side.

### Changed

- **Split button redefined** — it now **merges** all open terminal tabs into panes within one tab (so Broadcast spans them), and toggles back to separate tabs on a second click. Terminal scrollback is preserved across merge/split. *(Previously it tiled separate tabs side by side, where Broadcast couldn't reach across tabs.)*

### Dependencies

- Added `@xterm/addon-serialize` — snapshots the terminal buffer so scrollback survives when panes are re-parented during merge/split.

---

## [0.1.2] — 2026-06-12

### Added

- **Internationalization (i18n)** — full UI translation in Vietnamese 🇻🇳, English 🇬🇧, and Japanese 🇯🇵; missing keys fall back to Vietnamese automatically.
- **Settings modal** — accessible via `⚙ Settings` in the sidebar menu; lets users switch theme and language without restarting.
- **Dark / Light theme** — two built-in themes persisted to `localStorage`; applied immediately on change with no flash on reload.
- **Themed terminal colors** — dark terminal uses Tokyo Night palette; light terminal uses GitHub Light palette, both matched to app background.
- **Settings store** (`useSettingsStore`) — Zustand store that reads/writes `infra.theme` and `infra.lang` in `localStorage`; initial values applied before React mounts to avoid color flicker.

### Changed

- All UI components (30+) refactored to use the `useT()` i18n hook — every visible string now comes from the `vi/en/ja` dictionary.
- Terminal theme now tracks the global theme setting in real time (hot-switch dark ↔ light without reconnecting).
- `electron.vite.config.ts` minor cleanup.

---

## [0.1.1] — 2026-06-07

### Added

- Official Infra Companion logo as app icon (replaces Electron default).

### Fixed

- CI race condition: GitHub Actions now creates the release before parallel build jobs start, so all artifacts attach to the same release.
- `executableName` added to `electron-builder` config — avoids `@` character in Linux/macOS output paths.
- `pnpm/action-setup` no longer pins `pnpm` version in CI (conflicted with `packageManager` in `package.json`).
- Added `contents: write` permission to the release workflow so artifacts can be uploaded.

---

## [0.1.0] — 2026-06-05

### Added

Initial public release of **Infra Companion** — a modern SSH client desktop app (Electron + React).

**Core features:**
- Encrypted vault (AES-256-GCM, master password, optional Windows DPAPI auto-unlock).
- SSH connections with password, SSH key, SSH agent, or secret-manager references (1Password `op://`, Bitwarden `bw://`).
- Serial / COM port connections.
- Multi-tab terminal with split panes and broadcast mode (type once → all panes).
- Jump host chains (multi-hop SSH).
- Group inheritance (default username / auth / env per group).
- SFTP file manager with upload, download, rename, chmod, inline editor (auto-upload on save).
- Port-forwarding tunnels (Local, Remote, Dynamic/SOCKS5).
- Bulk execution — run a command across N hosts in parallel, group results by diff.
- Monitoring dashboard — CPU / memory / disk via SSH (no agent required, Linux only).
- Network Toolbox — ping, DNS lookup, common-port scan.
- Snippets with variable interpolation (`{{var}}`).
- Session recording (asciicast) and log-to-file.
- E2EE sync via shared folder (Syncthing, Google Drive, Dropbox, OneDrive…).
- AI assistant (Anthropic Claude API, bring-your-own key).
- Command palette (Ctrl+Shift+P).
- Import from `~/.ssh/config`.
- Auto-update (electron-updater).
