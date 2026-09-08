# Infra Companion

> A next-generation desktop SSH client — everything Termius does, plus local-first vault encryption, self-hosted E2EE sync, bulk execution, real-time monitoring, embedded VNC & RDP, AI assistance with local LLM support, **a self-managed local PHP/WordPress dev stack**, and more.

**Current release: v0.2.20 (Phase 0–6)**  &nbsp;|&nbsp; Windows · macOS · Linux  &nbsp;|&nbsp; Electron 42 · React 19 · TypeScript

🌐 **[Live landing page](https://xshiroenguyenx.github.io/infra-companion/)** &nbsp;·&nbsp; ⬇️ **[Download](https://github.com/xShiroeNguyenx/infra-companion/releases/latest)** &nbsp;·&nbsp; 📖 **[User guide](docs/USER-GUIDE.md)**

> The landing page deploys to GitHub Pages on its own — pushing changes under `docs/landing/` to `main` (or running the workflow manually) publishes it **without rebuilding the app** (see `.github/workflows/pages.yml`). One-time setup: **Settings → Pages → Build and deployment → Source = GitHub Actions**.

---

## Why Infra Companion?

| Pain point with Termius | How Infra Companion solves it |
|-------------------------|-------------------------------|
| Forced cloud account to sync | Local-first; sync via your own folder/WebDAV/S3/Git (zero-knowledge E2EE) |
| Expensive subscription ($10–30/user/month) | Free and open — host it yourself |
| No monitoring, no bulk execution | Built-in dashboard (CPU/RAM/disk, no agent) + parallel bulk runner |
| No AI, or AI locked to their cloud | Claude / OpenAI / Gemini / **Ollama local** (100% private) |
| No session recording | Full asciinema-compatible recording & replay |
| No secrets manager integration | Pull credentials live from 1Password, Bitwarden, HashiCorp Vault |
| SFTP can't reach internal hosts via jump chain | SFTP tunneled over nested SSH — works with login-script hosts |
| Closed-source, no plugin system | Auditable core; plugin system on the roadmap |

---

## Features

### SSH & Connections
- **SSH** with password, SSH key (ed25519 / RSA / ECDSA), **key + password (2-factor)**, SSH agent (OpenSSH / Pageant), and **Secrets Manager** auth
- **Jump host chain** — multi-hop ProxyJump (equivalent to `ssh -J hop1,hop2 target`)
- **Login script (expect/send)** — automate `su → ssh` or nested SSH sequences with per-step encrypted secrets; runs on auto-reconnect too
- **Auto-reconnect** (3 retries, status shown in terminal)
- **tmux session resume** — opt-in per host: wraps the session in tmux (`new-session -A`) so it survives disconnects and reattaches on reconnect/reopen (server must have tmux)
- **TOFU known-hosts** — fingerprint shown on first connect, red alert on host-key change; `⋯` → **Trusted fingerprints** lists everything you've trusted and lets you forget an entry (after a server rebuild) so you stop clicking past a red warning forever
- **Push a public key to a host** — one button on a password host appends your key to `~/.ssh/authorized_keys` and then **logs in with it to prove it worked** (wrong `~/.ssh` permissions make sshd ignore the key silently), before offering to switch the host to key auth
- **Quick Connect** — type `user@host:port` in the sidebar; 50-entry history
- **Favorite hosts** — pin hosts with ⭐ to the sidebar's Favorites block (respects search)
- **A sidebar you arrange** — the left column is a set of blocks (Favorites · host groups · Tunnels · Snippets · Workspaces · Recent) you switch off and drag into any order; groups fold and remember it, folded ones show their host count, and searching opens everything so a match is never hidden
- **Telnet** and **Serial / COM port** (auto-lists connected ports, configurable baud)
- **Local terminal** — PowerShell, cmd, Git Bash, WSL shells via node-pty

### Terminal UX
- **Three themes — Infra default, Navigator and Workbench** — *Infra default* is the classic layout (host tree in the left column, Dashboard as home). *Navigator* is Termius-style: the left column is a **menu** (Hosts · SFTP · Tunnels · Snippets · SSH Keys · Workspaces · History · Tools, plus Dashboard if you want it — **you pick which show and drag the order**, Hosts is home) and nothing unfolds inside it — pick an entry and it opens in the **main area**: a **Hosts page** with favorites, groups as folder cards you step into, wide host rows with the usual actions and a search that flattens everything; a **History page**; and Tunnels / Snippets / Keys / Workspaces as pages, laid out in **two columns** when the window is wide. *Workbench* is VS Code-style: a 48px activity bar picks a **resizable side panel** (hosts, tunnels, snippets, keys, workspaces, history, tools) while the main area stays on your terminals, plus a **`Ctrl+J` bottom panel** under the terminal for Monitoring, Log and Tunnels. Dark/Light is a separate *Color mode* (Settings → Appearance → Theme)
- **Dashboard home screen** — the app boots into a home page behind your tabs (🏠 button): a **"Needs attention" strip** that appears only when something is actually wrong (host not responding, tunnel failed, replica with a critical diagnosis), **a single row of tool icons that orders itself by how much you use each tool** (pin the ones that should always keep a tile), quick-connect in the header next to *+ New terminal*, counters, favorite hosts, **host-group cards** (colour band; click the group name for its full host list, a host chip to open just that host, or the footer to open the whole group as splits), recent connections, saved workspaces, tunnels with live status + start/stop, and a keyboard-shortcut cheat sheet — the lists split into two columns on a wide window. Prefer boot-to-shell? Settings → Startup page → Terminal
- **xterm.js** with WebGL renderer — smooth even at high throughput (`yes`, large `cat`)
- **Multi-tab** with Ctrl+Shift+T / middle-click close
- **Split panes** — side-by-side sessions, Ctrl+Shift+D
- **Merge tabs ⇄ split panes** — the Split button opens a menu to combine **all** open tabs *or* **only the tabs you pick** into one tab's panes (so Broadcast spans them) and toggles back; scrollback is preserved across merge/split
- **Reorder panes & pick the main window** — each split pane header has a **⋮** menu: *Set as main window* (promote any pane to the large slot in main-left / main-top) plus move left/up and right/down
- **Split layouts** — arrange panes as auto grid, side-by-side columns, stacked rows, main-left, or main-top; switch from the **▼** next to Split ON or set the default in Settings → Terminal
- **Pane frame styles** — Compact bar (default) or Mac style (rounded corners + round red close button), in Settings → Terminal
- **Command palette button** — a toolbar button opens the palette for people who don't know the `Ctrl+Shift+P` shortcut
- **Tools in tabs, not blocking popups** — Monitoring, Compare, Local dev, **Tunnels**, **Processes**, **Services**, the **AI troubleshooter**, plus **Watch a log**, **Scheduled jobs**, **Rotate SSH keys**, **Disk usage**, **What needs patching** and **Trusted fingerprints** all open in a tab (⊞ in the popup header, or the palette), so a fleet-wide scan or a log you're following never freezes the rest of the app; Monitoring and Tunnels can also **detach into an always-on-top window**
- **All features tab** — the `⋯` menu is itself grouped by area with a **search box** that reaches the whole catalogue, and ends with **⊞ All features…**: every tool with a one-line description and its own search, so the menu stops growing without bound
- **Open a group as split panes** — one click on a group header opens every host in it side by side, ready to broadcast
- **Workspaces** — save a layout (tabs + split panes + broadcast) and restore it in one click (⋯ → Workspaces)
- **Broadcast input** — type once, send to all open panes simultaneously (Ctrl+Shift+B)
- **Background image** — full-window wallpaper from a local file **or a pasted URL** (incl. Google Drive / Dropbox share links), with adjustable opacity, blur, fit (cover/contain), and position (Settings → Background image)
- **Terminal appearance** — configurable font size, line height, and cursor style (Settings → Terminal); applies live
- **Font picker** — choose from the fonts **actually installed on this machine** (read from the OS font folders, family names parsed out of the font files themselves), with a live sample and a warning when your font isn't really present or isn't monospace. **Or add a font you downloaded** (`.ttf`/`.otf`/`.ttc`/`.woff2`) without installing it into the OS (Settings → Terminal)
- **Mouse cursor** — pick from 19 pointers (6 native to your OS, 13 drawn by the app: arrows, ring, dot, 8-bit, sword, heart, pine tree, rocket, pencil, lightning, cat's paw) or **add your own** from a PNG/SVG/CUR you downloaded, with an editable X/Y hotspot. Each one is a **pair of states** — normal plus a hover state (accent-colored glow) used over buttons and links instead of the browser hand — and applies app-wide including the terminal (Settings → Terminal)
- **Theme studio** — pick a custom accent and recolor the full UI palette per theme (Settings → Appearance → Custom palette); export / import a theme as JSON
- **Find in terminal** — Ctrl+F with highlight
- **Mouse copy & paste** — select then left-click the highlight to copy, right-click to paste (alongside Ctrl+Shift+C / Ctrl+Shift+V)
- **Customizable shortcuts** — rebind Copy / Paste / Find / AI-explain in Settings → ⌨ Keyboard shortcuts; changes apply live to open terminals
- **Sensitive command guard** — pressing Enter on a command that matches your watch-list (`rm -rf`, `mkfs`, `shutdown`… — editable in Settings) pops up a confirmation first; it reads the real command line so it catches ↑-recalled commands, adds no typing latency, and stands down inside vim/less/htop (Settings → Sensitive command guard). Mark a group **PRODUCTION** and the guard gets stricter there: the confirmation says how many machines will receive the command (Broadcast turns one keystroke into N) and names the production ones, and asks you to **retype the machine's name** instead of taking a single click
- **Command Palette** — Ctrl+Shift+P, keyboard-first access to every action
- **Session logging** — capture raw output (ANSI-stripped) to file
- **Session recording & replay** — asciinema v2 format; player with play/pause, seek bar, 1×/2×/4×/8× speed; export `.cast` for `asciinema play`
- **Help centre** — `F1`, the version line in the status bar, ⓘ next to `⋯`, or the palette. Version, build date and commit, Electron/Chromium/Node and OS; **Check for updates that answers in words every time** (available / already latest / here's the error / this is a dev build); the shortcut list reachable from inside a terminal (`Ctrl+/`) showing your **current** terminal bindings; the changelog entry for the build you're running, embedded so it works offline; and one-click access to the app data, log and recording folders plus **Copy system information** for bug reports — which carries the app and OS versions and nothing about your hosts

### Plugins (v1)
- **Trusted JS plugins** — drop a plugin folder (`manifest.json` + `index.js`) into `<userData>/plugins/`; runs in an isolated Node worker so a crash can't take down the app
- **Capabilities** — add Command Palette commands, observe terminal output & write to a session, show a markdown/text panel, store per-plugin data, notify — all via a controlled API that never exposes the vault
- **Manager** — ⋯ → 🧩 Plugins: enable/disable, reload after editing, Rescan for new plugins (no restart), view per-plugin logs/errors
- See the **Plugins** section in [docs/USER-GUIDE.md](docs/USER-GUIDE.md) and examples in [docs/examples/](docs/examples/)

### Host & Vault Management
- **Encrypted vault** — master password → argon2id → AES-256-GCM field-level encryption; all secrets (passwords, private keys, env vars) are encrypted at rest
- **Auto-lock** after 15 minutes idle; lock overlay preserves scrollback
- **Remember on this machine** — unlocks via Windows DPAPI / macOS Keychain (no master password prompt on relaunch)
- **Groups with inheritance** — set default username / auth / key / env / startup snippet at group level; individual hosts can override; open, rename or delete any group from the `⋯` button on its sidebar header (empty groups included — deleting a group moves its hosts to *Ungrouped*, never deletes them)
- **SSH Keys** — generate ed25519, import OpenSSH/PEM/PuTTY; private keys never leave main process in plaintext
- **Snippets** — parameterized commands (`{{variable}}`), run across multiple sessions at once
- **Notes per host** — encrypted Markdown note per host (purpose, handoff info, app passwords); quick-view from the sidebar, synced with the host
- **Import** — `~/.ssh/config` (preserves multi-hop ProxyJump, deduplicates IdentityFile), and **PuTTY** (a `.reg` export or straight from the Windows Registry), **MobaXterm** (`.mxtsessions`), **WinSCP** (`WinSCP.ini`) and **Termius** (CSV export) with a tick-to-choose preview that keeps their folders as groups and skips duplicates

### SFTP
- **Start from SFTP, then pick the host** — SFTP is its own entry (Navigator menu · `⋯` menu · Dashboard grid · palette): local files on the left, *Select host* on the right (SSH hosts by group, searchable), remote files appear in place; change host or disconnect from the header. The SFTP button on a host row still opens a per-host tab
- **Dual-pane file manager** — Local ↔ Remote; double-click to navigate, `↑` for parent, `⟳` refresh
- Upload / download with recursive directory support and transfer queue
- **Edit remote file locally** — opens in your default editor; saves trigger auto-upload
- chmod (octal), rename, delete (with confirmation), create directory
- **SFTP over nested SSH** — for hosts reachable only via a gate (`ssh target -s sftp` runs on the gate); no extra configuration needed

### Tunnels
- **Local** (L), **Remote** (R), **Dynamic / SOCKS5** (D) port forwarding
- Managed tunnel dashboard — toggle on/off, **edit** rules, persistent across restarts, **sorted by name** (natural order: `db2` before `db10`)
- **Pin it where you need it**: ⊞ **open in a tab** (so the popup stops blocking the app) or ⧉ **detach into an always-on-top window** — watch and toggle tunnels while your DB client covers the app
- **Always-on tunnels** — click ⚡ on a tunnel row (or tick *Start automatically when the app opens* in its editor) and it comes up right after the vault unlocks; **closing the window keeps the app in the system tray** (tunnels, monitoring and the uptime watcher keep running), and the tray menu starts or stops any tunnel without opening the app. Settings → Application turns close-to-tray off
- **Tunnel through a login-script gate** — a Local forward whose via-host is reached by a login script (nested `ssh` in a shell) tunnels by running `nc` on the innermost hop, so you can reach e.g. a database only pingable from the deepest machine straight from `127.0.0.1` (needs `nc` on the far end)

### Fleet awareness
- **Notification centre** — every alert (Monitoring thresholds, replication lag, uptime watcher down/up, tunnel errors, URL checks) is recorded, not just toasted: 🔔 in the status bar counts unread, the Notifications tool groups them by day with per-source filters, acknowledge one or all
- **Event markers on charts** — mark "Deploy v2.3" for one host or the whole fleet; markers and the host's own alerts show as vertical lines on every metrics chart so a spike can be matched to what happened before it
- **URL checks** — synthetic HTTP monitoring from your machine, running even while the vault is locked: accepted status set, keyword, latency, TLS days left, and **Pin IP** to probe each backend behind the load balancer with the certificate still verified; alerts after N consecutive failures, 24h uptime and latency chart per URL
- **Tail one log across many hosts** — pick several machines in *Watch a log*; lines merge with a colour-coded `[machine]` prefix, one filter for all
- **Runbooks** — a built-in cookbook for the jobs you research from scratch every time: whitelist/block an IP (iptables-services · firewalld · ufw · nftables · fail2ban), cron, nginx/Apache allow-deny and vhosts, Let's Encrypt, SSH hardening, sudo users, disk full, systemd, MySQL, log analysis, swap, ports, NTP, Docker, a security check — commands with Copy / Send-to-terminal, `{{ip}}`-style variables filled once, dangerous steps flagged and confirmed; write your own or copy a built-in to adapt (stored in the vault)
- **Fleet inventory** — one read-only command per host collects OS, kernel, CPU/RAM/disk, uptime, IPs, listening ports, virtualisation, pending reboot and PHP/nginx/Apache/MySQL/Node/Docker/Python versions into a searchable table ("php 7.4", ":3306", "reboot"); cells changed since last time are highlighted, 20 snapshots per host, CSV export
- **Scheduled jobs** — run a command, a snippet or an inventory collection on a **cron schedule inside the app** (no server crontab): presets and a live *next run* preview, per-host results with exit code, duration and captured output, the last 50 runs per job, failures recorded in Notifications. The schedule lives outside the vault so it is known the moment the app starts; a run that meets a **locked vault is recorded as skipped with the reason**, never silently dropped
- **Fleet security check** — one read-only command per host, scored out of 100: sshd still accepting passwords or root, ports listening **beyond loopback**, failed logins, missing fail2ban, `NOPASSWD` sudo, empty passwords, a second UID 0, root's `authorized_keys`, firewall, SELinux, pending reboot — each finding links to the matching runbook. Nothing is changed, no `sudo`, and results are **never written to disk**
- **Folder diff & auto-upload** — pair a local folder with a folder on a host: a diff table by modified time and size (same time, different size shows as a conflict rather than a guess), **Push changes** for the local-newer and local-only files, and **Watch** to upload on save, reusing one SFTP session. One way only, machine → host; a file newer on the server is flagged, not overwritten, and a local delete never deletes remotely

### Terminal that knows where each command starts and ends
- **Shell integration (OSC 133)** — add a small snippet to the host's `.bashrc` (Settings copies it) and the pane shows the last command's **exit status and how long it ran**
- **Long-command notification** — a command over 20 seconds tells you when it finishes, but only if you were looking elsewhere (another tab, or the window unfocused); interactive programs (editors, `top`, pagers) never notify

### Remote Desktop (VNC & RDP)
- **VNC embedded in a tab** — pure-JS [noVNC](https://github.com/novnc/noVNC) renders the remote screen inside the app; a local WebSocket↔TCP bridge (bound to `127.0.0.1`, one-time token) tunnels through the host's **jump chain** to the target's VNC port, so a VNC box reachable only from a gate just works
- **RDP over an SSH tunnel** — forwards the target's `3389` (jump-host aware) to a local port and launches the OS client (Windows `mstsc.exe`, username pre-filled); a dock lists open tunnels with a **Stop** button, and closing the RDP window tears the tunnel down
- Add hosts with protocol **VNC** (default 5900) or **RDP** (default 3389) — open them from the sidebar's 🖥️ button

### Bulk Execution
- Run one command across N hosts **in parallel** (up to 8 concurrent)
- Grid output view — enable **"Group by output"** to instantly spot divergent machines (flagged yellow)
- Cancel mid-run; closing the modal also cancels (connections are truly terminated)
- Works through login-script hosts — command runs on the **inner** machine, not the gate
- **Compare config across 2 hosts** — 🔍 Compare (⋯ menu): read the same file on two servers over a dedicated exec channel and get a side-by-side, line-by-line diff (added / removed / changed) — perfect for spotting config drift; works through login-script hosts too

### Monitoring Dashboard
- Per-host cards: load sparkline + Load / **real CPU%** / RAM / Disk bars, uptime
- **Diagnoses *why* a server is slow**: CPU split into user / system / **iowait** (disk bottleneck) / **steal** (oversold VPS — highlighted red at ≥10%), run queue, swap, fullest mount + inode%, network in/out rate, **TCP connection count** (scraper radar), top CPU process
- **No agent required** — one SSH command reading `/proc` + `df` every 3 seconds; auto-reconnects; works through login-script hosts
- **Alert thresholds** — Load (uncapped, %/CPU) / RAM / Disk / CPU steal / connections / offline, global defaults + per-host overrides, hysteresis + 15-min re-alert; delivered as in-app toast, **Windows notification**, and optional **webhook** (Google Chat / Slack / Discord / Telegram auto-detected, with a test button); alerts keep firing even while the vault is locked
- **Metrics history** — samples downsampled into a local `metrics.db` (minute buckets kept 48 h, 10-minute kept 30 days); 📈 on any card opens 1 h / 24 h charts for Load, CPU, steal, RAM, disk and connections

### MySQL / MariaDB replication — is the slave behind, and what do I type now?
- **One master, all its slaves, one screen** — declare the cluster once; each cycle reads the master **once** and compares every slave against that single snapshot. Lighter on the master than one connection per slave, and it makes the differences between slaves meaningful (same binlog position for all). Each slave keeps its own connection, diagnosis and alert state, so one broken slave neither blocks nor silences the others
- **Measures drift three ways, because `Seconds_Behind_Master` lies** — it reads 0 while the IO thread is dead, and reads hours on a deliberately delayed replica. Alongside lag you get the **binlog byte gap in both directions** (how far the IO thread trails the master, how far the SQL thread trails what it already fetched), with any `MASTER_DELAY` subtracted first
- **15 diagnosis rules, each with a copy-paste runbook** carrying your real values: error **1236** names the purged binlog file and says plainly that `START SLAVE` won't help; error **1062** pulls the table out of the error message and builds the comparison `SELECT` for both sides; a corrupt relay log gets a `CHANGE MASTER TO` with your actual `Exec_Master_Log_Pos`. Read-only checks come first, destructive commands are labelled and confirm before they reach your clipboard — **the app never runs a fix itself**
- **Reaches the database whichever way your network allows** — a direct MySQL connection tunnelled through the host's existing SSH jump chain, falling back to `mysql` over SSH when 3306 is closed. Uses the credentials already on the server by default; a password you supply is vault-encrypted and only ever passed through a temporary 0600 `.cnf`, never on a command line
- **Or point it at a saved tunnel** — for the common case where MySQL isn't on the SSH host but on another machine inside the network (`10.20.30.40:3306`). The app starts the tunnel if needed and connects to its local end, reusing the exact route the tunnel already worked out (including the one that must go through `nc` on the innermost machine, where a plain `direct-tcpip` from the gate silently reaches the wrong network)
- **Background alerts that survive the vault locking** — threads stopped, error code, slave accepting writes, lag or apply-backlog over threshold; same hysteresis as resource monitoring, delivered as toast + notification + webhook
- **Data drift, not just status** — replication can say `Yes/Yes/0s` while the data has quietly diverged. Compare table lists, columns, indexes and the configuration variables that matter, then run an exact `COUNT(*)` or `CHECKSUM TABLE` on the tables you pick
- **Every drift check is kept** — repairing drifted data spans days, so each scan is saved automatically with its date, which slave it ran against, and what differed. Open any record to see that run's full list, compare it with today's, and delete records one by one or all at once when you're done
- Works with MariaDB and MySQL **including 8.4**, where `SHOW SLAVE STATUS` no longer exists

### Network Toolbox
- Ping (latency), DNS lookup (A / AAAA / PTR), port scan (16 common ports)
- Runs locally — no SSH needed

### Local Dev Stack (Windows · opt-in) — replaces Laragon / XAMPP
- **Off by default** — enable under **Settings → Local dev**; nothing touches disk until you do
- **The app manages its own runtimes**: PHP 8.3 / 8.4 (NTS), Nginx 1.30, MariaDB 11.4 LTS, and optional tools (**Adminer**, **phpMyAdmin**, **Composer**, **WP-CLI**, **Node 24 LTS + npm**, **mkcert**) — downloaded at runtime, so the installer doesn't grow
- **Every artifact is verified against a SHA-256 pinned in the app** (nginx publishes no checksum, so the app computes one, records it in a provenance file, and says so in the UI); mirrors on link rot, smoke-test after install, plus an "install from a file I downloaded" path for blocked networks
- **Service manager**: start/stop/restart Nginx · MariaDB · a pool of `php-cgi` workers; per-service PID/port/uptime/restarts and **the last 20 stderr lines when one crashes**; graceful stop only (never a hard kill on `mysqld`); **orphan processes from an app crash are detected by exe path and reaped** on next start
- **Sites**: point at an existing project folder (static / PHP / WordPress auto-detected, and you can **override the guess** or ask *why* it guessed), served at `http://<slug>.localhost:<port>` — **no hosts file, no admin rights** (browsers resolve `*.localhost` themselves, RFC 6761). Config is regenerated from the DB on every apply and each reload is gated by `nginx -t`, so one bad vhost can't kill the stack
- **Custom domain per site** (`myshop.test`, `blog.local`, a real domain) and **no port in the URL** — either serve on port 80 (falls back to your port range if IIS/http.sys already owns it) or use **🎯 Open without a port**, a Chromium window whose DNS override maps the domain to the real port with no hosts entry at all
- **Databases**: MariaDB on **3307+** so an existing XAMPP/MySQL keeps working; data directory lives outside the runtime folder; per-site DB + user + grant, generated `root` password, `.sql` export/import, and a "write credentials into `wp-config.php`" action that backs up first
- **⌨ Terminal at a site** with `php`, `composer`, `wp`, `node`, `npm` already on `PATH`

### Domain → Server Mapping (no hosts file, no admin)
- Test **one specific machine in a load-balanced cluster** without editing `C:\Windows\System32\drivers\etc\hosts`
- List the domains once (`www.example.com` or `*.example.com`) + the IP of each server, then click a server → **Open**: a Chromium window launches with a **DNS override scoped to that window**
- **HTTPS still validates** — the hostname is unchanged, so SNI/`Host` stay real and the certificate matches (unlike hitting `https://<ip>/`)
- **Open all N** gives one window per server, each with its own cookie jar — impossible with a hosts file, which points at one IP at a time
- **Copy curl command** (`curl --resolve`) for the same trick in a terminal. Needs a Chromium browser (Chrome/Edge/Brave/Vivaldi); no effect behind a system proxy

### E2EE Sync
- Encrypts vault to a single blob (`AES-256-GCM`) — the backend **never sees plaintext**
- Sync via **any shared folder** (Google Drive, Dropbox, OneDrive, Syncthing, network share)
- Or **sign in with Google** and sync straight through the Drive API — no desktop sync client needed. Uses the `drive.file` scope, so the app can only touch the one file it created; a new machine needs just the Google sign-in plus the sync passphrase. **Signing in never replaces the passphrase**: the blob is encrypted before upload, so a stolen Google account yields one unreadable file, not your infrastructure
- **Channels run side by side** — folder, Google Drive, **WebDAV** (Nextcloud/Seafile/Synology/Nginx dav) and **S3** (AWS/MinIO/R2/B2, SigV4 with no SDK) in any mix, each with its own passphrase and status, each switchable off without touching the other. Server credentials are stored encrypted and only after a successful connection
- Merge strategy: Last-Write-Wins per field + tombstone for deletes — conflicts are rare
- Set a **sync passphrase** (separate from master password, same across all your machines)
- **Auto-sync** every 5 / 15 / 30 / 60 minutes (or off), plus a final push when you quit — the merge is Last-Write-Wins, so an edit that never leaves the machine is an edit that can be silently dropped later
- **Transfer by file** — export the encrypted blob to a file and import it elsewhere, for when you're on a borrowed machine with nothing but a browser
- **It refuses to overwrite the folder when it can't see the blob** but something says it should be there — a browser-renamed duplicate (`… (1).blob`), or a cloud client that hasn't finished downloading. That write would replace every other machine's data

### Fleet operations
- **Watch a log without a terminal tab** — `tail -F` (survives logrotate) in a filterable, highlightable panel; keeps the last 5000 lines, and follow-the-bottom releases the moment you scroll up
- **Scheduled jobs (cron)** — each line's schedule in words, edit the crontab text itself (comments and `MAILTO`/`PATH` survive), confirm before replacing — louder on a **PRODUCTION** group
- **Rotate SSH keys across machines** — push the new key, **log in with it**, and only then remove the old one; if the new key can't log in, the old one stays. One machine at a time

### Fleet diagnostics (read-only)
- **What is filling the disk** — every filesystem's usage, then walk the tree one level at a time with a bar per directory, **and a verdict above the list**: which filesystem this directory is on, what share of the used space it accounts for, and one sentence on the next move (*go into `log`, it holds 95.5%* — with a button; or *the space is in files sitting directly here, going deeper won't find it*; or *this branch is tiny, you're digging in the wrong place*). `du -x -d 1`: one level per step, never crossing filesystems, unreadable directories skipped rather than failing the scan
- **What needs patching** — tick hosts, scan once, and read the fleet in one line: how many machines need patching, how many have **security patches** waiting, how many need a **reboot** before the new build actually runs. Per machine, a sentence and counts by area (kernel / system core / web / databases / runtimes) with the package names one toggle away. Security labels come from `updateinfo` on RHEL-family hosts, where the repository name doesn't carry them. **Offline**: reads only the cache already on the machine (`dnf -C`), never refreshes metadata (root, and a write), and there is deliberately **no button to install anything**

### Import / Export
- **Read a saved secret back** — show a stored host password or key passphrase, or copy it to the clipboard without it ever appearing on screen. Requires the master password **again**, every time, even while the vault is unlocked; masked, auto-hides, clipboard self-clears
- **Import** `~/.ssh/config` — hosts, multi-hop `ProxyJump`, and IdentityFile keys (deduped)
- **Cloud import — DigitalOcean, AWS EC2, Google Cloud, Azure** — add a **read-only** account (DO token · IAM key with just `ec2:DescribeInstances` · GCP service-account JSON with *Compute Viewer* · Azure app registration with *Reader*), fetch, tick, import: hosts get their public IP first, private as fallback, and their origin recorded in the notes. Machines whose address already has a host are locked out, so re-importing never duplicates the list. Accounts are saved only after a successful fetch, credentials live **encrypted in the vault** and never cross into the UI process; the app only ever **reads** from the APIs
- **Export** hosts as **ssh_config / CSV / JSON** — group inheritance resolved, `ProxyJump` rebuilt, aliases sanitised. **Carries no secrets** (no passwords, keys, notes or env) — a readable inventory, not a backup

### AI Assistant
- **Generate commands** from natural language — inserts into terminal, does NOT auto-run
- **Explain command** — break down each part and flag risks
- **Explain error** — diagnose output and suggest fixes
- **Explain selection** — select any terminal output → floating ✨ button or **Ctrl+Shift+E** → answer in a minimizable dock panel (no modal, keep typing while you read)
- **AI troubleshooter (agent mode)** — describe a symptom → the AI proposes **one read-only diagnostic command at a time** with its reasoning; you **approve each step**, it runs over a separate SSH exec channel (your terminal untouched), reads the output, and proposes the next step until a conclusion. Read-only is enforced by both the prompt and a main-process guard that blocks any write/restart/delete. Command palette → *🩺 AI troubleshooter*
- Providers: **Claude** (`claude-opus-4-8`), **OpenAI** (`gpt-4o-mini`), **Gemini** (`gemini-2.0-flash`), **Ollama** (local, fully private)
- API keys stored encrypted in vault

### Secrets Manager Integration
Pull credentials at connect time — nothing stored in the app:

| Syntax | Tool | CLI called |
|--------|------|-----------|
| `op://Vault/item/field` | 1Password | `op read` |
| `bw://<item-id-or-name>` | Bitwarden | `bw get password` |
| `vault://secret/path#field` | HashiCorp Vault | `vault kv get -field=…` |

---

## Installation

### Download

Head to the **[Releases page](https://github.com/xShiroeNguyenx/infra-companion/releases)** and grab the installer for your platform:

| Platform | File |
|----------|------|
| Windows | `InfraCompanion-Setup-x.x.x.exe` (NSIS, choose install directory) |
| macOS | `InfraCompanion-x.x.x.dmg` |
| Linux | `InfraCompanion-x.x.x.AppImage` |

The app checks for updates automatically on startup and shows a banner when a new version is available.

> **Windows SmartScreen warning:** The installer is not yet code-signed. If you see "Windows protected your PC", click **More info → Run anyway**. This is expected for new open-source apps without a paid certificate. See [this explanation](https://github.com/xShiroeNguyenx/infra-companion/wiki/Windows-SmartScreen) for details.

### Build from Source

Requirements: **Node.js ≥ 20**, **pnpm 9**

```bash
git clone <repo>
cd infra-companion
pnpm install
pnpm dev          # dev mode with hot reload (recommended during development)
```

---

## Development

```bash
pnpm dev          # start Electron app in dev mode (HMR on renderer + main)
pnpm build        # production build → out/
pnpm dist         # build + package installer → apps/desktop/release/
pnpm typecheck    # TypeScript check across all packages
pnpm test         # unit tests (crypto, sync-merge, ssh_config parser)
```

> **Note:** Do not run `npx electron .` at the repo root — the app entry point is inside `apps/desktop`. Always use `pnpm dev` or `pnpm start`.

### Running tests

```bash
pnpm test
# 1415 tests; on Node 20 the node:sqlite suites (vault-merge, replication clusters, local-dev
# store) are skipped — they need Node ≥ 22.5.
# To run those too, use Electron's bundled Node 24 runtime — from packages/core, not the
# repo root: run it at the root and vitest never sees packages/core/vitest.config.ts, so the
# 30s testTimeout drops to the 5s default and the argon2id suites fail on timing alone.
cd packages/core
$env:ELECTRON_RUN_AS_NODE='1'
& "..\..\node_modules\electron\dist\electron.exe" "..\..\node_modules\vitest\vitest.mjs" run
# (PowerShell)
```

---

## Project Structure

```
infra-companion/
├── apps/
│   └── desktop/                  # Electron app
│       ├── src/main/             # Main process: IPC router, window manager
│       ├── src/preload/          # Preload bridge (contextBridge)
│       └── src/renderer/         # React UI
│           ├── features/         # hosts, terminal, sftp, tunnels, snippets,
│           │                     #   monitor, runbooks, ai, sync, vault,
│           │                     #   localdev (local PHP stack), …
│           ├── components/       # shared UI components
│           └── stores/           # Zustand stores
├── packages/
│   ├── core/                     # Pure Node logic — reusable outside Electron
│   │   ├── connection/           # SshSession, SftpService, TelnetSession,
│   │   │                         #   SerialSession, TunnelService, Socks5
│   │   ├── vault/                # VaultService, crypto (argon2id + AES-GCM),
│   │   │                         #   SQLite migrations
│   │   ├── sync/                 # SyncService, oplog, LWW merge, FS backend
│   │   ├── importers/            # ssh_config parser
│   │   ├── monitor/              # MonitorService (SSH polling, no agent)
│   │   ├── ai/                   # Provider adapters (Anthropic/OpenAI/Ollama)
│   │   ├── bulk/                 # BulkService
│   │   ├── secrets/              # SecretsService (op/bw/vault CLI bridge)
│   │   ├── localdev/             # Local PHP stack: runtime catalog/installer,
│   │   │                         #   process supervisor, port allocator,
│   │   │                         #   nginx/php.ini/my.ini templates, DB service
│   │   ├── hostmap/              # domain → IP override (Chromium resolver rules)
│   │   └── nettools/             # ping, DNS, port scan
│   ├── shared/                   # TypeScript types + typed IPC contracts
│   └── ui/                       # Design system (Radix UI + Tailwind)
├── docs/
│   ├── USER-GUIDE.md             # Full feature guide & usage instructions
│   ├── landing/index.html        # Marketing landing page (demo)
│   └── TIEP-TUC-PHIEN-SAU.md     # Dev handoff notes
├── PLAN.md                       # Architecture & detailed design decisions
├── ROADMAP.md                    # Planned features not yet implemented
└── README.md                     # This file
```

---

## Tech Stack

| Layer | Choice | Reason |
|-------|--------|--------|
| App shell | Electron 42 | Mature SSH/PTY/Serial ecosystem for Node; used by VS Code, Tabby |
| UI | React 19 + TypeScript + Vite | Fast iteration; full type safety end-to-end |
| State | Zustand + Immer | Minimal boilerplate; fine-grained subscriptions |
| Styling | Tailwind CSS v4 + Radix UI | Dark-mode-first, dense developer-tool aesthetic |
| Terminal | xterm.js + WebGL renderer | VS Code standard; handles high-throughput output |
| SSH / SFTP | ssh2 | Full feature set: shell, exec, sftp, forwarding, agent, jump |
| Local PTY | node-pty | PowerShell, cmd, WSL, bash/zsh |
| Serial | serialport | Auto-detects COM/USB ports |
| Storage | better-sqlite3 + AES-256-GCM | Synchronous, fast; field-level encryption |
| KDF | argon2id | Recommended by OWASP for password hashing |
| OS keychain | Electron safeStorage | DPAPI (Windows) / Keychain (macOS) for vault key caching |
| Tests | Vitest | Fast unit tests; runs in Node and Electron Node runtime |
| Packaging | electron-builder + NSIS | NSIS installer for Windows; DMG for macOS; AppImage for Linux |

---

## Security Model

1. **Master password** → argon2id → 256-bit `vault_key`
2. All secrets (passwords, private keys, env vars, notes) encrypted **AES-256-GCM field-level**; metadata (hostname, label) stays plaintext for fast search
3. `vault_key` optionally cached via OS keychain (DPAPI / Keychain); cleared from RAM on vault lock
4. **Auto-lock** after 15 min idle — uses an overlay so terminal scrollback is preserved
5. Private keys are decrypted only in the main process; the renderer never receives plaintext key material
6. **Sync**: only an encrypted blob ever leaves the machine — the sync backend is zero-knowledge
7. **TOFU known-hosts**: full-screen warning if a host key changes (MITM protection)
8. All destructive actions (delete host / key / file / recording) require explicit confirmation

---

## Known Limitations (v0.2.20)

- **Local dev stack is Windows-only** for now (OS-specific work is isolated behind a single adapter, so other platforms are a matter of writing one). `.test` domains and local HTTPS are **not wired up yet** — mkcert installs and lands on `PATH`, but issuing/trusting a certificate is still a manual `mkcert -install`. There is no WordPress downloader (point it at a folder you already have), and no local↔server deploy or public-share link yet. phpMyAdmin 5.2 does not support PHP 8.4, so the app serves it with PHP 8.3 when both are installed
- **Domain → server mapping needs a Chromium browser** (Chrome/Edge/Brave/Vivaldi); Firefox has no equivalent flag, and the override has no effect when the machine routes through a system proxy (the proxy resolves DNS itself). Non-browser clients (Postman, MySQL clients) aren't covered — use a tunnel or the `curl --resolve` command instead

- Bulk / Monitor / SFTP / Local-forward tunnels through login scripts rebuild the path non-interactively: `ssh` hops (password hops need `sshpass` installed on the gate) and `su` / `sudo` steps are supported; exotic setups that force a TTY password prompt may still fail. Login-script tunnels also need `nc` on the innermost hop
- **Replication monitoring** covers MySQL/MariaDB **position-based** replication: GTID sets aren't compared yet (binlog file/position only), PostgreSQL streaming replication isn't supported, and there's no lag history chart or detached window yet. Reading status needs the `REPLICATION CLIENT` privilege
- Sync backends: **folder, Google Drive, WebDAV and S3** (Git planned — see [ROADMAP.md](ROADMAP.md)); moving the blob by hand is covered by export/import to a file. There is no conflict-resolution UI — the merge is Last-Write-Wins and it does not ask. The folder backend's passphrase minimum is 8 characters (remote backends require 12, since that blob lives off-machine holding your keys and host passwords behind that one passphrase). Cloud import reads only the first page on accounts with thousands of machines (a warning says so)
- Secrets Manager: 1Password, Bitwarden, HashiCorp Vault via CLI (KeePassXC planned)
- **Remote desktop tunneling** reaches targets via **jump-host chains** (SSH `-J` style); a target reachable only through an interactive **login-script gate** is not yet supported. **RDP** opens the OS client through a tunnel (not embedded); embedded FreeRDP is not planned. VNC needs a real VNC server on the target and network reachability (LAN or SSH tunnel)
- No team server or Docker/K8s browser; **cloud import covers DigitalOcean only** for now (AWS EC2 / GCP / Azure / Hetzner planned), it is a one-shot pull with no periodic refresh — see [ROADMAP.md](ROADMAP.md); plugin system is at **v1** (🛒 Marketplace tab installs from a static registry, entries are ed25519-signed; no permission enforcement / output transform yet)
- The **sensitive command guard** matches by text pattern, not by parsing the shell — it errs toward asking (e.g. `grep reboot` triggers the `reboot` rule) rather than staying silent, since a false prompt is safer than a missed `rm -rf`; tune the list in Settings to taste
- **Split layout** and **pane frame style** are global settings (applied to every split tab), not yet per-tab or per-pane
- **Custom mouse cursors** are limited by what a browser engine can do: **animated cursors (`.ani`) are impossible** and an animated GIF keeps only its first frame; images are capped at **128×128** (Chromium silently ignores anything larger, so the app scales down on import). The hover state of a cursor you add is a second image you supply, and it shares the normal image's hotspot. Cursors are stored per machine and not synced, and no third-party cursor theme is bundled — the popular ones (Bibata, Breeze, Capitaine) are GPL/LGPL, so download one and add it yourself
- **TOTP autofill** (`{{totp}}`) substitutes in interactive terminal sessions; exec-channel features (Bulk/Monitoring/SFTP) leave the token untouched. The **uptime watcher** TCP-checks each host's saved address directly — a host behind a login-script gate is checked at its gate address (still useful as "the gate is alive"). **Processes/Services** need Linux (`ps`, `systemd`); service start/stop usually needs root

---

## Roadmap

See [ROADMAP.md](ROADMAP.md) for the full list of planned features, including:

- Plugin system (F16)
- Sync backends: Git (WebDAV and S3 shipped in v0.2.16)
- Cloud host import — remaining providers (Hetzner; AWS EC2 / GCP / Azure shipped in v0.2.16, DigitalOcean in v0.2.13)
- Docker & Kubernetes browser
- Remote desktop v2: tunneling through login-script gates; embedded RDP
- Team self-host server with shared vaults and RBAC

---

## Contributing

The project uses a pnpm monorepo. Before submitting a PR:

```bash
pnpm typecheck   # must pass
pnpm test        # must pass
```

Core logic lives in `packages/core` — keep it free of Electron imports so it stays reusable. Renderer-only UI lives in `apps/desktop/src/renderer`.

---

## License

MIT © NguyenKhanh
