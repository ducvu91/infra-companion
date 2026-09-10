# Infra Companion — User Guide

> A next-generation desktop SSH client: everything Termius does, plus a lot more (local-first, self-hosted E2EE sync, bulk exec, monitoring, multi-provider AI…).
> This guide covers how to use — and how to test — the features of the **current release**. For upcoming features see [../ROADMAP.md](../ROADMAP.md).

---

## 0. Running the app

From the repo root `infra-companion`:

```bash
pnpm dev      # DEV — hot reload, code changes apply live (recommended while developing)
pnpm start    # Run the built version (run "pnpm build" first if you changed code)
pnpm build    # Production build into out/
pnpm dist     # Package an installer into release/
pnpm test     # Core tests: crypto / sync merge / ssh_config parser (merge needs Node >= 22.5; Node 20 auto-skips)
```

> ⚠️ Don't run `npx electron .` from the repo root — the app lives in `apps/desktop`. Use `pnpm dev`/`pnpm start`, or `npx electron apps/desktop`.

---

## 1. Vault (encrypted store) — the first screen

**What it is**: every host / password / SSH key is encrypted with a **master password** (argon2id → AES‑256‑GCM). No master password = the data can't be read. Local-first, no cloud account required.

**Use**:
- First time: set a master password (≥ 8 chars). Tick **"Remember on this machine"** to auto-unlock via Windows DPAPI / macOS Keychain (no re-typing).
- Lock now: the **🔒 Lock vault** button in the bottom status bar. Auto-locks after 15 minutes idle (unless "remember" is on).

**Test**: create a vault → add a host → quit the app → reopen. If you did **not** tick remember, the app asks for the master password; a wrong one is rejected.

### Marking a group PRODUCTION (and what the guard does about it)

In the group editor, tick **This group is PRODUCTION**. Every group beneath it inherits the mark, the same way the default user and key are inherited.

It changes one thing, and it changes it where it matters: the confirmation for a dangerous command. That dialog used to look identical no matter where the command was going. Now it tells you **how many machines will receive it** — the most-used path in this app is *open a group as N panes and turn Broadcast on*, which makes one keystroke into N machines — and names the **production** ones among them. When a production machine is in scope, the dialog asks you to **retype that machine's name**; a single click is too easy to give by reflex. Groups you haven't marked behave exactly as before.

### Pushing a public key to a host — the host editor, next to the password

For a host that logs in with a password, **🔑 Push public key to host** picks a key from your vault, appends it to the host's `~/.ssh/authorized_keys`, and then **logs in with that key** before telling you it worked.

That last step is the point. With the wrong permissions on `~/.ssh` or the file, sshd ignores the key and says nothing — the write succeeds, the command exits 0, and you find out only when the password prompt comes back. The app sets `700`/`600` on the way in and then proves the result by connecting. If the key is already on the host it skips the write (it compares the key itself, not the trailing comment, so pushing again from a second machine doesn't add a duplicate line). Only after the test login passes does it offer to switch the host over to key auth — and even then it just changes the form, so you still review and save.

### Reading a saved secret back

You can look at a password you stored. Edit the host → **👁 Show saved password** beside the password field; for a key's passphrase, open **Keys** and use **👁 Xem pass** on the row.

- **Your master password is asked for again every time, even while the vault is unlocked.** That is deliberate, not friction for its own sake: with *Remember on this machine* enabled the vault never auto-locks and unlocks itself at startup, so without this step anyone who sits down at your running app could read every credential you own. Five wrong attempts pause reveals for a minute.
- The value is **masked until you ask for it and hides again after 20 seconds**, and it is never kept in the app's shared state.
- **⧉ Copy directly** is the safer button: it moves the secret from the vault straight to the clipboard **without ever putting it on screen** — use it while sharing a screen. The clipboard clears itself after 30 seconds (and on quit), unless you copied something else in the meantime.

> TOTP seeds are deliberately not readable this way — they never leave the main process.

---

## 1B. Dashboard (home screen)

**What it is**: after unlocking, the app lands on a **Dashboard** — the home screen that lives *behind* your tabs. The **🏠 button** at the left of the tab bar returns to it anytime (it lights up while you're home); clicking any tab goes back to that tab, and closing the last tab drops you home instead of an empty screen.

**What's on it**:
- **Tools** — **one row of ten icons** across the top, plus **⊞ All** at the end, which opens the *All features* tab (full list, descriptions, search). The row **orders itself by how much you use each tool**: every time a tool opens — from the grid, the `⋯` menu, the palette or a tab — it scores a point, and points fade with a 30-day half-life, so a fortnight of heavy use months ago no longer holds a tile that this week's habit can never win back. Before you've used anything the order is simply the catalogue order. **✎ Arrange** (top right of the section) opens a panel to **pin** the tools that should always keep a tile — pinned ones come first, drag them into the order you want — with every tool listed underneath, its usage count beside it, and the ones that no longer fit the row dimmed so you can see what got cut. Nothing disappears: whatever misses the row is one click away under ⊞ All. Hover an icon for its name; the **📡 uptime watcher** tile stays highlighted while it's running, because that one is a toggle rather than a panel. Pins and counts are per-machine.
- **Host groups sit directly under the tools** — the click-to-work area comes before the read-only stat tiles.
- **Quick connect** — in the **header row next to *+ New terminal***: type `user@host[:port]` and press Enter. A confirmation drops down under the box once what you typed looks like a target.
- **Stats** — hosts, groups, connections today / last 7 days (derived from Quick-Connect history)
- **★ Favorites** — one click opens an SSH tab
- **Finding a tool**: the sidebar **`⋯` menu** has a **search box** at the top — type two or three letters and it searches the **whole** catalogue, not just the daily shortlist it shows when idle. Entries are **grouped by area** (same groupings as the *All features* tab), *Create group* and *Import ssh_config* sit in their own **Manage hosts** section because they change your data rather than open a tool, and **⊞ All features… / Settings / Help** are pinned at the bottom so they never scroll away. It's the way in while you're on a terminal tab and the Dashboard isn't showing. Every dialog has a **×** in its header (and `Esc` still works).
- **Anything long-running belongs in a tab.** A dialog blocks the whole app while it's open, so the tools that take time — *Watch a log*, *Scheduled jobs*, *Rotate SSH keys*, *What is filling the disk*, *What needs patching*, *Trusted fingerprints*, alongside Monitoring, Tunnels, Processes and Services — carry a **⊞** button in their header that moves them into a tab. Moving restarts the tool, so a log you intend to watch for a while is best opened as a tab from the start.
- **A "Needs attention" strip** at the very top — hosts that aren't responding, tunnels that failed, and replicas with a critical diagnosis. It shows up **only when there is something wrong**; a panel that is always there is a panel you stop reading. A host with no check result yet is not counted as down, and while the watcher is off the strip stays quiet entirely, because silence there means "no data", not "all clear".
- **Host group cards** — three separate things to click, so the group isn't all-or-nothing:
  - **the `⊞ N` chip** (top right) opens the whole group as split panes in one tab, ready to broadcast — the group's main one-click action, in the corner where a button belongs.
  - **each host chip** connects to **just that host**. Every chip carries its own status dot, so you can see *which* machine is down, not merely that one is.
  - **the group name and the *View all hosts* footer** open the **full host list** — and it opens **in place**, right where the cards were, with a **← Back** button, instead of a popup that covers the Dashboard. Every host with its `user@host:port` and status, connect over SSH or SFTP one at a time, *open all N panes* stays available in the header. The list stays put while you open several machines in a row.

  The card still reads clearly as a group rather than a single host: a **full-height band in the group's colour**, the `⊞ N` count, and the group's default SSH user when it has one. Groups larger than six hosts show `+N`, which opens the same full list.
  - Dot colours: green = up, red = not answering, **grey = not checked yet**. The dots and the `x/y up` ratio come from the 📡 uptime watcher, so a group it hasn't reached yet stays grey with no ratio instead of looking like everything is down.
- **Recent connections** — click to reconnect (ad-hoc targets reconnect via Quick Connect)
- **🗂 Workspaces** — restore a saved tab/split layout in one click (*Manage* opens the full modal)
- **🔀 Tunnels** — live status dot per rule with **Start/Stop** right on the row
- **⌨ Keyboard shortcuts** — a cheat sheet of every global shortcut

On a wide window those last four lists each **split into two columns inside their own box** (read down the left column, then the right), so a ten-row list is only five rows tall. They go back to a single column when the window is narrow.

**Prefer the old boot-to-shell?** Settings → **Startup page** → *Terminal* auto-opens a local shell on launch instead (the dashboard stays reachable via 🏠).

**Test**: unlock → dashboard shows and 🏠 is highlighted; open a host → tab activates and 🏠 dims; press 🏠 → dashboard returns with the SSH tab still alive; close all tabs → you land on the dashboard.

---

## 1C. The sidebar — arrange it your way

**What it is**: the left column is a stack of **blocks**, and you decide which ones are there and in what order. The **⚙ button** beside the search box opens the layout panel.

**The blocks**:

| Block | On by default | Clicking a row |
|---|---|---|
| **★ Favorites** | yes | connects to the host |
| **🗂 Host groups** | yes | your groups and their hosts (see below) |
| **🔀 Tunnels** | no | **Start/Stop** right on the row, live status dot |
| **📝 Snippets** | no | opens the run dialog (variables + which panes to send to) |
| **🗂 Workspaces** | no | reopens that whole tab/split layout |
| **🕒 Recent** | yes | reconnects |

In the ⚙ panel: **tick** to show or hide a block, **drag the ⠿ handle** to reorder. Every block is in one list whether it's on or off — turn one off and back on and it returns to the same place, rather than jumping to the end. **Reset to default layout** puts it back. It's all stored **on this machine** (not synced), and the defaults are exactly the old layout, so if you never open the panel nothing changes.

Why the three new blocks exist: they do their most common job **without leaving the column** — flipping a tunnel on, running a snippet, restoring a workspace — instead of opening a dialog for a one-second action. The full editors still live in their own tools; a 240px column is no place for a form. A block that's on but has nothing in it says so rather than leaving a blank gap.

### Groups fold

Every group used to be open at once, so four groups of five or six hosts already ran past the bottom of the screen. Now:

- **Click a group's name** to fold or unfold it; it's remembered across restarts. A folded group shows its **host count**, which is the only thing left saying what's inside.
- **Searching opens everything** regardless of what's folded — a search that hides its own result would be useless exactly when you need it.
- With **three or more groups**, a **collapse/expand-all** button appears next to the search box.
- **★ Favorites folds too.** A pinned host deliberately appears twice — there and in its own group — so if you prefer finding it in the group, fold the Favorites block and you lose nothing.

### The group `⋯` menu

Each group header carries a single **`⋯`** button holding three things: **open the whole group** (every host as split panes in one tab), **edit group**, and **delete group**. Delete sits below a divider and turns red on hover — it's the only one there that loses data, and it still asks for confirmation. (These were three separate hover icons before, crowded against the host count.)

**Test**: open ⚙ → tick **Tunnels** on and drag it above **Host groups** → the tunnels block appears at the top with working Start/Stop; restart the app → the layout is still yours; type in the search box → every group opens; clear it → your folded groups come back folded.

---

## 1D. Themes — Infra default vs Navigator (Termius-style)

**What it is**: Settings → **Appearance** → **Theme** switches the *arrangement* of the whole window. (Dark/Light is a separate setting just below it, now called **Color mode** — either theme works in either color.) Two thumbnails show what you're picking; the change applies instantly and is stored on this machine.

- **Infra default** — everything described in 1B and 1C: the left column *is* the host list, groups fold and unfold in place, the Dashboard is home.
- **Navigator** — the Termius-style layout. The left column becomes a **menu**: 🖥 Hosts · 📁 SFTP · 🔀 Tunnels · 📝 Snippets · 🔑 SSH Keys · 🪟 Workspaces · 🕒 History · ⊞ Tools, with ⚙ Settings and ❓ Help pinned at the bottom. **Dashboard is off by default in this theme** — it starts at Hosts, and there is no 🏠 in the tab bar because any menu entry brings you back to the main area (the *Startup page* setting reads *Home page* here). **Nothing unfolds inside the column.** Click an entry and its content opens in the **main area** while your terminal tabs keep working exactly as before above it. Counts sit next to Hosts / Tunnels / Snippets / Keys / Workspaces, and Tunnels gets a green dot while one is running. **The menu is yours to arrange**: the ⚙ at the top of the column opens *Menu layout* — tick which entries show (🏠 Dashboard is in the list, unticked) and drag to reorder, exactly like the sidebar blocks of the Infra theme; Hosts stays on (it is home) but can be moved, a hidden entry is still reachable from the Command Palette, and *Reset to default layout* restores the original order. At launch the app opens on the entry you left, or on Hosts if that entry is hidden. `«` (or `Ctrl+Shift+H`) narrows the menu to icons only rather than hiding it. Every entry is also a Command Palette command.
- **Workbench** — the VS Code layout. A **48px activity bar** on the far left picks what the **side panel** next to it shows: 🖥 Hosts (the full host column from the Infra theme — search, quick connect, favorites, folding groups, blocks, the + Host / Keys / ⋯ row), 🔀 Tunnels, 📝 Snippets and 🪟 Workspaces (start / run / open on the row, *Manage…* at the bottom opens the full editor), 🔑 SSH Keys (copy a public key on hover), 🕒 History and ⊞ Tools (the catalogue in one column). The **main area never changes** — your terminal tabs, or the Dashboard when none is open — so you can look something up without leaving the session. **Click the lit icon again** (or `Ctrl+Shift+H`) to close the panel; the bar stays. **Drag the panel's right edge** to resize it (200–520 px, remembered). 🏠 goes home and 📁 opens the SFTP page as a tab. **The bottom panel** (`Ctrl+J`, the ⬒ icon at the bottom of the activity bar, or the palette) docks under the terminal with three tabs: 📊 **Monitoring** (the same cards as the floating dock, in a grid — in this theme starting Monitoring opens the panel instead of the dock), 🪵 **Log** (*Watch a log*) and 🔀 **Tunnels** (the full table). Drag its top edge to resize (120–600 px); height, tab and whether it is open are remembered. The tabs stay mounted, so a running tail survives switching between them.

**The Hosts page** (Navigator → Hosts) is the host book in the main area:
- **★ Favorites** first, as wide rows with the group's name on the right.
- **Groups as folder cards** — colour band, host count, `x/y up` from the uptime watcher, default user, a PRODUCTION badge, and the same **`⋯` menu** as the sidebar (*open the whole group · edit · delete*). **Click a card to step inside**: a `← Hosts` breadcrumb, the group header with **⊞ open all N panes**, **+ Host** (that group pre-selected) and `⋯`, and every host as a row.
- **All hosts** come last as one flat list sorted by name, each row naming its group — for when you don't remember which folder a machine lives in. (Hosts with no group appear here too; a search still lists them under *Ungrouped*.)
- A **host row** shows the status dot, label, `user@host:port`, a badge for VNC / RDP / Telnet / Serial and for jump hops (`⛓1`); hover it for the same actions as the sidebar row — favorite, notes, split, SFTP, duplicate, edit. Click the row to connect.
- **Search** in the page header flattens everything into one list grouped by group name, so a match never hides inside a folder; type `user@host[:port]` and a *Connect to …* button appears, exactly like the sidebar's quick connect. Enter with exactly one match opens it.
- **+ Host**, **+ Group** and a **`⋯` import/export menu** (ssh_config, cloud import, export) sit in the header. A host whose group was deleted is listed under *Ungrouped* rather than disappearing.

**Other pages**: **SFTP** is the file manager with the host chosen *afterwards* — see section 4. **History** lists every recent connection the vault remembers (up to 50), naming the host when it was a saved one and marking quick-connect targets as *not saved as a host* — click to reconnect. **Tunnels / Snippets / SSH Keys / Workspaces** are the dialogs you already know, embedded as pages; together with History they lay their rows out in **two columns** when the main area is wide enough (about 770 px) and fall back to one column in a narrower window. **Tools** is the *All features* catalogue.

**Test**: Settings → Appearance → pick *Navigator* → the left column turns into the menu with *Hosts* selected, no Dashboard entry and no 🏠 in the tab bar; click ⚙ at the top of the menu → *Menu layout* lists nine entries with Hosts locked and Dashboard unticked, tick *Dashboard* → it appears at the top of the menu, untick *Snippets* → it leaves the menu, drag *Tunnels* above *SFTP* → the order changes and survives a restart, *Reset to default layout* → back to the original; click *Tunnels* in a wide window → two columns of tunnel rows, narrow the window below ~980 px → one column; click a group card → its hosts appear with a `← Hosts` breadcrumb; open one → the terminal tab opens and 🏠 dims; click *Hosts* in the menu → you are back on the same group; type part of a host name → a flat list; press `«` → icons only; switch back to *Infra default* → the old sidebar returns with your groups still folded the way you left them. Pick *Workbench* → a narrow icon bar plus a panel showing the host column; click 🔀 → the panel switches to tunnels with Start/Stop on each row; click the lit 🔀 again → the panel closes and the bar stays; drag the panel's right edge → it resizes, and the width survives a restart.

---

## 2. Managing Hosts / Groups / Keys

### Host
- Left sidebar → **+ Host**. Fill in name, hostname/IP, port, username, auth method.
- Click a host to connect; hover to reveal **⭐ pin**, **split** (⊟), **SFTP** (📁), **edit** (✏).
- **Notes**: the host editor has a **Notes** field (Markdown, **encrypted** in the vault) — record the server's purpose, handoff info, app passwords… Hosts with a note show a **📝** button in the sidebar for a quick read-only view; synced with the host.
- **Favorite hosts**: hover a host → click **⭐** to pin it. Pinned hosts appear in the **★ Favorites** block of the sidebar (top by default — you can move or hide that block, see §1C) for quick access, still filtered by the search box. Click ⭐ again to unpin. Stored **on this machine** (not synced). *Test: pin a host → it shows under ★ Favorites; it persists across app restarts.*

### Authentication — 7 methods
| Method | When to use |
|--------|-------------|
| **Password** | Type a password; leave empty = prompt on every connect |
| **SSH Key** | Pick a key imported/generated in the Keys panel |
| **SSH Key + Password** | 2-factor login — the server requires *both* a key **and** an account password (`AuthenticationMethods publickey,password`). Pick a key and enter the password (leave it blank to be prompted at connect). Reuses the group's key when inherited. |
| **SSH Agent (OS)** | Use the Windows/OpenSSH agent or Pageant (incl. FIDO2 sk-keys) |
| **Secret manager** | Fetch the password from 1Password/Bitwarden/Vault at connect time (see §14B) |
| **No authentication** | Server lets you straight in (auth none / empty password) |
| **(inherit from group)** | Use the group's default configuration |

### Keys (the **Keys** button)
- **Generate a new key**: creates an ed25519 pair; the private key is encrypted in the vault. Click **Copy pub** to paste into `~/.ssh/authorized_keys` on the server.
- **Import a key**: paste a private key (OpenSSH/PEM/PuTTY), enter a passphrase if any.

### Groups + inheritance
- Menu `⋯` → **Manage hosts** → **Create group**. Set defaults: username / auth method / key / env / startup snippet. (To edit or delete one later: the group's **`⋯`** button in the sidebar — see §1C.)
- Hosts in the group that leave those fields empty **inherit** from the group.
- **Test inheritance**: create a group "Production" with default username `deploy` → create a host with username left blank → connect and it uses `deploy`.

---

## 3. Advanced SSH connections

### Quick Connect
Type `user@host` or `user@host:port` directly into the sidebar search → Enter to connect immediately (no need to save a host). The 50 most recent connections appear under **Recent**.

### Jump host (multi-hop ProxyJump)
- Edit host → **Advanced** → add jump hosts in order. Equivalent to `ssh -J hop1,hop2 target`.
- Each hop verifies the host key and prompts for its own password if needed.
- **Note**: this kind of jump authenticates **from your machine** through a tunnel. If the target only accepts a key already present **on the gate** (and won't accept your credentials from outside) → use **Login script** below instead.

### Login script (su → ssh, or nested ssh) — not in Termius
- Edit host → **Advanced** → **Login script** → the **"Template: su → ssh"** button, or add steps yourself.
- Each step: **wait for a string** (e.g. `assword`, `$`) → **send a command**. Tick 🔒 if it's a password (encrypted in the vault).
- Real example (web-01 via a gate):
  - Host `web-01`: hostname = `gate.example.com` (gate), auth = the gate's.
  - One-step login script: wait for `$` → send `ssh deploy@web-01`.
  - On connect → the app SSHes into the gate then types `ssh web-01` → you land directly. Re-runs on auto-reconnect too.

### TOTP 2FA autofill (`{{totp}}`) — hands-free verification codes
- Host asks for a **Google Authenticator code** on login? Edit host → **Advanced** → **TOTP 2FA** → paste the account's **base32 secret** (the string behind the QR code; encrypted in the vault, never sent to the UI).
- In the login script, add a step: wait for `Verification code:` (or whatever the prompt says) → send **`{{totp}}`**. The app replaces the token with a **fresh 6-digit code at the exact moment the step is sent** — safe even on slow multi-hop chains.
- RFC 6238 compatible (Google Authenticator / FreeOTP / server-side `google-authenticator` PAM). Applies to interactive terminal sessions; Bulk/Monitoring/SFTP exec paths leave the token untouched.

### tmux — auto-resume the session on network drops (per-host)
- Edit host → **Advanced** → tick **"tmux — auto-resume session on drop"**. After login the app runs `tmux new-session -A -s ic-main`.
- Network drops → the app reconnects → **re-attaches** the still-running tmux session on the server (running commands/server-side scrollback intact). Even if the app gave up after 3 retries, **reopening the host** re-attaches it.
- **Requires**: `tmux` installed on the server. Note: the startup snippet runs in the shell **outside** tmux; opening the same host in 2 tabs "mirrors" (same tmux session).

### Other
- **Agent forwarding** (`ssh -A`), **env vars** (sent after login), **startup snippet** (auto-runs after login) — all under Advanced.
- **known_hosts (TOFU)**: the fingerprint is shown for verification on first connect; if the host key changes → a red alert (anti-MITM).
- **Auto-reconnect**: on a drop, it retries 3 times (yellow status in the terminal).

---

## 4. SFTP (file transfer)

**Two ways in.** (1) **From a host**: the 📁 button on a host row (sidebar or Hosts page) opens an SFTP tab already connected to that host. (2) **From SFTP itself** — new: 📁 **SFTP** in the Navigator menu, or in the Infra theme via `⋯` → SFTP, the Dashboard grid, *All features* or the palette (opens as a tab). The page starts with **your local files on the left** and a *Connect to host* card on the right. **Select host** lists your SSH hosts by group, favorites first, with a search box (Enter picks the only match). The chosen host's files then appear on the right, in place. **Change host** / **Disconnect** are in the header. In the Navigator theme the connection survives switching to other menu entries and back. Only SSH hosts are listed, because SFTP runs over SSH.

**Open**: hover a host in the sidebar → click the 📁 icon.

- Two panes: **Local** ↔ **Remote**. Double-click a folder to enter; `↑` goes to parent, `⟳` refreshes, `+📁` makes a new folder.
- The **→** button uploads, **←** downloads (recursive for folders). A transfer queue + progress sits at the bottom.
- Rename, delete (recursive), **chmod** (octal), and **✏ Edit** — opens the remote file in your default editor, and **saving auto-uploads** it.

### SFTP over an inner host (nested-ssh) — a standout
For a host reached via the login script `ssh deploy@web-01`, SFTP **enters web-01 itself** (doesn't stop at the gate) by running `ssh deploy@web-01 -s sftp` on the gate. No extra configuration.

**Test**: open SFTP for `web-01` → the Remote pane should be `/home/deploy` **on web-01**, not the gate's.

---

## 5. Terminal & Multi-pane

| Feature | How |
|---------|-----|
| **New tab** (local) | `Ctrl+Shift+T`, or the `+` button (chevron to pick a shell: PowerShell/cmd/Git Bash/WSL) |
| **Add a pane to a tab** | `Ctrl+Shift+D` adds a local pane; the **⊟** icon on a sidebar host opens it into a new pane of the current tab |
| **Merge tabs ⇄ split** (the **⊞ Split** button) | Click **⊞ Split** in the toolbar: merge **ALL open terminal tabs** into panes within one tab (so Broadcast spans them); click again to split back into separate tabs. Scrollback is preserved across merge/split |
| **Open a whole group** | The **grid** button on a group header in the sidebar (or the **Open group** command in the Command Palette): opens every host in the group as pre-split panes in one tab — ready for Broadcast |
| **Split layout** | The **▼** next to **⊞ Split ON**: pick **Auto grid** / **Side by side** / **Stacked** / **Main left** / **Main top**. Also in **Settings → Terminal → Split layout** (global default) |
| **Pane frame** | **Settings → Terminal → Pane frame**: **Compact bar** (status dot + title + ✕) or **Mac style** (rounded corners + a round red close button) |
| **Command palette** | `Ctrl+Shift+P`, or the **⌘ Commands** button at the right of the tab toolbar |
| **Rearrange panes** | **Drag a pane's title bar** onto another pane: the two **swap places**. Drop anywhere on the target — its whole area lights up, not just the title bar. Only those two move, everything else stays where it is; in **Main left / Main top** that means dropping a pane onto the big one promotes it to main. Only the title bar is draggable, so selecting text inside a terminal still works. The **⋮** menu (move left/right, set as main) is unchanged |
| **Resize panes** | **Drag the divider** between panes (whole column/row resizes); **double-click** a divider to reset to equal sizes. For **Main left/top** you drag the main/secondary split |
| **Broadcast** | The **📡 Broadcast** button or `Ctrl+Shift+B`: type in one pane → it's sent to **ALL panes** in the tab |
| **Switch tabs** | `Ctrl+Tab` / `Ctrl+Shift+Tab` |
| **Reorder tabs** | **Drag a tab** along the bar and drop it where you want. An accent line shows where it will land — left half of a tab means *before it*, right half means *after it*, and the empty space past the last tab means *to the end*. Dragging near either edge scrolls the bar, so a target that's off-screen is still reachable. Dropping does **not** switch tabs, and nothing is reconnected — the sessions keep running exactly as they were |
| **Close tab/pane** | `Ctrl+Shift+W`, or `✕` on the tab/pane, or middle-click the tab |
| **Find in terminal** | `Ctrl+F` |
| **Copy / Paste** | `Ctrl+Shift+C` / `Ctrl+Shift+V` — **rebind in Settings → ⌨ Keyboard shortcuts**. Pasting goes through the bound combo or right-click only; plain `Ctrl+V` no longer auto-pastes (standard terminal behavior) |
| **Copy with the mouse** | Select text → **left-click inside the highlight** = copy (a *"Copied"* toast confirms) |
| **Paste with the mouse** | **Right-click** anywhere in the terminal = paste the clipboard at the cursor (respects Broadcast) |
| **Wheel prints `65;53;18M…` garbage?** | A remote program left xterm **mouse reporting** on (or an escape sequence sneaked in while `cat`/`tail`-ing a log). Type `reset` in that shell to clear it; holding **Shift** while scrolling always bypasses mouse reporting |

### Test Broadcast (the "type once, run on many servers" feature)
1. Open SSH to web-01. 2. Hover web-02 in the sidebar → click **⊟ split** → two panes side by side.
3. Click **📡 Broadcast ON**. 4. Type `uptime` → both panes run it.

> Faster: put web-01 + web-02 in the same group → click the **grid** button on the group header → both open as panes → turn **Broadcast ON**. Or, if you already have several separate tabs, click **⊞ Split** to merge them all into panes in one tab.

---

## 5B. Appearance & background — `⋯` → Settings

Settings opens as a **full-screen page** with a category rail on the left — **Appearance**, **Background image**, **Terminal**, and **Sensitive command guard** — and a scrollable pane on the right. Press **Esc** or the **✕** in the header to close it.

- **Theme** (layout): *Infra default* / *Navigator* — see **1D**. **Color mode**: Dark / Light. **Language**: Tiếng Việt / English / 日本語. Changes apply instantly and persist across launches.
- **Background image**: set a wallpaper that shows faintly behind the **whole window** (behind both the sidebar and the terminal); chrome (sidebar/tabs/status) becomes translucent to reveal it, while modals/menus stay opaque for readability. Two ways to set it:
  - **Choose image…** — pick a local file.
  - **Paste an image link** in the box and click **Add** — works with direct image URLs (e.g. ending in `.jpg`/`.png`) and with **Google Drive** / **Dropbox** share links (the app rewrites those to a direct-download form for you). For Google Drive, set the file's sharing to **"Anyone with the link"** first — a private link returns a login page and is rejected. The link is fetched once in the background; only a local compressed copy is kept (so the wallpaper still works offline).

  Then adjust:
  - **Fit**: *Cover* (fills, may crop) / *Contain* (shows the whole image, no crop).
  - **Position**: Center / Left / Right / Top / Bottom.
  - **Opacity** (5–100%) and **Blur** (0–24px) — lower opacity or raise blur if text is hard to read over a bright image.
  - **Remove** to clear the background.
- The image is auto-compressed and stored **on this machine** (not synced) — everyone picks their own. Switching to a different image or link replaces the previous one (nothing accumulates).
- **Accent color**: a color picker sets your own accent (primary buttons, selection borders…) on top of the dark/light theme; a Reset button restores the default.
- **🎨 Custom palette (Theme studio)**: a collapsible section in Settings → Appearance to customize **11 UI colors** (Background, Sidebar/bars, Modals, Inputs, Hover, Borders, Text, Muted text, Danger, Success, Warning). Click a swatch to change it → **applied live**. Overrides are stored **separately per theme** (dark and light), so toggling Dark↔Light stays correct. The **✕** next to a color clears that override; **Reset to default** clears them all.
  - **Export / Import theme**: click **Export / Import theme** → a JSON box shows the current theme (accent + palette). **Copy** to share/back up; paste another JSON and **Apply** to load it. (Stored on this machine, not synced.)
- **Terminal**: adjust **font size**, **line height**, **cursor style** (block/bar/underline), **GPU acceleration (WebGL)**, **Split layout** (default arrangement for split panes), and **Pane frame** (Compact bar / Mac style). Applies instantly to all panes.
- **Font**: a dropdown of the fonts **actually installed on this machine**, grouped as *Fonts on this machine* and *Fonts you added*. The app reads the real family name out of each font file (filenames don't tell you — `segoeui.ttf` is "Segoe UI"), so what you see is what CSS will accept. **↻** re-scans, for when you install a font while the app is running; **↺** restores the default.
  - The **sample line** below the dropdown renders `ilI1 O0 {}[]() <=> --> │├─┤` and a shell prompt in the font you're considering — the characters that actually matter in a terminal.
  - Two warnings worth paying attention to. *"This machine doesn't have X"* means your `font-family` names a font you don't have, so the terminal has been quietly rendering with something else — worth knowing, since the default stack starts with `Cascadia Mono`, which is not present on every Windows install. *"X is not monospace"* means columns won't line up and box-drawing characters will break.
  - **+ Add a font file** — pick a `.ttf` / `.otf` / `.ttc` / `.woff` / `.woff2` you downloaded and it becomes usable in the terminal **without installing it into the operating system**. Handy on a locked-down machine, or when you don't want a one-off font cluttering your system list. The file is copied into the app's data folder (up to 8 fonts, 2 MB each) and stays on this machine — it isn't synced. If the family name the app read from the file looks wrong, edit it in the row.
  - **Type a CSS stack** reveals the old free-text field, for when you want several fallbacks in a specific order rather than one family.
- **Mouse cursor**: pick the pointer for the whole app, terminal included. Two groups: **six of your operating system's own** (hand, crosshair, cell, I-beam, grab) and **thirteen drawn by the app** — white / black / accent-colored arrow, ring, dot, 8-bit pixel, plus sword, heart, pine tree, rocket, pencil, lightning and cat's paw. Text fields keep their own I-beam. The app-drawn ones carry a dark halo under a white rim so they stay visible on the black terminal, on light panels and on a busy background image.
  - **Each cursor has two states**: normal, and a **hover state** used whenever you're over something clickable — a button, a link, a checkbox. Choose the sword and buttons show the sword too, scaled up slightly with a glow in your accent color, instead of the browser's hand. Both states are generated from the same drawing, so they always match. The OS cursors pair up the conventional way (grab → grabbing, the others → the hand).
  - **Hover a tile** to preview its normal state, and use the **try-out strip** below the picker to see all three at once: *Normal*, *Clickable*, *Text field*.
  - **Add your own** with **+ Add from an image file** — PNG, GIF, WebP, SVG, CUR or ICO. Worth knowing before you go looking for cursors to download: **Windows `.ani` files cannot work here** (no browser engine can animate a cursor), and an animated GIF only ever shows its first frame — so download the static image, not the animated cursor pack. Images larger than **128×128** are scaled down automatically, because Chromium ignores anything bigger *without reporting an error* — the cursor would simply never change.
  - The **dashed slot** next to each of your own cursors is its hover image — optional. Leave it empty and hovering a button falls back to the normal hand; fill it and your cursor behaves like the built-in ones.
  - **X / Y** on each row is the **hotspot**: which pixel of the image is the actual pointing tip. Leave it at `0, 0` for an arrow; for a ring or crosshair set it to the middle of the image, otherwise your clicks land offset from where the cursor appears to be. The hover image **shares this hotspot**, so choose one the same size as the normal image.
  - Cursors are stored **on this machine** (not synced), and the app deliberately ships none of the well-known third-party cursor themes — they carry their own licences. Download the one you like and add it here.

---

## 5C. Workspaces (save & restore a layout) — `⋯` → Workspaces

**What it is**: save your current layout (all tabs + split panes + Broadcast state) as a named workspace and restore it in one click. Great for repeating familiar layouts (e.g. "Monitor cluster" = web-01+02 pre-split + Broadcast).

**Use**:
- Open the tabs/splits you want → `⋯` → **Workspaces** → name it → **Save**.
- Restore: pick a workspace → **Open** (adds to your current tabs). **✏** renames, **✕** deletes.

> A workspace saves **terminal and SFTP tabs**. Tool tabs (Monitoring, Compare, Local dev, Tunnels, Processes, Services, AI troubleshooter) are **not** part of it — they hold no session, so reopening one from the `⋯` menu or the palette is a single click.

**Notes**:
- Opening a workspace creates **fresh SSH sessions** (re-login, no old scrollback).
- Opening **adds** tabs (doesn't close current ones) — opening twice doubles the tabs.
- Stored **on this machine** (not yet synced); it only references hosts by ID, so any host synced to another machine can be opened there. A deleted host's pane is skipped (a soft error), without blocking the other panes.

**Test**: open web-01, split in web-02, turn on Broadcast → Save as "ST monitor" → close all tabs → Workspaces → Open "ST monitor" → both panes reopen side by side with Broadcast already on.

---

## 5D. Sensitive command guard — `⋯` → Settings → Sensitive command guard

**What it is**: a safety net for destructive commands. When you press **Enter** on a command that matches your watch-list, a confirmation popup appears **before** the command runs. It's aimed at the classic accident — pressing **↑** to recall a command and running the wrong one.

**Why it catches ↑-recalled commands**: it reads the **actual command line from the terminal buffer**, not your keystrokes. When you recall a command with ↑, the client only sends `↑`; the command text is echoed back by the server. Reading the buffer is the only way to know what's really on the line — so history-recalled commands are guarded just like typed ones.

**Defaults** (on out of the box): `rm -rf`, `rm -fr`, `rm -r`, `sudo rm`, `mkfs`, `dd if=`, `dd of=`, `shutdown`, `reboot`, `poweroff`, `halt`, writing straight to a disk device (`… > /dev/sda`), and the classic fork bomb.

**Configure**: Settings → **Sensitive command guard**.
- Toggle the whole feature on/off.
- Edit the list — **one pattern per line**. A plain pattern matches when the command **starts with** it at a command position (e.g. `rm -rf` matches `rm -rf build` and `cd /tmp && rm -rf build`, but not `warm -rf`). Wrap a pattern in `/…/` to use a **regex** (e.g. `/>\s*\/dev\/sd/`).
- **Restore defaults** brings back the starter list.

**Behavior**:
- The **Cancel** button is focused by default, so a reflexive second **Enter** cancels — you have to deliberately choose **Run anyway** to proceed. Cancel leaves the command sitting at the prompt so you can edit it.
- It adds **no per-keystroke latency** (the check runs only on Enter) and automatically **stands down inside full-screen apps** (vim, less, htop…) so it never interrupts an editor.
- It matches by text, not by parsing the shell, so it errs toward asking (e.g. `grep reboot` triggers the `reboot` rule) — a false prompt is safer than a missed `rm -rf`. Trim the list if a pattern is too eager.

**Test**: type `rm -rf /tmp/nothing-here` → press Enter → the confirmation popup appears. Press **↑** to recall it and Enter again → it's still caught. Open `vim` and type `rm -rf` on a line → Enter does **not** trigger it.

---

## 6. Telnet & Serial

- Edit/Add host → **Protocol**: **Telnet** (host + port 23) or **Serial (COM/USB)**.
- Serial: a dropdown **auto-lists connected COM ports** + pick a **baud rate** (9600…230400). For switch/router consoles over a USB-serial cable.
- **Test Serial**: plug in a USB-serial cable → add a Serial host → pick the port → connect → press Enter to see the device prompt.

---

## 7. Session logging

- On the tab toolbar: the **⏺ Log** button → writes the selected pane's entire output to `…/logs/<timestamp>_<name>.log` (ANSI codes stripped).
- Command Palette → **📂 Open session log folder** to view files.
- **Test**: turn on ⏺ → type a few commands → open the log folder → check the contents.

---

## 7B. Session Recording & Replay — `⋯` → Recordings

**What it is**: record a terminal session as **asciicast v2** (the asciinema standard) — raw + timing — to **replay like a video**. Different from logging (plain text for grep).

**Record**: tab toolbar → the **⏯ Record** button (next to ⏺ Log). Turn on → records to a `.cast` file.
**Replay**: `⋯` → **⏯ Recordings** → pick one → **▶ Replay** → a player with **play/pause (⏸/▶)**, **restart (↺)**, a **seek bar**, and **1x/2x/4x/8x speed**.
**Export**: 📂 Open folder → the `.cast` file opens with `asciinema play` or the web asciinema-player.

**Test**: open a terminal → ⏯ Record → type `ls`, `top` then `q` → stop recording → Recordings → Replay → try the seek bar + 4x.

---

## 8. Snippets (saved commands)

- Menu `⋯` → **Snippets**. Create a snippet with `{{variable}}` placeholders.
- Run: the **⚡** button on the tab toolbar → pick a snippet → fill in variables → tick target panes → **Run** (multi-session).
- **Test**: snippet `sudo systemctl restart {{service}}` → run with `service=nginx` across several sessions.

---

## 9. Tunnels (port forwarding) — `⋯` → Tunnels

| Type | Meaning |
|------|---------|
| **L (Local)** | A port on your machine → through SSH → destination (e.g. reach a remote DB as if local) |
| **R (Remote)** | A port on the server → back to your machine |
| **D (Dynamic)** | A local SOCKS5 proxy — browse the web through the server |

**Where the panel lives** — the popup is modal, so it blocks the app while you watch a tunnel come up. Two ways out, both in the Tunnels header (and in the Command Palette):

- **⊞ Open in tab** — the same panel as a tab; keep working, switch away and back.
- **⧉ Detach** — a small **always-on-top window** (like the detached monitoring window). Ideal while your DB client or browser covers the app: you still see each tunnel's status dot and can start/stop it. It shares the app's live tunnel events, so nothing reconnects. Close it (⧉ *Merge back*) to return.

**Order** — the list is sorted **by name, A→Z**, in the popup, the tab, the detached window and the Dashboard alike. Sorting is natural and case-insensitive: `db2` comes before `db10`, `DB2` before `db11`.

**Name your tunnels**: the tunnel editor has an optional **Name** field — give each rule a friendly label (e.g. *"Prod DB"*, *"Staging Grafana"*) so a long list stays readable. The list shows the name on top and the actual route (`:port → host:port`) underneath, so you always see where a named tunnel goes. Leave the name blank and it falls back to the route as before.

**Test SOCKS5**: + Tunnel → host `gate-01`, type **Dynamic**, bind `1080` → **Start** (green dot) → set SOCKS5 `127.0.0.1:1080` in your browser → traffic goes through the gate.
**Test Local**: type L, bind `13306`, dest `127.0.0.1:3306` → connect MySQL to `127.0.0.1:13306`.

**Local tunnel through a login-script chain (reach a DB behind nested SSH)**: if the **via host** is one you reach by a **login script** (e.g. `gate → app-01 → app-05`, where each hop is `ssh` typed inside the shell and won't accept a jump host), a **Local** tunnel forwards by running `nc <dest> <port>` on the innermost machine over the login-script chain (like Bulk/Monitor) — so you can reach a database only pingable from the deepest hop straight from your laptop.
- **Via host** = that login-script host · **Type** = L · **Bind** = e.g. `13306` · **Destination** = `<db-host-as-seen-from-the-innermost-hop>:3306` → **Start** → point your DB client at `127.0.0.1:13306`.
- Requires **`nc`** on the innermost machine. If the `ssh` hops authenticate by **password**, the intermediate machines need **`sshpass`** (keys need nothing) — same requirement as Bulk/Monitor over login scripts.

---

### Tunnels that start themselves, and the system tray

Click the ⚡ next to the ★ pin on a tunnel row (or tick ⚡ **Start automatically when the app opens** in its editor) and it comes up right after the vault unlocks — including the remembered auto-unlock, so on a machine with *Remember on this machine* the tunnel is simply there when the app is. A lit ⚡ means it is on; click again to turn it off. The flag is honoured once per app run: locking and unlocking the vault again does not restart a tunnel you stopped on purpose.

**Closing the window no longer quits the app.** ✕ hides the window into the **system tray**; tunnels, Monitoring and the uptime watcher keep running, and your tabs are untouched when you come back. The tray icon's tooltip says how many tunnels are up. **Left-click** the icon to reopen the window; **right-click** for a menu that lists every tunnel with a checkbox — tick to start, untick to stop, no need to open the app — and **Quit** to exit for real. The first time the window is hidden a notification tells you so. If a hidden window needs your answer (a new host key, a password), it reappears by itself instead of the question timing out. To make ✕ quit as before: Settings → **Application** → turn *Closing the window keeps the app in the system tray* off.

**Test**: click ⚡ on a tunnel row → it lights up; quit the app (tray → Quit) and start it again → after the vault unlocks the tunnel is running. Close the window with ✕ → a notification appears, the tray icon stays, your DB client still connects through the tunnel; right-click the icon → the tunnel is ticked, untick it → it stops; left-click → the window is back with the same tabs. Settings → Application → turn the option off → ✕ quits.

## 9B. Remote Desktop — VNC & RDP (new)

Connect to a **graphical desktop**, tunneling through your SSH jump hosts when needed.

**Add the host**: + host → **Protocol = VNC** (default port 5900) or **RDP** (default port 3389) → hostname/IP of the target. Optionally add **Jump hosts** (the same picker as SSH) so the app SSHes through a gate and bridges to the target's VNC/RDP port. RDP also has an optional **username** field (pre-filled into the connection).

**Open it**: click the host row, or the **🖥️** button that appears on hover.

- **VNC** opens **inside a tab** — the remote screen renders via noVNC. Enter the VNC password when prompted; the view scales to the tab; if the connection drops there's a **Reconnect** button. Behind the scenes the app opens a local WebSocket↔TCP bridge on `127.0.0.1` (one-time token) that forwards through the jump chain to port 5900 — nothing is exposed on your LAN.
- **RDP** does **not** embed a window — the app forwards the target's `3389` to a local port and launches your OS RDP client (**Windows**: `mstsc.exe`; macOS/Linux: it opens the tunnel and tells you the `127.0.0.1:<port>` to point your client at). A small **🖥 RDP open** dock (bottom-left) lists active tunnels with a **Stop** button; closing the RDP window also tears the tunnel down.

**Requirements**: a real **VNC server** must be running on the target (e.g. x11vnc/TigerVNC on Linux, TightVNC/UltraVNC on Windows), or **Remote Desktop enabled** for RDP. The target must be **reachable** — same LAN, or through the jump chain. Note: Chrome Remote Desktop / TeamViewer are **not** VNC/RDP servers and cannot be used here.

**Limitation**: tunneling supports **jump-host chains** (SSH `-J` style). A target reachable only via an interactive **login-script gate** is not yet supported.

---

## 10. Bulk Execution (run a command across hosts) — `⋯` → Bulk Execution

**What it is**: run one command across N hosts **in parallel** (up to 8 at once), grouping output to spot divergent machines.

**Use**: tick hosts → type a command (`uptime`, `df -h /`…) → **⚡ Run**. Results show in a grid; enable "Group by output" to cluster machines returning the same result, with outliers flagged yellow **"(differs?)"**. While running there's a **Cancel** button (closes connections, stops queued hosts); closing the modal mid-run also cancels.

**Runs through login scripts**: for a host reached via `ssh deploy@web-01`, the command runs **on web-01 itself** (the app does `ssh deploy@web-01 '<cmd>'`), not the gate.

**Test**: tick all 3 hosts → type `hostname; uptime` → each machine returns **its own** hostname (web-01/02 differ from the gate).

> Since v0.1.8 this matches SFTP: `su` / `sudo` steps and password-protected `ssh` hops are traversed too (password hops need `sshpass` installed on the gate).

---

## 11. Monitoring Dashboard — `⋯` → Monitoring

**What it is**: real-time host health, **no agent required** (one SSH command reading `/proc` + `df` every 3s). Linux only. Designed to answer not just *"is it slow?"* but ***"why is it slow?"***.

**Use**: pick hosts → **Start monitoring** → the picker closes and a compact dashboard **docks to the top-right corner** — one card per host. The dock is translucent (hover to focus) and doesn't block anything: keep working in the terminal, open other modals, switch tabs — monitoring continues until you press **Stop** on the dock. Press **–** to minimize it to a `📊` pill at the bottom-right (polling continues; the pill's dot shows the worst host state). Re-opening `⋯ → Monitoring` pre-ticks the hosts being watched; **Start** replaces the watched set.

**Quick select by workspace or group**: in the picker, above the host list, **Quick select** chips let you tick a whole **group** or a saved 🗂 **workspace** (all of its SSH hosts) in one click instead of ticking hosts one by one — click a chip again to untick that set. A chip highlights when its whole set is currently selected.

**Resize the dock**: drag the **◢** grip in the dock's bottom-right corner to make it wider/taller (drag the header to move it).

**Pop it out into its own window (📌 always-on-top)**: press **⧉** in the dock header to detach the monitor into a **separate, always-on-top window** that stays visible **even when you minimize or hide the main app** — handy on a second monitor or while you work in another program. It shows the same live metrics (no extra SSH connections), and the in-app dock hides while it's open so there's only one monitor on screen. Drag its header to move it, drag edges to resize; **⧉ Merge back** brings the in-app dock back and **■ Stop** ends monitoring. Closing the main app (not minimizing) also closes the pop-out.

**Reading a card** (top to bottom):
- **Load** — classic load average (1/5/15 min) with a bar normalized per CPU (uncapped: 300-400% is real on busy servers).
- **CPU** — *real* CPU busy % (computed from `/proc/stat` deltas between polls; appears from the 2nd poll).
- **RAM / Disk** — RAM via MemAvailable; Disk shows the **fullest real mount** (e.g. `Disk /var`), not just `/`.
- **Diagnostic line** `us · sy · wa · st`: `us` = application code, `sy` = kernel, `wa` = **waiting on disk** (≥20% turns yellow — I/O bottleneck, more CPU won't help), `st` = **CPU stolen by the hypervisor** (≥10% turns red — your VPS is oversold; complain to the provider, no server config fixes this). Plus `r N` (processes queued for CPU, shown when > core count) and `swap` (shown when in use).
- **Bottom line**: network `↓/↑` rate, **TCP connection count** (the most direct "we're being scraped" signal), `inode %` (shown at ≥70% — full inodes with free space is a classic silent killer), and the top-CPU process name.
- **Service uptime** `⟳ httpd 30d · java 12h`: how long well-known services (httpd/apache2/nginx/java/node/php-fpm/mysqld/mariadbd/postgres/redis) have been running — *alongside* the server uptime top-right, not replacing it: server uptime = last reboot (kernel patches!), service uptime = last Tomcat/Apache restart. Hosts running none of these simply omit the line.
- **Don't know what a number means? Hover it.** Every value on a card — the bars, `us/sy/wa/st/r/swap`, net rate, conn, inode, top process, service uptime — has a plain-language tooltip explaining what it is and when to worry.

**Alert thresholds** (in the Monitoring modal, under the host picker): Load %/CPU (uncapped — set to *your* baseline, e.g. 500), RAM %, Disk %, **Steal %** (default 20), **Conn** (absolute count, default off), and an offline alarm. Global defaults + per-host overrides (empty field = inherit). Alerts need a **sustained ~9s breach** (3 polls) and won't flap around the threshold; while still breached they repeat every 15 min; recovery is announced once. Delivery: in-app toast + **Windows notification** + optional **webhook** — paste one URL (Google Chat / Slack / Discord / Telegram auto-detected, anything else gets generic JSON) and press **Send test**. Alerts keep working while the vault is auto-locked.

**Metrics history**: samples are downsampled into a local `metrics.db` (minute buckets kept 48 h, 10-minute buckets 30 days, auto-pruned — a few MB/month). Press **📈** on a card to expand **1-hour Load / CPU / connection charts right inside the dock** (refreshing every minute; press again to collapse); the *⤢ Details & 24h* link opens the full history window with all six metrics over **1 h / 24 h**; offline periods show as gaps. History survives restarts; recording only happens while monitoring runs. The **🏠 Home dashboard** also has a **📈 Monitoring history** section listing every server ever monitored (newest first, 24-hour Load chart each) — click a card there to open its full history, even when monitoring isn't currently running.

**Runs through login scripts**: like Bulk — web-01/02 measure the inner machine, not the gate.

**Troubleshooting**: if a card says metrics can't be parsed, the message includes the remote error (e.g. `Permission denied`, `sshpass: command not found`) — that tells you which hop failed. CPU/net/steal need a second poll (~6s) before they appear.

**Test**: pick web-01 + web-02 → Start → see each machine's own numbers; set RAM threshold to 5 → red toast + Windows notification within ~9s; press 📈 after a few minutes for charts.

---

## 11B. Uptime watcher · Processes · Services

> **Processes** and **Services** both have **⊞ Open in tab** in their header (and a palette entry) — the table gets the full window and stops blocking the app while auto-refresh runs.

**📡 Uptime watcher** (`⋯` → *Uptime watcher*): toggle it on and the app **TCP-checks every saved host once a minute without opening any session** — a green/red dot next to each host in the sidebar shows reachability (hover for latency). State is remembered across restarts; toggle again to turn off. Best-effort: a host behind a login-script gate is checked at its **gate address**, which still tells you "the gate is alive".

**⚙ Processes** (`⋯` → *Processes*, or the command palette): pick a host → a live `top`-style table (PID, user, CPU%, MEM%, RSS, runtime, command) fetched over a **dedicated exec channel** — your open terminals are never touched, and login-script hosts work like Bulk. Sort by **CPU/RAM**, filter by command/user/PID, tick **auto-refresh 5s**, and hover a row to **kill** (✕ = TERM; `-9` = force KILL) with a confirmation. Killing another user's process requires matching privileges on the server. Linux only.

**🧰 Services** (`⋯` → *Services*): pick a host → every systemd service with its state (green = running, red = failed). Hover a row for **▶ start / ⏹ stop / ↻ restart** (each confirms first — these usually need root; without it systemctl's own error is shown verbatim) and **📜 logs** which opens the unit's last 120 `journalctl` lines right in the window. Servers without systemd aren't supported.

**Group colors** (bonus for busy fleets): edit a group → **Accent color** → pick a swatch (production red, staging yellow…). Every host in the group gets a color stripe on its **sidebar row**, its **tab** and its **split-pane header** — so you always know which terminal is production before you type.

---

## 11D. URL checks — *All features* → 🌐 URL checks

**What it is**: synthetic HTTP monitoring from your machine. The uptime watcher (11B) only knows whether a TCP port opens; a web fleet behind a load balancer fails with a 502, a blank page or an expiring certificate while the port stays open. A URL check asks the real questions on a schedule, **even while the vault is locked** (URLs are not secrets; the configuration lives in `http-checks.json` next to the vault, results in `checks.db`).

- **+ New URL**: the URL (http or https), an optional name, GET or HEAD, the **accepted status** set (`200-399` default; `200`, `2xx`, `200,301` also work — redirects are not followed, so a 301 is a status of its own), an optional **keyword** the page must contain (GET only, first 64 KB), interval (30 s – 24 h), timeout, **consecutive failures before alerting** (default 2, so one blip is not an alert), and an optional linked host so the alert lands on that host's charts.
- **Pin IP**: connect to this IP while Host and SNI still follow the URL — the same trick as *Point a domain at a server* (16D). One check per backend behind the load balancer tells you *which* machine is failing while the LB still answers 200 from the others, and the HTTPS certificate is still verified against the real name.
- **TLS**: a certificate with **under 14 days** left counts as a failure even if the page loads; the reason says how many days are left (or how long ago it expired).
- **Alerts** go to a toast, an OS notification and the Monitoring webhook (same settings as 11), are recorded in **Notifications** (11E), and appear on the Dashboard's *Needs attention* strip while the check is alerting. The first successful probe afterwards records a recovery.
- Each row shows the last result (time, status, latency, error), 24h uptime %, average latency, certificate days left; click a row for the **24h latency chart** (red dots at the bottom are failures). *Check now* probes immediately; results are kept 30 days.

**Test**: add `https://example.com/` → within a few seconds the row turns green with a latency; edit the accepted status to `500` → after two probes the row turns red, a toast and a Notifications entry appear and the Dashboard strip lists *URL failing: example.com*; set it back → a recovery is recorded. Add a second check for the same URL with **Pin IP** set to one backend's address → the certificate still verifies and the row shows `→ <ip>`.

## 11E. Notifications & event markers — 🔔 in the status bar

**What it is**: one place where every alert the app raises is **kept**, instead of only flashing as a toast that is gone by the morning. Sources: Monitoring thresholds, replication lag/thread alerts, the uptime watcher going down or coming back, a tunnel falling into error (and recovering), URL checks. The bell in the status bar shows the **unread** count in orange.

- **The list** is grouped by day (*Today*, *Yesterday*, dates), newest first, with a coloured dot (red critical, orange warning, green recovery, blue marker), the source icon, the host, the detail and the time. Filter by source, tick *Unread only*, ✓ acknowledges one entry, **Mark all read** clears the count, ✕ deletes. Also available as a tab (⊞) or from the palette. Alerts are kept 30 days.
- **Event markers**: the row at the top adds a 📌 marker — "Deploy v2.3", "Restarted nginx" — for the **whole fleet** or a chosen host. Markers appear as **dashed vertical lines on every metrics chart** (a host's 📈 history and the inline chart on its Monitoring card), together with that host's own alerts (red/orange) and recoveries (green), so a CPU or RAM spike can be matched to what happened just before it. Hover a line to read it. You can also add a marker straight from a host's history window (*＋ Mark now*) and see the events of the range listed under the charts; markers are kept 180 days.

**Test**: stop a host the watcher is checking → the bell shows 1 and the entry reads *not responding* with the address in the detail; start it again → a green recovery entry; ✓ the alert → the count drops. Add a marker "test deploy" for a monitored host → open its 📈 history → a blue dashed line at the current time on every chart, and the marker in the *Events in range* list; ✕ removes it.

## 11C. MySQL/MariaDB replication — `⋯` → 🔁 Replication master/slave

Answers the 2 a.m. question: **is the slave behind, by how much, why, and what do I type now?** Also has **⊞ Open in tab**.

### Setting up a pair

A **cluster** is one master and however many slaves it feeds. **+ Add pair** → name it, point at the master, then add a row per slave.

For each end — the master and every slave — answer the same question: *where is that MySQL*. The dropdown offers two kinds of answer:

- **An SSH host** — MySQL runs on that machine. The app bridges to `127.0.0.1:<port>` through the host's existing jump chain, or runs `mysql` there over SSH.
- **A saved tunnel** — MySQL is **not** on the SSH host but on another machine inside the network (`10.20.30.40:3306`), reachable only through a tunnel. Pick the tunnel and the app starts it if needed, then connects to its local end.

Slaves can mix the two freely — one behind a tunnel, another straight on its host.

**Credentials.** The cluster has one **default** MySQL user and password, used by every endpoint that doesn't declare its own. Where a machine uses a different account — the master on one, each slave on another — click **⚙** on that row and give it its own. Whatever you leave blank there still falls back to the cluster, so you can override just the user, or just the password. The ⚙ lights up on any endpoint that has its own credentials, so you can see at a glance which ones differ.

The master end is optional — leave it as *None* if you only have access to the slaves; you still get lag and thread state per slave, you just lose the binlog position comparison against the master.

> **Why a cluster rather than one pair per slave.** The master is read **once** per cycle and that single snapshot is compared against every slave. That's lighter on the master than one connection per slave, and it's what makes the numbers comparable: all slaves are measured against the *same* binlog position, so "slave-02 is 40 MB further behind than slave-01" actually means something. Each slave still keeps its own connection, its own diagnosis and its own alert state — one broken slave neither blocks the poll nor mutes the others.

> **Why tunnel mode exists and when you need it.** Bridging straight from a host uses SSH `direct-tcpip`, which always originates at the **gate**. When the target is a private address like `10.20.30.40`, that range often exists on *both* networks, so the gate can open a connection to the wrong machine — or a firewall silently drops the SYN and the channel just hangs, because sshd only confirms it *after* `connect()` returns. Your tunnels already solve this (they go through `nc` on the innermost machine first). Tunnel mode reuses that exact route instead of re-deriving it, so it cannot regress differently from your working tunnels. If the dropdown shows no tunnels, create one under `⋯` → **Tunnels** first.

Leave *MySQL user* and *password* empty — both at cluster level and per endpoint — and the app uses whatever is already on the server: `~/.my.cnf`, or unix_socket auth for your SSH user. That's the simplest and safest setup and the app never handles a database password. Any password you do supply is encrypted in the vault; in CLI mode it reaches the server only through a temporary 0600 `.cnf` file, **never on a command line** where `ps` would expose it to every user on the box.

**Tunnel mode is the exception:** the connection starts on *your* machine, so the server's own credentials cannot apply — that endpoint needs a MySQL user and password (its own, or inherited from the cluster), and only the driver path works (there is no CLI path when you're at the local end of a tunnel). The form checks this per endpoint and says which one is short.

**How it reads status.** *Automatic* tries a direct MySQL connection first — tunnelled through the host's existing SSH jump chain, so a database behind a bastion works with no extra setup — and falls back to running `mysql` over SSH if port 3306 is closed. **Test connection** tells you which route actually worked, naming the tunnel's local address when it went that way.

> The monitoring user needs **`REPLICATION CLIENT`** (MariaDB / MySQL 5.7) or `REPLICATION CLIENT` + `REPLICATION_SLAVE_ADMIN` (MySQL 8). A SELECT-only user cannot read `SHOW SLAVE STATUS`. MySQL 8.4 removed that statement entirely — the app detects the version and uses `SHOW REPLICA STATUS` there.

### Reading the status panel

The master's position sits in a strip at the top — read once for the whole cluster — and below it one card per slave. Each card shows thread state, lag and both binlog gaps at a glance; click it to expand that slave's own diagnoses and runbook. A slave that hasn't reported yet says so instead of pretending to be healthy.

`Seconds_Behind_Master` **lies**, in both directions, so the panel never shows it alone:

- It reports **0 while the IO thread is dead** — the slave has applied everything it managed to fetch, which is nothing.
- It reports **hours on a deliberately delayed replica** (`MASTER_DELAY`), where that is exactly the point.

So alongside lag you get the **binlog byte gap in both directions** — *Not fetched* (how far the IO thread trails the master) and *Not applied* (how far the SQL thread trails what's already on disk). Those two split the problem immediately: a large *Not fetched* is a network or master-throughput problem; a large *Not applied* is the slave's own write speed, and the binlog is already sitting on its disk. When the two sides are on different binlog files the app says **"3 binlog files behind"** instead of inventing a byte count it cannot know. Any configured `MASTER_DELAY` is subtracted before anything is called late.

### What this costs your servers

Everything in a poll cycle is an **in-memory metadata read** — no table scans, no disk, nothing that grows with your data:

| Where | Statement | How often |
|---|---|---|
| Master | `SHOW MASTER STATUS` | once per cycle, shared by every slave |
| Each slave | `SHOW SLAVE STATUS` | once per cycle |
| Both | `SELECT @@global.read_only, @@global.super_read_only` | once per cycle |
| Both | `SHOW GLOBAL VARIABLES` (the config set) | on connect, then every **5 minutes** |
| Both | `SELECT VERSION()` | **once per session** |

A cluster of one master and three slaves is 8 statements per cycle — about 32 a minute at the 15-second default. That is far below the noise floor of a production MySQL, and 15s is the same ballpark other monitoring tools use.

The config variables (`server_id`, `log_bin`, `binlog_format`, binlog retention…) are read on a 5-minute cycle rather than every poll: `SHOW GLOBAL VARIABLES` materialises the whole ~500-variable list before filtering, while those values change perhaps once a month. `read_only` is deliberately *not* in that group — it's read every cycle with a cheap direct lookup, because a slave that starts accepting writes is a split-brain risk you want to hear about in seconds, not minutes.

Two things worth knowing:

- **Connections stay open** — one per endpoint, so 1 + N per watched cluster. Each idle MySQL connection costs a slot against `max_connections` and a little memory; if a server already runs close to its connection limit, count these in.
- **CLI mode is materially heavier than the driver.** Every cycle opens an SSH exec channel and spawns a `mysql` process on the server — nested `ssh` + `su` for login-script hosts. The badge on a slave card turns amber when it's on that path, with the reason in its tooltip. If the MySQL port is reachable or a tunnel exists, prefer the driver.

The genuinely expensive operations — `COUNT(*)` and `CHECKSUM TABLE` — are never part of the cycle. They only run when you ask, and are capped at 50 tables per run.

### The runbook

Every problem found is listed worst-first, and each one expands into **checks (read-only, run these first)** and **fixes** — with your real values already substituted:

- **Error 1236** — the app names the binlog file the slave still needs, says plainly that `START SLAVE` will not help because the data is gone, and lays out the full re-seed (`mysqldump --master-data=2` → read the position → `CHANGE MASTER TO`), plus how to stop it happening again (binlog retention).
- **Error 1062 / 1032** — the table name is pulled out of the error message and the `SELECT` for **both** sides is built for you, because whether skipping the event is harmless depends entirely on whether the two rows are identical. Only then is `sql_slave_skip_counter` offered — marked destructive, spelling out that you are accepting a permanent difference.
- **Corrupt relay log (1594)** — a `CHANGE MASTER TO` with your actual `Exec_Master_Log_Pos` already filled in, and the reassurance that nothing is lost (relay logs are re-fetchable).
- **Lag with both threads running** — the query that finds tables **without a PRIMARY KEY**, which is the single most common cause with row-based binlog, plus the right parallel-apply settings for your flavour (MariaDB's `slave_parallel_threads` vs MySQL 8's `replica_parallel_workers`).

**The app never runs any of these.** Buttons copy to your clipboard; anything destructive asks for confirmation before it even does that.

### Background alerts

Tick **Watch in background** per cluster. **⚙** sets the thresholds (shared by every watched cluster): lag in seconds, not-applied bytes, and on/off switches for *threads stopped*, *error code*, *slave accepts writes*, *cannot read status*. An alert fires after **2 consecutive polls** past the threshold and repeats every 15 minutes while it lasts, with a dead-band so a value hovering at the line doesn't flap. Delivery is toast + OS notification + webhook (Slack / Google Chat / Discord / Telegram — same field as monitoring).

Thresholds are set per cluster but the **state machine is per slave**, so each one breaches and recovers on its own. Alerts are labelled `<cluster> · <slave>`, and the webhook payload carries `replicaId` / `replica` as separate fields so downstream automation doesn't have to parse the label.

Thresholds live **outside the vault**, and connections stay open once watching starts, so alerts keep firing after the vault auto-locks at 15 minutes. The lag threshold also drives the diagnosis panel, so the panel and the notifications never contradict each other.

### Data drift (the *Data drift* tab)

Replication can report `Yes / Yes / 0s` while the data has quietly diverged — someone wrote directly to the slave, an old skipped event left a hole, or `binlog_format=STATEMENT` made `NOW()`/`RAND()` produce different values on each side. Two deliberate steps:

Data drift runs against **one slave at a time** — pick which one at the top when the cluster has several.

1. **Quick scan** — reads `information_schema` on both sides: missing tables, engine/collation differences, column and index differences, and the configuration variables that matter (`server_id`, `read_only`, `binlog_format`, `log_bin`, binlog retention, version). Variables that are *supposed* to differ (`server_id` must, `read_only` should) are marked **expected** so they don't look like faults. Takes seconds.
2. **Tick the suspicious tables → Exact count / CHECKSUM tables** — `COUNT(*)` compares row counts exactly; `CHECKSUM TABLE` compares the contents too, which is the only thing that catches "right number of rows, wrong values". Both scan the full table **on both servers**, so this is a deliberate action, capped at 50 tables per run.

> Row counts in the quick scan are InnoDB **estimates** — several percent off is normal. Use them to narrow down, never to conclude. If the pair has replication filters, out-of-scope tables are dimmed: a difference there is intentional.

### Drift history (the *History* tab)

Every quick scan, exact count and CHECKSUM run is **saved automatically** — you don't press anything. Repairing drifted data takes days (find the tables today, patch rows tomorrow, re-check the day after), and without a record the next scan wipes the previous result off the screen, which is exactly what you need to answer *"is there less drift than last time, and which tables are still wrong?"*.

Each row shows the date and time, which run it was (quick scan / count / CHECKSUM), `master → slave`, and the totals — *3 tables · 1 column · 2 variables*, or *2/5 tables differ* for an exact run. Open a row to get the full list of differences exactly as it looked when it ran, laid out the same way as the Data drift tab so two runs can be read side by side. Tick **All clusters** to see every cluster's history in one list.

The cluster, slave and master names are **copied into the record** when it runs, so renaming or deleting a cluster later doesn't make old records lie — and **deleting a cluster does not delete its history**, since that history is what you use to verify the repair. Clean up with the **✕** on a row, or **Delete all** (which respects the *All clusters* tick: it clears either the selected cluster or everything). The most recent **200** records are kept; older ones drop off on their own. Details are encrypted in the vault with everything else — database and table names of a production server aren't public information — so the summary is readable while the vault is locked, but opening a record's details needs it unlocked.

**Not covered yet:** GTID gap comparison (position-based only), PostgreSQL streaming replication, and semi-sync specifics.

---

## 12. Network Toolbox — `⋯` → Network Toolbox

Purely local, no SSH. Enter a host/IP then:
- **Ping** (latency), **DNS lookup** (A/AAAA/PTR), **Common-port scan** (16 ports: SSH/HTTP/MySQL/RDP/Redis…).
- **Test**: ping `1.1.1.1`; scan `gate.example.com` to see whether port 22 is open.

---

## 13. E2EE Sync (multi-machine) — `⋯` → Sync

**What it is**: encrypt the whole vault into a single blob and push it to a **shared folder you already use** (Google Drive / Dropbox / OneDrive / Syncthing / network share). The backend **only ever sees an encrypted blob** (zero-knowledge). Termius forces you onto their cloud — this is self-hosted.

Sync runs over **channels** — folder, Google Drive, **WebDAV** and **S3** — and you can enable any mix: each has its own passphrase, salt and status card, and turning one off never touches the other. Typical split: a shared folder for the LAN, a cloud channel as the off-site copy. Every sync round pulls, merges and pushes each enabled channel in turn, so machines converge no matter which channel each one uses.

**Channel *Folder*:**
1. Pick a sync folder → set a **sync passphrase** (≥8 chars, **the same on every machine**, can differ from the master password) → enable sync.
2. On another machine: same folder + same passphrase → data converges (Last-Write-Wins merge + tombstones for deletes).

**Channel *Google Drive*** — no desktop sync client needed; the app talks to the Drive API directly:
1. Pick **Google Drive** → **Sign in with Google…** — the system browser opens, you approve, come back. The app asks for the `drive.file` permission, which only reaches **files this app created**: it cannot see or list anything else in your Drive.
2. Set the sync passphrase (**≥12 chars** for this backend — the blob lives on a cloud drive) → enable.
3. On a new machine: install the app, set a master password, **sign in to the same Google account + enter the same passphrase** — that's the whole setup.

> **Signing in to Google never replaces the passphrase.** The blob is encrypted end-to-end *before* upload; Google cannot read it, and someone who takes over your Google account gets one unreadable file — not your servers. That is why the passphrase prompt stays.

The blob is a normal file in My Drive (`infra-companion-vault.blob`), so the borrowed-machine trick below still works: download it from drive.google.com and *Import from file*. **Disconnect** revokes the app's access token; you can also revoke it any time from your Google account's *Security → Third-party access* page. If the connection dies (token revoked or expired), the Sync screen says so and offers the sign-in button right there.

**Channel *WebDAV*** — Nextcloud, Seafile, Synology, plain Nginx `dav_module`: give it the **folder URL** (for Nextcloud that's `…/remote.php/dav/files/<user>/<folder>`), a username and a password (an *app password* is the right thing to paste for Nextcloud). The password is stored encrypted in the vault, only after the connection has actually worked.

**Channel *S3*** — anything that speaks S3: AWS itself, MinIO on your LAN, Cloudflare R2, Backblaze B2. Endpoint + region + bucket (+ optional key prefix) + an access key that has **`GetObject` + `PutObject` + `ListBucket` on that one bucket** — `ListBucket` is not optional: without it S3 answers "403" even for *file doesn't exist*, and the app can no longer tell an empty bucket from a broken one. No AWS SDK is involved; the app signs requests itself (SigV4), which is also why any S3-compatible endpoint works.

> Remote channels (Google Drive / WebDAV / S3) require a passphrase of **at least 12 characters** — that blob lives off-machine, and the passphrase is the only thing protecting it.

**Auto-sync**: once sync is on, a dropdown sets how often it runs on its own — **off / 5 / 15 / 30 / 60 minutes**, default 15 — plus one last push when you quit the app, so a change made just before closing doesn't sit on one machine until another overwrites it. It only runs while the vault is unlocked, and it never resets the auto-lock timer, so leaving it on doesn't keep the vault open. Setting it to *off* also turns off the quit push — off means you're driving. When a round pulls something in, a toast says so and the lists reload — otherwise the window would sit on stale data.

**Transfer by file** (*Transfer by file* inside the Sync dialog): **Export to file…** writes the same encrypted blob wherever you choose, and **Import from file…** reads one back and merges it. No sync client, no shared folder — the case this is for is *"I'm on someone else's machine, I only have a browser"*: download the blob from Drive's web UI, import it, work. Import is **one-way** — it pulls data in, it does not push anything back; to send changes the other way, export and upload the file yourself.

**Quick single-machine test**: point at `D:\sync-test` → enable sync → open the `infra-companion-vault.blob` file there: it's all encrypted bytes, no readable host/password = zero-knowledge confirmed.

> ⚠️ Forgetting the sync passphrase = the data in that folder is lost (unrecoverable).

> ⚠️ **The passphrase is the only thing protecting the blob, and the blob holds your private keys and host passwords in the clear once opened.** Storage that other people can reach (a cloud drive, a shared folder, a file you emailed yourself) makes that passphrase the whole of your security — make it long and unique. On a machine that isn't yours, when you're done: **Disable sync (this machine)**, delete the file you downloaded, and remove the app's data folder.

**When the app refuses to sync**: if it can't find `infra-companion-vault.blob` but something says the file *should* be there — the folder holds a near-miss name like `infra-companion-vault (1).blob` (a browser renaming a duplicate download), or this machine has synced with that folder successfully before — it stops and says so instead of writing. That write would replace every other machine's data with this one's. Fix the cause (rename the file, wait for the cloud client to finish downloading) and sync again; the ⚠ **Overwrite with this machine anyway** button is there for when you genuinely mean it.

---

## 14. AI Assistant — `Ctrl+I` or `⋯` → AI Assistant

**What it is**: generate commands from natural language, explain commands/errors. **4 providers**: Claude / OpenAI / Gemini / **Ollama (local — 100% private)**.

**It is a docked column, not a window that blocks the app.** It sits on the right of the work area — the way an editor docks its assistant — and the column **takes real space, so the terminal narrows to make room rather than being covered**. That matters: half of asking about a server is reading its output. So the real loop works — ask, run the command, paste the error back, ask again — with the terminal still taking keystrokes the whole time. **Drag its left edge** to resize (280–720 px, remembered across restarts); `Ctrl+I` toggles it, **✕** closes it; available in all three layout themes. Inserting a command does **not** close it, and opening Snippets or Settings while a question is half-typed does not throw it away. `Esc` belongs to the terminal here, not to the column. **⛶ on the header opens the same assistant as a tab** — use it when the answer is long (a multi-line script, a table); the question you were typing comes along, and inserting a command from the tab switches you to the terminal that received it.

**The question box is pinned to the bottom**, the way a chat window works: answers flow above it, so a long one never pushes the place you type out of sight. New content scrolls into view by itself **only while you are already at the bottom** — if you have scrolled up to reread something, nothing yanks the view away from you.

**It shares its column with the AI troubleshooter** (§14C). Opening both does not open a second column — a tab strip appears (**✨ Assistant** · **🩺 Diagnose**) and they take turns in the same space, because two 400 px columns would leave the terminal a sliver, which is exactly what both of them exist to let you watch. The one you are not looking at **stays alive**: a half-typed question and a diagnosis waiting for your approval are both still there when you switch back. With only one of them open there is no tab strip at all.

**Configure** (⚙): pick a provider → model → API key (encrypted in the vault; Ollama needs no key).
| Provider | Default model | Notes |
|----------|---------------|-------|
| Claude | `claude-opus-4-8` | key `sk-ant-…` |
| OpenAI | `gpt-4o-mini` | key `sk-…` |
| Gemini | `gemini-2.0-flash` | key `AIza…` |
| Ollama | `llama3.1` | local, needs `ollama serve` |

**3 modes**:
1. **Generate command** — type in plain language ("find the 5 biggest files in /var/log") → the AI returns a command + explanation → the **↵ Insert into terminal** button (writes to the open pane, **does NOT auto-run** — you review then press Enter). The line above that button names **which machine** it will go into, since the panel stays open while you switch tabs.
2. **Explain command** — paste a command → a part-by-part explanation + risks.
3. **Explain error** — paste output/an error → diagnosis + how to fix.

**Explain selection (no copy-paste needed)**: select any output directly in the terminal → a floating **✨ Explain** button appears (or press **Ctrl+Shift+E**) → the answer opens in a translucent dock panel on the right (minimizable to a ✨ pill; close with ✕; Esc stays with the terminal). The panel is **movable and resizable**: drag its header to put it anywhere, drag the bottom-right corner to enlarge it for long answers — position is remembered for the session. Selections longer than ~6 000 chars keep the tail — errors live at the end. If AI isn't configured yet, the settings form opens automatically.

**Test**: configure Gemini → Generate command "kill the process on port 8080" → open a terminal tab → Insert into terminal. Then `cat` a config file, select a chunk → Ctrl+Shift+E.

---

## 14C. AI troubleshooter (step-by-step diagnosis) — palette → 🩺

**What it is**: an **agent mode** for diagnosing a sick server. You describe a symptom; the AI proposes **one read-only diagnostic command at a time** (with a one-line rationale); **you approve each step**; the command runs and the AI reads the output before proposing the next — until it reaches a conclusion and suggested fix.

**Use**: open it from the **⋯ tools menu** (sidebar) → **🩺 AI troubleshooter**, or `Ctrl+Shift+P` → 🩺 → pick an SSH host → type the symptom ("web returns 502", "load is high") → **Start**. For each step: **Approve & run** / **Skip** / **Stop**. The conclusion appears at the end; **New diagnosis** resets.

**It is a docked column** (right of the work area, like the AI assistant), not a window that blocks the app. That matters more here than anywhere else: a diagnosis runs **many steps and waits for you at each one**, so a blocking window would mean that for the whole session you cannot look at anything — including the terminal of the very machine being diagnosed. Drag the left edge to resize. It **shares that column with the AI assistant** — open both and a tab strip picks between them (see §14).

**The pending command and its Approve & run / Skip buttons sit at the bottom of the column**, not at the end of the step list. In a long session each finished step used to push the button further down, so every approval began with a scroll. The command is repeated next to the buttons on purpose: it is about to run on a real machine, so it should be readable exactly where you click. The step above it says it is waiting for approval below.

**⛶ Open in tab** (header, or the palette) moves the whole thing into a tab — useful when step output gets long.

**Closing it does not end the session.** ✕ just puts the column away; the run continues and a small **pill** (bottom-right) keeps reporting live status — analyzing / running / **needs your approval** / done — so a step waiting on you is never silent. Click the pill to bring the column back. To actually stop a run, use **Stop** inside the session.

**History**: when a session finishes, stops, or errors it is saved automatically under **Diagnosis history** on the start screen (symptom, the steps that ran with their output, and the conclusion). Click a past session to review it **read-only**, or use 🗑 to delete it. The last 50 are kept, **encrypted with your vault key** (so the vault must be unlocked to read them back).

**Safety** (this is the important part):
- The commands run over a **separate SSH exec channel** — your open terminal is never touched, and each command's output is captured cleanly (works through jump hosts and login scripts).
- It is **read-only**. The AI is instructed to only gather information, and — regardless of what it proposes — a **guard in the main process blocks anything that writes/restarts/deletes** (`rm`, `systemctl restart`, `kill`, `>`/`>>`, package installs, `sed -i`…). A blocked command is shown in red and skipped; the real safety gate is **your per-step approval**.
- To actually *fix* something, run the suggested command yourself in a normal terminal.

Needs AI configured (see §14). If not, the settings form opens.

---

## 14B. Secrets Manager (fetch passwords from 1Password/Bitwarden/Vault)

**What it is**: don't store passwords in the app — store only a **reference**, and the app calls the secret manager's CLI to fetch the password **right at connect time**.

**Use**: Edit host → Auth = **Secret manager** → enter a reference:
| Syntax | Secret manager | CLI called |
|--------|----------------|-----------|
| `op://Vault/web-01/password` | 1Password | `op read "op://…"` |
| `bw://<item-id-or-name>` | Bitwarden | `bw get password <item>` (needs `BW_SESSION`) |
| `vault://secret/web-01#password` | HashiCorp Vault | `vault kv get -field=password secret/web-01` |

**Requires**: the matching CLI (`op`/`bw`/`vault`) **installed + logged in** on your machine and on PATH. Bitwarden needs to be unlocked with `BW_SESSION` in the environment; Vault needs `VAULT_ADDR`/token.

**Test**: install + sign in to `op` → create a host with auth = Secret manager, ref `op://Personal/test/password` → connect → the app fetches the password. If the CLI isn't installed/signed in → a clear error (no hang).

---

## 15. Import from ssh_config — `⋯` → Import

Pick your `~/.ssh/config` → it creates hosts, **preserves multi-hop ProxyJump**, imports IdentityFile (dedupes keys), and warns if needed. The group is named `ssh_config (date)`.

### 15I. Cloud import — *All features* → Cloud import

One dialog imports machines from **DigitalOcean, AWS EC2, Google Cloud and Azure**: pick the provider, add a **read-only** account, **Fetch machine list**, tick what you want, **Create N hosts**. The app only ever calls read endpoints — there is no code path that creates, changes or deletes anything on the cloud side.

What each provider needs (least privilege on purpose):

| Provider | Credentials | Minimum access |
|---|---|---|
| DigitalOcean | API token (control panel → API → Tokens) | Read scope |
| AWS EC2 | IAM access key + secret, region | just `ec2:DescribeInstances` |
| Google Cloud | service-account **JSON key, pasted whole** | *Compute Viewer* role |
| Azure | app registration: tenant + client id + secret + subscription | *Reader* role on the subscription |

Each machine becomes a host at its **public IP**, falling back to the private IP for machines that only live inside a VPC/VNet (those are marked — you'll need a VPN or jump host to actually reach them). Where the host came from — instance id, region/zone, size, tags — is written into its **notes**, so six months later the host still says what it is. Azure keeps IP addresses as separate resources; the app joins VMs, network interfaces and public IPs for you.

- **Re-importing is safe.** A machine whose address already has a host in the vault is shown as *already here* and locked out of selection; the same guard applies within a single run. Add three machines next month, run the import again, get three new hosts — not a second copy of the fleet.
- **The group is reused.** Imported hosts go into a group you pick, or into a per-provider default (*DigitalOcean*, *AWS*, *GCP*, *Azure*) — found again on the next run, not created twice. Leave the SSH user or key empty to inherit them from the group, which is the practical way to set auth once for the whole batch (default users differ: DO/GCP images tend to use `root`, AWS `ec2-user`/`ubuntu`, Azure `azureuser`).
- **Accounts are kept only after they work.** Every account is saved under a name you choose, its credentials **encrypted in the vault** (same treatment as the AI API key), never entering the UI process — and only after a fetch with it has actually succeeded, so mistyped credentials can't become a saved account. *Delete this account* forgets its credentials with it.

### 15J. Import from another SSH client — Hosts `⋯` → *Import from PuTTY / MobaXterm / WinSCP / Termius…*

**What it is**: the first thing you need when moving from another client. **Choose file…** reads a PuTTY `.reg` export (Regedit → export `HKCU\Software\SimonTatham\PuTTY\Sessions`; UTF-16 files are fine), a MobaXterm `.mxtsessions` export, `WinSCP.ini` (Tools → Export/Backup) or a Termius CSV export — any CSV with a hostname column is accepted, headers like `Label`, `Hostname/IP`, `Port`, `Username`, `Groups` are recognised. On Windows, **Read PuTTY from the Registry** skips the export step. A **preview** lists every host found, grouped by the folders of the original client; tick what you want and press **Import**. Nothing is written before that. Folders become groups (reused if a group of that name exists), **duplicates** already in the vault (same address, port and user) are skipped, **passwords are never read** from the other client (they use their own encryption), and keys only show their path (🔑) so you can import them yourself — a `.ppk` must be converted to OpenSSH with PuTTYgen first. Telnet, RDP and VNC sessions keep their protocol; FTP/WebDAV/S3 entries are skipped with a warning.

**Test**: export a couple of PuTTY sessions to a `.reg` file → Choose file → the preview lists them with `user@host:port`; untick one → Import → the ticked hosts appear in a new group named after the source and the date; run the import again → the toast says they were skipped as duplicates.

### 15F. Watch a log — `⋯` → Watch a log

Pick a host and a path, press Start, and the lines arrive here instead of in a terminal tab. Filter by plain text or `/regex/`; **Invert** keeps the lines that *don't* match, which is how you push routine noise out of the way; matches are highlighted in place.

It runs **`tail -F`**, not `-f`. That difference matters at midnight: logrotate renames the file and creates a new one, `-f` keeps following the old inode, and the panel then looks perfectly alive while never showing another line again.

It keeps the last **5000 lines** — this is a window for watching, not an archive (session logging is the archive). Follow-the-bottom switches itself off the instant you scroll up, so reading something older doesn't yank you back down; scroll to the bottom to re-arm it. Closing the panel stops the command on the server.

**Several hosts at once** (new): the machine picker takes **several ticks**. One path, N machines → N `tail -F` sessions whose lines merge in arrival order, each prefixed with the `[machine]` in a colour fixed per host for the session; chips above the log show each session's state (starting / running / closed / error). The filter applies to the **line content**, not the prefix, so `/500/` never matches a machine name. Built for "which app server behind the load balancer is throwing the 500s". Stop closes every session.

### 15G. Scheduled jobs — `⋯` → Scheduled jobs

Pick the machine **and** the scope, then press **Read**. Nothing is fetched until you do — there are two choices to make here, and running after the first one would mean an SSH round trip and an "no crontab" answer every single time before you'd even chosen where to look.

**The scope matters.** Cron lives in three places and looking in the wrong one shows an empty screen on a machine that is running jobs every night:

- **Logged-in user** — `crontab -l` for the account you connect as. System jobs are usually *not* here.
- **`sudo crontab -l`** — root's crontab. You do **not** log in as root; it just puts `sudo` in front the way you would by hand. It uses `sudo -n` because this channel has no terminal: without it, `sudo` would sit waiting for a password nobody can type until it timed out. With it, a machine that requires a sudo password says so immediately instead of pretending there is no crontab.
- **System** — `/etc/crontab` and `/etc/cron.d/*`. Read-only, because the scope spans several files and editing them through one text box is too easy to get wrong.

**The six-field format.** System files put a USER column between the schedule and the command. So do many root crontabs, even though `crontab -l` is nominally five fields. The app **detects it from the content** rather than assuming it from the scope, and shows the result as a checkbox you can flip — one line alone cannot settle it, since `0 5 * * * sh /x.sh` and `0 5 * * * deploy /x.sh` have exactly the same shape. Get it wrong and the command reads as `deploy /usr/local/cron/backup.sh`, which is easy to miss because the schedule next to it still looks right.

Shows the machine's crontab: each job's schedule in words (*every 5 minutes*, *daily at 03:00*) next to its command. Anything too complex to describe honestly — `0 2,14 * * 1-5` — is shown as the raw expression instead, because guessing wrong about when a job runs is worse than not guessing.

You edit the crontab **as text**, not through a per-row form. Real crontabs carry comments and environment variables (`MAILTO`, `PATH`) that do real work, and rebuilding the file from only the parts a form understands is exactly how a colleague's line disappears.

> Saving **replaces the entire crontab** of the logged-in user, so it always confirms first — and says so more loudly when the host belongs to a group you marked PRODUCTION (§1). Success is verified by a marker the command prints, not by an exit code, which the cleanup step would otherwise hide.

### 15H. Rotate SSH keys — `⋯` → Rotate SSH keys

Pick the new key, optionally the old key to retire, tick the machines. For each one, in order: push the new key → **log in using it** → and only then remove the old one.

> The property that makes this safe to run on machines you care about: **if the new key cannot log in, the old key is kept.** On every failure path. The row then reads *not verified — old key kept*, and you still have your way in.

It runs one machine at a time so you can stop as soon as something looks wrong. The old key is removed by reading `authorized_keys`, filtering the line out, and writing the file back — not with a `sed` expression on the server, because that file decides who gets into the machine and a slightly wrong pattern there cuts someone else's access. Permissions are set back to `600` afterwards; leave them wrong and sshd ignores the whole file, which would mean removing the old key *and* breaking the new one.

Still: try it on an unimportant machine first, and keep a session open to it while you do.

### 15D. What is filling the disk — `⋯` → What is filling the disk

Pick a host. The top strip lists every filesystem with how full it is (red past 90%) and how much is left — that is the question you actually have first: *which partition is running out*. Below it, the directory you're in, one row per child, with a bar sized to its share of that level. Click a row to go down, **↑** to go back up, **↻** to rescan.

**The verdict, above the list.** A row of numbers tells you what is big; it doesn't tell you what to do. So the scan is summarised into which filesystem this directory sits on, how full that is, what share of the used space this directory accounts for, and **one sentence on the next move** — with a button that makes it:

| What the numbers say | What you get told |
|---|---|
| One subdirectory holds 60%+ | *Go into `log` — it holds 95.5% here, and everything else together is rounding error.* Plus a button that opens it. |
| Most of the space is in **files sitting directly here** | Going deeper won't find it — `du -d 1` counts directories, so a single enormous `catalina.out` never shows up as a row. You need to look at individual files. |
| Nothing dominates | *The space is spread out* — said plainly, rather than implying there's a culprit to chase. |
| This branch is tiny next to what the filesystem has used | You're digging in the wrong place; here's the way back up. |

> The filesystem is matched by **longest mount point, at a path boundary** — so `/bootstrap` isn't reported as living on `/boot`, and a directory under `/var/lib/docker` is measured against that mount instead of `/`. If `df` gave nothing back, the verdict says only what it actually knows rather than inventing an urgency level.

It walks **one level per step** (`du -d 1`) rather than scanning the whole tree, because scanning `/` on a production box takes minutes and most of the output is never read. It uses `-x`, so it never wanders into another filesystem — without that, `du /` disappears into `/proc`, `/sys` and network mounts and comes back with a number that answers nothing.

> Directories you don't have permission to read are skipped instead of failing the whole scan. When that happens the parent's total is larger than the rows listed beneath it — that gap *is* the unreadable part.

### 15E. What needs patching — `⋯` → What needs patching

Nothing is selected when you open it — tick the machines you want (or press **Select all**) and scan once. It detects `apt` / `dnf` / `yum` / `apk` per host, and scans in small batches rather than opening every connection at once, which through a single gate is a reliable way to get throttled.

The result reads top-down, widest first:

- **The fleet in one line** — how many machines were scanned, how many need patching, how many are already current, and how many couldn't be scanned at all. A machine that failed to scan is counted separately and never as "up to date".
- **The two lines that decide what you do next** — how many machines have **security patches** waiting, and how many will need a **reboot** afterwards. The second one matters more than it looks: a kernel or `glibc` update that isn't followed by a restart leaves the machine running the old build, so it's patched on paper and not in fact.
- **A sentence per machine**, not a list — *Patch soon: 12 security patches waiting*, or *Ordinary updates only*. Machines with security patches sort to the top.
- **Counts by area** — kernel, system core, web/PHP, databases, runtimes, other — so you can see what the batch actually touches without reading names. Kernel and system core are tinted, because those are the ones that decide whether you need a maintenance window.
- **The package names**, all of them, behind a **Show N package names** toggle that starts closed. Security packages are pulled out and listed first, since that's the list you'd copy out.

> **Why "0 security updates" used to be wrong on RHEL.** Debian and Ubuntu put the word in the repository name (`jammy-security`). RHEL, Rocky, Alma and CentOS don't — the repository is just `baseos` or `appstream`, and the security information sits in separate `updateinfo` metadata. The scan asks for that separately now (still cache-only). If it can't be read, you get the package list without the security labels rather than no list at all.

> **Read-only and offline, deliberately.** It never refreshes package metadata — that needs root and writes to the machine, which turns a diagnostic into a change. So the results are exactly as fresh as each machine's own last cache refresh. And there is **no button to install anything**: patching is something you want to be watching, and a "patch the whole fleet" button only has to be misclicked once.

> On RHEL-family machines this needs `dnf -C` explicitly: a plain `dnf check-update` quietly re-downloads repository metadata when the cache has expired, which turns an offline read into a network round trip and can take minutes on a box with several repos.

### 15L. Runbooks — `⋯` → 📖 Runbooks

**What it is**: the steps for jobs you do every few months and re-research every time, kept inside the app. Built-in runbooks cover: whitelist or block an IP (**iptables-services**, **firewalld**, **ufw**, **nftables**, **fail2ban** — pick your system in the tabs), add a cron job, restrict a path to a few IPs in **nginx** or **Apache** (including the real-IP caveat behind a load balancer), add an nginx or Apache **virtual host**, issue and renew **Let's Encrypt** certificates, **harden SSH** without locking yourself out, add a **sudo user** with a key, **disk full**, **systemd** basics, **MySQL** database/user plus dump and restore, nginx **access-log** analysis, **swap**, **listening ports**, time and **NTP**, **Docker** basics, and a five-minute **security check**.

- Each runbook opens with **Read before you start** (red box) — e.g. keep a second SSH session open, add the live `iptables -I` rule before touching the file, never `ufw enable` before allowing SSH.
- **Variables**: commands use `{{ip}}`, `{{port}}`, `{{domain}}`, `{{user}}`…; fill them once at the top and every command in the runbook updates. Empty ones stay as `{{…}}` so you see what still needs a value.
- Every command has **Copy** and **Send** — Send types the command into the connected terminal of the tab you are on, or, when the runbook itself is the open tab, into the terminal tab you used most recently (it refuses while a variable is still empty, and refuses outright when no session is connected anywhere rather than guessing a machine). Steps that can drop your SSH connection or destroy data are marked **⚠ Dangerous** and ask for confirmation before copying or sending.
- **My runbooks**: *+ New runbook* opens an editor with title, category, tags, summary, warnings and the steps in a small text format — `## Step title`, lines starting with `$ ` are the command (consecutive `$` lines form one block), other lines are notes, `!!` at the top of a step marks it dangerous, variables are written `{{ip}}`. *Copy to edit* on a built-in runbook (for the system tab you are viewing) is the quickest way to start one adapted to your infrastructure. Your runbooks are stored in the vault's meta table (not encrypted; do not put passwords in them) and appear while the vault is unlocked. Built-in content is in Vietnamese for now.

**Test**: open *Whitelist một IP qua firewall* → the **firewalld** tab → type an IP in `{{ip}}` → every command now shows it → *Copy* on step 2 puts the filled command on the clipboard; on the **iptables-services** tab the last step (`systemctl restart iptables`) is red and asks for confirmation. Open an SSH tab, come back, *Send* on `iptables -L INPUT -n --line-numbers` → the command runs in that pane. *+ New runbook* → paste two `##` steps → the counter shows *2 steps* → Save → it appears under *My runbooks* with 📌; lock the vault → the section shows the locked note.

### 15M. Scheduled jobs — *All features* → ⏰ Scheduled jobs

**What it is**: a cron schedule that lives inside the app, for the checks you want run without adding anything to a server's crontab. Three kinds of job: a **command**, a **snippet** you already have, or a **fleet inventory collection**.

- **Schedule**: five-field cron (`15 3 * * *`) or `@daily`/`@hourly`/`@weekly`/`@monthly`. Six presets are one click away, and the line under the field always shows the **next run** in your machine's time — an invalid expression says so instead of saving quietly.
- **Hosts**: tick the machines (an inventory job with nothing ticked collects **every SSH host**). Up to 4 run in parallel, each with the timeout you set.
- **Counting a failure**: *any host fails*, *all hosts fail*, or *never* (for a job whose exit code you do not care about). A failed run is recorded in **Notifications**, so a nightly backup check that stops passing surfaces the next morning rather than a month later.
- **History**: every run keeps the start time, duration, status and — per host — the exit code, how long it took and the output (head and tail, capped so one chatty command cannot fill the database). Expand *History* on the row for the last 50 runs, worst host first. **Run now** tries a job without waiting for the schedule.
- **The app must be running.** Combine with *Settings → Application → close to tray* (0.2.22) and the schedule survives closing the window. The schedule itself is stored in `jobs.json` next to the vault, so the scheduler knows it the moment the app starts; but running a job needs credentials, so a run that meets a **locked vault** is recorded as *skipped* with that reason and an info event — it is never silently dropped. A machine that was asleep past a scheduled time runs the job **once** on waking, not once per missed slot.

**Test**: *+ New job* → *Command* → `uptime` → preset *Every 15 minutes* → tick two hosts → Save → the row shows the next run. **Run now** → the dot turns amber then green and the row reads *2/2 hosts OK*; expand *History* to see both outputs. Change the command to `exit 1` and run again → the row goes red, and 🔔 in the status bar gains an unread alert. Pause the job → the dot greys out and no next run is shown.

### 15N. Fleet security check — *All features* → 🛡️ Fleet security check

**What it is**: one **read-only** command per host (no install, no `sudo`, up to 4 in parallel, through the login script like every other diagnostic), turned into a score out of 100 and a list of things to fix. What it looks at: whether sshd still accepts **passwords** or lets **root** log in, which ports listen **beyond loopback** (a MySQL on `127.0.0.1` is not a finding; the same port on `0.0.0.0` is), how many **failed logins** are in the auth log, whether **fail2ban** is present, `NOPASSWD` **sudo** rules, accounts with an **empty password** or a **second UID 0**, keys in root's `authorized_keys`, whether a **firewall** is active, whether **SELinux** is enforcing, and whether a **reboot is pending**.

- Findings are sorted worst first (high → medium → low → informational; *Hide informational* is on by default), and each one carries **How to**, which opens the matching runbook (§15L) instead of leaving you to search.
- **The app changes nothing.** It runs no fix, and it writes **no results to disk**: a scan is a snapshot of "which machine is exposing what", which is exactly the sort of file that should not be sitting around. Close the tool and the results are gone; scan again when you want them.
- A host that cannot be reached shows the connection error on its own row rather than scoring 0 silently.

**Test**: open the tool → hosts are ticked by default → **Scan** → each machine gets a score and its findings; a machine with `PasswordAuthentication yes` shows that first in red. Click **How to** on it → Runbooks opens at *Harden SSH*. Untick *Hide informational* → the "firewall active" style entries appear too.

### 15O. Folder diff & push — *All features* → 🔄 Folder diff & push

**What it is**: for the loop where you edit code on your machine — a WordPress theme, a PHP app — and have to get it onto the server. Pair a **local folder** with a **folder on a host**, and the app tells you which files differ and pushes the ones you changed.

- **Compare** uses **modified time and size**, not checksums: hashing a whole tree on a production machine is a long, CPU-hungry command, while time and size answer the real question ("which file did I change and not upload yet"). A 2-second tolerance covers filesystems that store seconds and clocks that are not perfectly in step.
- The table says, per file: *local is newer* / *host is newer* / *local only* / *host only* / *identical*, plus **same time, different size** — shown as a **conflict** rather than guessed at. Identical files are hidden until you ask for them.
- **Push changes** uploads the *local is newer* and *local only* files, creating remote directories as needed. A conflict is **never** pushed automatically.
- **Watch** uploads a file as soon as you save it (writes are grouped for ~0.6 s so one save in an editor is one upload), reusing a single SFTP session instead of reconnecting per file. The watcher runs in the main process, so it keeps working while you are on another tab.
- **One way only, machine → host.** A file that is newer on the server is flagged, not pulled down: it almost always means somebody edited it there directly, and overwriting would lose that edit. A file you delete locally is **not** deleted on the host — do that yourself, so one slip cannot wipe data.
- The **ignore list** (`.git`, `node_modules`, `vendor`, `.env`, `*.log`… editable per pair) matches per path segment and supports only `*` and `?`. Keep `.env` on it so your local configuration never lands on the server. Paths that would escape the remote root are refused outright.

**Test**: *+ New folder pair* → **Browse** for a local folder → pick a host → type the remote path (`/var/www/example.com`) → Save → **Compare**. Edit a file locally and compare again → it shows as *local is newer* in green; **Push changes** uploads it and the row becomes *identical*. Turn **Watch** on, save another file in your editor → *Just happened* under the table shows the upload within a second or two. Touch a file on the server → it shows *host is newer* in amber and stays that way.

### 15P. Command history — `Ctrl+Shift+R`, or 🔎 Command history in the tools menu

**Where to open it**: `Ctrl+Shift+R` toggles it; it is also **🔎 Command history** in the `⋯` tools menu, on the Dashboard tool grid, in the *All features* tab, and in the Workbench theme's Tools panel — plus the Command Palette. (A feature reachable only by a keyboard shortcut is a feature that people who did not read the changelog never find out exists.)

**What it is**: every command that finishes on a host is recorded — the command, the machine, how long it took, its exit code — and stays searchable months later. It answers *"how did I do that on app-02 back then?"* even when the server's own `.bash_history` was wiped, rotated, or never written because the session ended in a disconnect, and it finds commands you typed on a **different** machine, which is usually what you are actually looking for.

- **Needs shell integration**: the OSC 133 snippet is what tells the app where one command ends and the next begins. No snippet on that host, no history from it — and the search says so, with the snippet right there: **⚡ Install on the open host** appends it to `~/.bashrc` through the terminal you already have open (idempotent — press it twice and it tells you it is already there), **⧉ Copy** for pasting by hand or into Ansible/cloud-init for the whole fleet, **▸ Show the snippet** to read it first. Installing into `~/.bashrc` takes effect from the **next** session; to enable it in the session you are in, copy and paste it straight into the terminal. It is also in **Settings → Terminal → Shell integration**.
- **The ranking** puts a match at the start of the command above one in the middle, the machine you are standing on above the same command elsewhere, and recent above old. Repeats collapse into one row that says how many times the command ran and on how many machines, so twenty `nginx -t` do not push out everything else. **All machines** is the default; the button switches to the current host only.
- **Enter inserts the command into the terminal — it does not run it.** You read it and press Enter yourself. That is deliberate twice over: an old command may point at the wrong host or path, and the dangerous-command guard only gets its say when *you* press Enter.
- **`Ctrl+R` is left alone.** In a terminal that is the remote shell's own reverse search, and taking it away would cost you a key you have used for years. The two run side by side.
- **Passwords typed on the command line are redacted before storing.** `mysqldump -pSECRET`, `curl -u user:SECRET`, `--token …`, `--password=…`, `PASSWORD=`-style prefixes and an `Authorization: Bearer …` header in `curl -H` keep their shape but lose their value — quoted values (`-p"a b"`) included. Such a row is marked 🔒 and warns you when inserted, since it will not run as-is. Redaction works from patterns, so a form nobody thought of can still slip through: **✕ on a row removes that one command** without wiping the whole history. `-p` on anything else (`cp -pr`, `mkdir -p`, `docker run -p80:80`) is left untouched on purpose. The command text is encrypted with the vault key on top of that.
- **It stays on this machine** — deliberately not part of vault sync (the sync merge picks the newer of two versions of one record, which means nothing for a log that only ever grows). **Settings → Terminal** has *Export to file* / *Import from file* for moving it deliberately; the exported JSON is **plain readable text**, so keep it out of shared folders. The same place turns recording off and clears what is stored.
- The last **5000** commands are kept. Trivial ones (`ls`, `cd`, `pwd`, `clear`) are not recorded — retyping them is faster than finding them.

**Test**: paste the OSC 133 snippet into `~/.bashrc` on a host, reconnect, run `systemctl status nginx`, then press `Ctrl+Shift+R` → the command is at the top with a green dot, its duration and the host name. Type `nginx` → it stays, unrelated commands go. Press Enter → the command appears at your prompt **without running**; press Enter yourself to run it. Run `mysql -pSECRET -e "select 1"` and search again → the row reads `-p<đã che>` and inserting it warns you to edit it first.

### 15K. Fleet inventory — *All features* → 📇 Fleet inventory

**What it is**: a light asset register. **Collect** runs **one read-only command** on each ticked host (no install, no `sudo`, up to 4 machines in parallel, through the login script like every other diagnostic) and fills a wide table: OS (`/etc/os-release`), kernel, architecture, CPU count, RAM, root disk usage (coloured from 75 %), uptime, IPv4 addresses, virtualisation, whether a **reboot is pending**, the versions of PHP, nginx, Apache, MySQL/MariaDB, Node, Docker and Python, and the **listening TCP ports**. The **search box** matches every column with all words required — `php 7.4` finds machines still on PHP 7.4, `ubuntu 20` the ones due for an upgrade, `:3306` anything listening on MySQL, `reboot` whatever needs a restart. Cells that **changed since the previous collection** are highlighted; hover to see the old value (a patch run that moved the kernel and PHP shows up immediately). The last 20 snapshots per host are kept in `inventory.db`; ▶ on a row re-collects that host, ✕ forgets it, **Export CSV** saves the table. Linux hosts only (the command relies on `/proc`, `df`, `ss`/`netstat`).

**Test**: tick two hosts → Collect → progress `1/2`, `2/2` → both rows appear; type `php` → only hosts with PHP remain; upgrade a package on one host and collect again → the changed version cell turns yellow and the tooltip shows `old → new`; Export CSV → a file with one row per host.

### 15C. Trusted fingerprints — `⋯` → Trusted fingerprints

Every host key you've accepted, newest-seen first, with the full SHA-256 fingerprint (not truncated — comparing it against `ssh-keygen -lf` on the server is the only thing you'd want it for), the key type, when you first trusted it and when it was last seen. Filter by host or fingerprint.

**Forget** removes an entry: the next connection to that host asks again as if it were new, instead of raising a host-key-changed alarm. Use it when you know why the key changed — a rebuilt server, a replaced machine. The alternative is clicking past a red warning every time, and a warning you dismiss by reflex has stopped being a warning. If you *don't* know why it changed, that alarm is doing its job; leave it. Forgetting also propagates to your other machines through sync, so they don't keep warning about a host you've already dealt with.

### 15B. Export hosts — `⋯` → Export hosts…

The other direction: write your host list to a file you can read, as **ssh_config**, **CSV**, or **JSON**.

- **ssh_config** — paste it into `~/.ssh/config` and `ssh <name>` works in any terminal. Group inheritance is resolved first, so a host that inherits its user, key, or jump chain from its group doesn't come out missing them, and `ProxyJump` is rebuilt from the jump chain. Non-SSH hosts (VNC/RDP/serial) are left out and **counted** in a comment at the top rather than vanishing quietly. Aliases are sanitised (`* ? ! #` removed — a label like `web *` would otherwise become a pattern matching *every* host) and de-duplicated with a `-2` suffix.
- **CSV** — one row per host, RFC 4180 quoting, so a comma inside a label doesn't break the columns.
- **JSON** — same fields, plus the sanitised alias and resolved jump chain.

> ⚠️ **The export carries no secrets, by design**: no passwords, no private keys, no notes, no environment variables. It's a plain file — anyone who can open it reads all of it. Treat it as a readable inventory, **not a backup**; the backup is the encrypted blob under Sync (§13).

Because keys live encrypted in the vault rather than as files on disk, the `IdentityFile` line is written **commented out** with the key's name beside it. Pointing it at a guessed path would produce a config that looks correct and then fails at connect time — export the key to `~/.ssh/` yourself, then uncomment the line.

---

## 16. Command Palette — `Ctrl+Shift+P`

Type to reach any action (keyboard-first): SSH/SFTP/Split to any host, open a local terminal, toggle broadcast, open Bulk/Monitor/AI/Sync/Tunnels/Snippets/Keys/**Plugins**, open the log folder, lock the vault. ↑↓ to choose, Enter to run. Commands registered by **plugins** also appear here (hinted `plugin`).

---

## 16B. Plugins (extend the app) — `⋯` → 🧩 Plugins

**What it is**: extend the app with **JavaScript plugins** without touching the core — add Command Palette commands, observe/automate terminal output, and show info panels.

> **Trust model**: a plugin is JS that runs with the app's trust. Each plugin runs in a shared Node `worker_thread` — **fault-isolated**, so a crashing plugin can't take down the app — and **only reaches the app through the `api`** object; a plugin **cannot** read the vault or secrets. The sandbox does not defend against deliberately malicious code → only install plugins you trust.

### A0. Marketplace (one-click install)

The Plugins modal has a **🛒 Marketplace tab**: it lists plugins from a public registry (a static JSON on GitHub Pages — no account, no server) and installs or updates them with one click. Safety measures: every catalog entry is **signed with ed25519** and verified against a public key **embedded in the app** (unsigned or tampered entries are dropped before they're even shown — a compromised registry/CDN can't forge them), every file has a **SHA-256 checksum verified before anything is written**, file names are strictly validated, and the plugin's `manifest.json` must pass the same validation as a locally installed plugin. Installed plugins land in the same `<userData>/plugins/` folder and behave exactly like manually copied ones (the trust model above still applies — the current catalog contains only the maintainer's sample plugins).

### A. Install & manage (manual)

Each plugin is a folder under `<userData>/plugins/<plugin-id>/`:
```
<userData>/plugins/<plugin-id>/
  manifest.json     # required — metadata + contributions
  index.js          # required — CommonJS (module.exports.activate)
  data.json         # created automatically when you use api.storage
```
`<userData>`: Windows `%APPDATA%\<app name>\plugins` · macOS `~/Library/Application Support/<app name>/plugins` · Linux `~/.config/<app name>/plugins`.

**Quick install of the 3 sample plugins** (in the repo at `docs/examples/`):
1. `⋯` → **🧩 Plugins** → **📂 Open plugins folder** (opens the exact folder — don't guess the path).
2. Copy `docs/examples/hello-world`, `docs/examples/output-highlighter` and `docs/examples/access-log-analyzer` into it.
3. Click **↻ Rescan** (or close/reopen the modal) — **no app restart needed**.

**The Plugins modal** (`⋯` → 🧩 Plugins): each plugin has a status badge (**Active** / Disabled / Failed / Crashed / Loading), plus:
- **Enable / Disable** — disabling removes the plugin's commands from the Palette; remembered across launches (`state.json`).
- **↻ Rescan** — detect newly copied-in plugins (opening the modal rescans too).
- **Reload** — reload the **code** after you edit a file (no restart).
- **📂 Open plugins folder**.
- The **▼** arrow expands to view the plugin's latest **Error** + **logs**.

### B. Using plugins

- **Commands**: `Ctrl+Shift+P` → type a plugin command name (hinted `plugin`) → Enter. E.g. the sample *Hello World*: the **"Hello: Say hi"** command opens a markdown **panel**.
- **Panel**: markdown/text content a plugin produces (reports, tables…) — docks to the **top-right corner**, translucent (hover to focus), and doesn't block the terminal: keep typing while reading. Close with **✕**, or minimize with **–** to a small `🧩` pill (click to restore; it also restores automatically when the plugin pushes new content). Esc is left to the terminal.
- **Toast**: a plugin can raise a short notification (e.g. *Output Highlighter* warns when it sees "error" in the terminal).
- **Light automation**: a plugin can listen to terminal output and write a command into the open session (e.g. the "Highlighter: send echo to active session" command).
- **Real-world sample — *Access Log Analyzer***: SSH into a web server (root helps for reading the log), then run **"Access log: Phân tích 7 thông số"** from the Palette. It types one visible shell one-liner into the session and opens a panel with 7 stats: top 15 IPs, requests/minute, top URLs, top User-Agents, status codes, what the most suspicious IP is calling, and — when the log carries GeoIP enrichment (`… | ASN_NUMBER: 45899 | ASN_ORGANIZATION: VNPT Corp`) — the **top 15 network organizations (ASN)** behind the traffic (logs without that field just show a skip note) — plus a short how-to-read guide. When invoked it first asks for the **log path** in a small dialog — leave it empty to use the default (`/etc/httpd/logs/ssl_access_log`), or type e.g. `/var/log/nginx/access.log`; the last entered path is remembered for next time. It handles both the standard combined format and custom formats with a **leading vhost** (`www.site.com:443 1.2.3.4 - - [...]`) — the column offset is auto-detected from the first line, and with a vhost present the top-URL sections print `vhost/path` (one file often aggregates many domains). Each panel section shows the exact shell pipeline it ran and has **↻ re-run** / **✎ edit-command** buttons: edit opens a dialog pre-filled with the current command (clear it to restore the default), and only that section re-runs and updates in place; edited commands persist and are reused by the next full analysis. The default path, sample size (50 000 lines) and a `FIELD_OFFSET` override live at the top of its `index.js` — edit + **Reload** for exotic formats.

### C. Writing a plugin

`index.js` (CommonJS) exports `activate(api)` (required) and `deactivate()` (optional):
```js
module.exports.activate = (api) => {
  // register commands, subscribe to output… (sync or async both fine)
}
module.exports.deactivate = () => {
  // clean up on disable/reload (unsubscribe…)
}
```
- `activate(api)` runs when the plugin is enabled; it has a **10s timeout** (hanging longer → **Failed** status).
- Errors in `activate`/handlers/`onData` are caught and logged, and **don't** affect other plugins.

**manifest.json**:
```jsonc
{
  "id": "my-plugin",            // REQUIRED: kebab-case, MUST equal the folder name
  "name": "My Plugin",          // REQUIRED: display name
  "version": "1.0.0",           // REQUIRED: semver
  "description": "…",           // optional
  "main": "index.js",           // optional (default index.js); must stay inside the plugin folder, .js
  "permissions": ["terminal.observe","terminal.write","ui.panel","ui.notify","storage"], // v1: declared/displayed only
  "contributes": { "commands": [ { "id": "my.hello", "title": "My: Say hi" } ] }  // id is "group.name"
}
```
An invalid manifest → the plugin shows a **Failed** status (with the message when you expand ▼), and **doesn't** crash the app.

**The `api` object** passed to `activate(api)`:
| API | Kind | Description |
|-----|------|-------------|
| `api.id` | `string` | the plugin id |
| `api.commands.register(id, title, handler)` | sync | Register a command; `handler(ctx)` runs when invoked from the Palette or a panel `cmd:` button. `ctx.activeSessionId?: string`, `ctx.arg?: string` (the part after `?` in a `cmd:` link). |
| `api.terminal.onData(cb)` | sync → `() => void` | Listen to output of all sessions: `cb({ sessionId, data })`. Returns an unsubscribe fn. **Observe-only.** |
| `api.terminal.write(sessionId, data)` | async | Send text/a command into a session (as if typed). |
| `api.terminal.getActiveSessionId()` | async → `string \| null` | The currently active terminal session. |
| `api.ui.showPanel({ title, markdown?, text? })` | async | Open a panel showing `markdown` (safe subset) or plain `text`. |
| `api.ui.notify(message)` | async | Show a short toast. |
| `api.ui.prompt({ title?, label?, placeholder?, value? })` | async → `string \| null` | Ask the user for one line of text via a modal. Returns the entered string (may be empty), or `null` if the user cancelled. Waits up to 120s (not the usual 8s). |
| `api.storage.get(key)` / `api.storage.set(key, value)` | async | Read/write JSON private to the plugin (`data.json`). |
| `api.log(...args)` | sync | Write to the log (view in Plugins → ▼). |

> **async** functions return a `Promise` (round-tripped through main, 8s timeout; `ui.prompt` waits 120s) — remember to `await`. `register`/`onData`/`log` are sync. `showPanel` markdown supports: `#`/`##`/`###`, `**bold**`, `*italic*`, `` `code` ``, code blocks, `- ` lists, `http(s)` links, and **action buttons** `[label](cmd:command.id?arg)` that invoke a command of the same plugin with `ctx.arg` set to the (URI-decoded) text after `?`; **no** raw HTML.

**Example** — observe output → notify + send a command:
```js
let off = null
module.exports.activate = (api) => {
  off = api.terminal.onData(({ data }) => {
    if (/error|fail/i.test(data)) void api.ui.notify('⚠ Saw "error" in the terminal')
  })
  api.commands.register('hl.echo', 'Send echo to active session', async () => {
    const id = await api.terminal.getActiveSessionId()
    if (id) await api.terminal.write(id, 'echo hi\n')
  })
}
module.exports.deactivate = () => { if (off) off() }
```

**Constraints & tips when writing**:
- No direct access to the vault/secrets/hosts — only through `api`.
- Use `__dirname`/`__filename` (point to the plugin folder); **don't** rely on `process.cwd()` (it's the app's cwd).
- Need external libraries? The plugin must **bundle its own `node_modules`**.
- Output is only forwarded to a plugin while one is subscribed (nobody listening → zero cost).

### D. Out of scope for v1 (planned for v2)
New connection protocols (pluggable SessionKind) · permission enforcement + consent dialogs · transforming the output stream (currently observe-only) · arbitrary React panels / a marketplace.

---

## 16C. Local dev stack (replaces Laragon / XAMPP) — `Settings → Local dev`, then `⋯` → 🧱 Local dev

**What it is**: run your local PHP / WordPress sites **inside this app**. It downloads and supervises its own portable PHP, Nginx and MariaDB — you don't install Laragon or XAMPP, and the app's installer doesn't get bigger.

**Windows only for now.** The feature is **off by default**; nothing is written to disk until you turn it on in **Settings → Local dev**, where you also pick the **folder** everything lives in (put it on a roomy drive — moving it later is painful), the **HTTP port range**, and how many **`php-cgi` workers** to run.

### A. Install what you need — the **Runtimes** tab

Two groups: **Stack** (required to serve sites) and **Tools** (optional).

| | What | Size |
|---|---|---|
| Stack | PHP 8.3 / 8.4 (NTS) · Nginx 1.30 · MariaDB 11.4 LTS | ~34 / ~3 / ~95 MB |
| Tools | **Adminer** (light DB browser, 1 file) · **phpMyAdmin** · **Composer** · **WP-CLI** · **Node 24 LTS + npm** · **mkcert** | 0.2–37 MB |

- **Install** downloads from the official site and checks the file against a **SHA-256 pinned inside the app**. Nginx publishes no checksum (only a PGP signature), so there the app computes one and writes it into a provenance file next to the runtime — the card says so explicitly.
- **📁** next to it installs from a file **you** downloaded — the escape hatch when a corporate network or antivirus blocks the download. The checksum is still verified.
- Every binary is **smoke-tested right after install**, so a missing *Visual C++ Redistributable* is reported there and then instead of at first start.
- PHP needs **Visual C++ Redistributable 2015–2022 (x64)** on the machine. **phpMyAdmin 5.2 doesn't support PHP 8.4** — install PHP 8.3 as well and the app automatically serves phpMyAdmin with 8.3.

### B. Start / stop — the **Services** tab

**▶ Start stack** starts MariaDB → the `php-cgi` pool → Nginx (in that order; Nginx first would 502 on the first request). Each service shows state, PID, port, uptime, restart count, and — when something dies — **the last 20 lines of its stderr**, so you get the reason rather than just "stopped".

- Crashes are restarted automatically with a backoff; repeated failures stop and stay visible instead of looping.
- Stopping is always **graceful** (`nginx -s quit`, `mariadb-admin shutdown`). A hard kill of `mysqld` is the equivalent of pulling the plug mid-transaction, so the app never does it.
- If the app itself was killed, leftover `nginx`/`mysqld` processes **holding your ports** are detected and reaped the next time you start — recognised by their executable path, never by PID (Windows reuses PIDs fast enough to kill an innocent process).
- **Stop all local services** is in the Command Palette as an escape hatch.

### C. Add a site — the **Sites** tab

Point at a project folder you already have; the type (**static / PHP / WordPress**) is auto-detected. The site is served at **`http://<slug>.localhost:<port>`** — **no hosts-file edit and no admin rights**, because browsers resolve `*.localhost` to loopback themselves (RFC 6761).

- Config (`nginx` vhost, `php.ini`, `my.ini`) is **regenerated from the database every time you apply**, and each reload is gated by `nginx -t` — a broken vhost shows a red message instead of taking the whole stack down with it.
- Site logs live in the app's own area, **never scattered into your project folder** (it might be a git repo).
- **⌨ Terminal** opens a shell at the site root with `php`, `composer`, `wp`, `node` and `npm` already on `PATH`.
- Note for `curl` / WordPress cron: Windows' own resolver does **not** resolve `*.localhost` — only browsers do. Loopback calls from PHP need `127.0.0.1` (or a hosts entry).

**✎ Edit a site** (hover a row): change its **name**, **domain**, **kind**, **docroot** and **PHP version**.

- **Domain** — anything you like, not just the generated `<slug>.localhost`: `myshop.test`, `blog.local`, even a real domain. Spaces/newlines are rejected (they'd corrupt the nginx config), and a domain already used by another site — or by the app's own `db.localhost` / `pma.localhost` — is refused with a reason. Change it and the vhost is rewritten immediately.
- **Kind** — the detected value (WordPress / PHP / static) is a *guess* from the folder contents. **Re-detect** re-runs it and shows **what it matched on** (e.g. *"Guessed WORDPRESS because of: wp-config.php"*), so you can see whether the guess makes sense; if it doesn't, pick the kind by hand. A Laravel project wins on `artisan` even if a stray `wp-*.php` file is lying around, and its docroot defaults to `public/`.
- **Docroot** — the folder nginx actually serves; useful when the framework layout isn't detected (`public/`, `web/`, `htdocs/`…).

### C2. Getting rid of `:8080` in the URL

Two independent options — use whichever fits, they don't conflict:

| | How | Trade-off |
|---|---|---|
| **Use port 80** | Settings → Local dev → *Use port 80* | Works in every browser and tool. Windows needs no admin for port 80, but it's often taken by **IIS / "World Wide Web Publishing Service" / http.sys** — then the app falls back to your port range and says so in the warnings (the stack still starts). Free it with `net stop W3SVC` (as admin) or by disabling that Windows service. |
| **🎯 Open without a port** | The 🎯 button on a site row | Nothing to configure, works even while something else owns port 80, and covers **custom domains without a hosts entry**. Only applies to the Chromium window the app opens (same mechanism as §16D). |

### D. Databases

MariaDB listens on **3307 and up, never 3306**, so an existing XAMPP/Laragon/MySQL keeps working. The data directory lives **outside** the runtime folder, so upgrading or removing a runtime never touches your data.

- **Provision database** creates a database + user + grant for that site. `root` gets a **generated password** (kept in `conf/mariadb/root.cnf`), not a blank one: your local sites run on loopback too, so a vulnerable site would otherwise reach every other site's data.
- **Export / Import `.sql`** — dumps from phpMyAdmin, `mysqldump` or XAMPP all work.
- **Write into `wp-config.php`** puts the credentials into a WordPress site (the old file is backed up first, and the action refuses if the file doesn't actually look like `wp-config.php`).
- **Adminer** and **phpMyAdmin** buttons open the DB in your browser (`db.localhost` / `pma.localhost`); phpMyAdmin logs itself in as root.

### E. Not there yet

`.test` domains and local HTTPS (mkcert is installed and on `PATH`, but `mkcert -install` + issuing a certificate is still manual) · a WordPress downloader (point it at a folder you already have) · deploy between local and a server · public share links.

---

## 16D. Point a domain at a specific server (no hosts file) — `⋯` → 🎯

**The problem**: you have a domain served by 5 load-balanced machines and you want to see what **one** of them returns. The usual answer is opening `C:\Windows\System32\drivers\etc\hosts` as administrator and editing an IP by hand — every time you switch machine, and every time you forget to undo it you spend an afternoon debugging your own hosts file.

**What this does instead**: you list the domains once plus the IP of each server, then click a server and press **Open**. The app launches a Chromium browser window whose **DNS override applies to that window only**.

1. Create a group (e.g. *Production*) and put the domains in, one per line — a one-level wildcard works: `*.example.com` covers every subdomain.
2. Add the servers: a label (*LB1*) and its IP. **From a saved server…** pulls the IP straight out of a host you already have in the app.
3. Click a server chip to select it → **Open**. To switch machine, click another chip and open again.

Why it beats a hosts file:

- **No admin rights and nothing to clean up** — the hosts file is never touched, so a crash can't leave a stale entry behind, and no other application on the machine is affected.
- **HTTPS still validates** — the hostname in the URL doesn't change, so SNI and the `Host` header stay real and the certificate matches (unlike browsing `https://<ip>/`).
- **All servers at once** — *Open all N* opens one window per server, each with its **own cookie jar**, so logging into LB1 doesn't clobber your LB2 session. A hosts file can only point at one IP at a time.
- **Copy curl command** gives you the same trick for a terminal (`curl --resolve`).

Limits: needs a **Chromium** browser (Chrome / Edge / Brave / Vivaldi — Firefox has no equivalent flag), and it has **no effect behind a system proxy**, because then the proxy resolves DNS. Non-browser clients (Postman, MySQL clients) aren't covered — use a tunnel (§9) or the curl command. Each server keeps a separate browser profile, so the first visit is a fresh browser (no extensions, no existing logins); the footer shows how much disk the profiles use and lets you clear them.

---

## 16E. Help centre — `F1`, the version line in the status bar, or `⋯` → ❓ Help

Four tabs, one for each question you actually arrive with.

**About** — the version you're running, when it was built and from which commit, the Electron / Chromium / Node versions underneath, and your OS. **Check for updates** answers in words every time: *a new version is available*, *you're on the latest one*, *couldn't check, here's why*, or *this is a dev build, there's nothing to compare against*. When there is a new version, a **Download** button appears and the progress shows in the usual banner at the top.

**Shortcuts** — the same list as the Dashboard, reachable from anywhere including inside a terminal (`Ctrl+/` opens straight to it). The four terminal shortcuts are shown **as you have them set**, not as they ship, so the table can't drift from Settings → ⌨ Keyboard shortcuts.

**What's new** — the changelog entry for the exact build you're running, embedded at build time so it works offline. A link goes to the full changelog on GitHub.

**Troubleshooting** — buttons that open the app data folder, the session log folder and the recordings folder in your file manager, a link to GitHub Issues, and **Copy system information**: app version, build date and commit, Electron/Chromium/Node, OS and architecture — formatted to paste into an issue. It deliberately contains **nothing about your hosts**: no addresses, no usernames, no host names. Session logs are a different matter — they hold verbatim what your terminal displayed, so read one before attaching it to anything.

---

## 17. Keyboard shortcuts

| Key | Action |
|-----|--------|
| `F1` | Help centre |
| `Ctrl+/` | Shortcut list |
| `Ctrl+Shift+P` | Command Palette |
| `Ctrl+I` | AI Assistant |
| `Ctrl+Shift+T` | New local terminal tab |
| `Ctrl+Shift+W` | Close current tab |
| `Ctrl+Shift+D` | Split an extra local pane |
| `Ctrl+Shift+B` | Toggle Broadcast |
| `Ctrl+Shift+H` | Collapse/expand the host sidebar (more room for the terminal) |
| `Ctrl+Shift+R` | Search the commands you have run (see §15P) — `Ctrl+R` still reaches the remote shell |
| `Ctrl+J` | Bottom panel — Monitoring / Log / Tunnels (Workbench theme only) |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | Switch tabs |
| `Ctrl+F` | Find in terminal |
| `Ctrl+Shift+E` | AI-explain the selected terminal output |
| `Ctrl+Shift+C` / `Ctrl+Shift+V` | Copy / Paste (customizable in **Settings → ⌨ Keyboard shortcuts**) |
| Left-click inside a selection | Copy the highlighted text |
| Right-click in the terminal | Paste the clipboard at the cursor |
| `Esc` | Close the open modal |

> Every delete action (host/key/snippet/tunnel/recording/file in SFTP) asks for confirmation before deleting permanently.

---

## 18. Known limitations of the current release

- **Bulk / Monitor / SFTP / Local-forward tunnels over a login script** rebuild the path non-interactively: `ssh` hops (password hops need `sshpass` on the gate) and `su`/`sudo` steps are supported; setups that force a TTY password prompt may still fail. Login-script tunnels additionally need `nc` on the innermost hop.
- **Sync** currently has only the **folder** backend (Google Drive/Dropbox/Syncthing/network share); WebDAV, S3, Git are planned.
- **Secrets manager** supports 1Password, Bitwarden, HashiCorp Vault via CLI; KeePassXC is planned.
- **Plugin system** is at **v1** (commands + observe/write output + panel + storage + Marketplace tab with ed25519-signed entries); no new protocols, permission enforcement, or output transform yet — see §16B-D.
- **Remote desktop (VNC/RDP)** tunnels through **jump-host chains** only; a target reachable solely via an interactive **login-script gate** is not yet supported. **RDP** launches the OS client through a tunnel (not embedded); embedded FreeRDP isn't planned. VNC requires a real VNC server on the target and network reachability (LAN or SSH tunnel).
- **AI troubleshooter** runs **read-only** commands only (blocked by a main-process guard + your per-step approval); to apply a fix you run it yourself.
- **Local dev stack** is **Windows-only** for now; `.test` domains and local HTTPS aren't wired up yet, there's no WordPress downloader, and no local↔server deploy or share link — see §16C-E. phpMyAdmin 5.2 needs PHP ≤ 8.3 (install 8.3 alongside 8.4 and the app picks it automatically).
- **Point a domain at a server** needs a **Chromium** browser and does nothing behind a system proxy; it covers browsers only, not Postman or database clients — see §16D.
- **Replication monitoring** covers **MySQL/MariaDB position-based replication**. GTID sets aren't compared yet (only binlog file/position), PostgreSQL streaming replication isn't supported, and there's no lag history chart or detached window yet. Per-pair alert thresholds exist in the backend but the UI only exposes the global defaults. Tunnel mode needs a **local-forward (L)** tunnel — SOCKS (D) and remote (R) tunnels have no local end to attach to — and requires a MySQL user/password. See §11C.
- **Tool tabs aren't saved in a workspace** (Monitoring, Compare, Local dev, Tunnels, Processes, Services, AI troubleshooter, Replication) — they carry no session, so they're one click to reopen; only terminal and SFTP tabs are restored. The **detached** Monitoring/Tunnels windows also don't remember their size and position between runs yet.
- **URL checks** do not follow redirects, send no cookies or authentication, and read at most 64 KB of the body for the keyword; they probe from this machine only.
- **Fleet inventory** is Linux-only (it reads `/proc`, `df`, `ss`/`netstat`) and version columns only cover PHP, nginx, Apache, MySQL/MariaDB, Node, Docker and Python.
- **Import from other clients** never reads their stored passwords or key files; PuTTY `.ppk` keys must be converted to OpenSSH before importing in *Keys*. SecureCRT is not supported yet.
- **Multi-host tail** opens one SSH connection per machine; keep the list to what the gate can take.
- **Scheduled jobs** need the app running (pair them with close-to-tray) and the vault open; a run that meets a locked vault is recorded as *skipped*. Timing is checked every 30 seconds, so a job can start up to half a minute late, and the schedule is your machine's local time — including its daylight-saving jumps.
- **Fleet security check** is Linux-only, needs no `sudo` and therefore cannot read `/etc/shadow`, a root-only `sshd_config` include, or anything else that requires privilege — it reports what an ordinary account can see. Results are not stored, so there is no history to compare.
- **Shell integration** requires the snippet in the host's `.bashrc`; bash only for now (zsh and fish are not covered), and it applies to shells started after the snippet is added. A machine you have not set up simply shows nothing extra.
- **Folder diff** compares modified time and size, so a file edited in place with the same length and a preserved timestamp reads as identical (this is why *same time, different size* is shown as a conflict rather than resolved). Watching uploads only; deletions and renames are never mirrored to the host, and a tree over 20 000 files is truncated with a warning. On Linux, per-directory watchers are registered because recursive `fs.watch` is not available there — a directory created while watching is picked up only after you toggle Watch off and on.
- Not yet available: a self-hosted **team server**, a **Docker/K8s browser** — see [../ROADMAP.md](../ROADMAP.md).
