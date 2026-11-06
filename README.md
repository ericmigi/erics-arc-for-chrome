# Eric's Arc for Chrome

Arc's best habits for Google Chrome on macOS, working with Chrome's own (vertical) tab bar. No sidebar, no extra window. Pieces:

- a Chrome extension (this folder): locked tabs, new tabs at the top, ⌃Tab by recent use, Little Arc, sidebar mini player
- a tiny Mac app (`player/`) the extension uses to draw the mini player over the tab sidebar
- [Karabiner-Elements](https://karabiner-elements.pqrs.org) rule: turns ⌃Tab into keys the extension can use
- Chrome Launcher app: starts Chrome with launch flags so typed words + Enter go to the page you visited
- macOS App Shortcuts: ⌘S hides/shows the tab sidebar, ⌥⌘↓/↑ move through the tab list
- an optional one-time import of your Arc history and form autofill

## Shortcuts at a glance

| Keys | What it does | Set by |
|---|---|---|
| ⌘S | Hide / show the vertical tab sidebar | `setup.sh` |
| ⌥⌘↓ / ⌥⌘↑ | Next / previous tab in the tab list | `setup.sh` |
| ⌃Tab / ⌃⇧Tab | Most recently used tab; keep holding ⌃ and press Tab again to go further back, let go to start over | `setup.sh` (Karabiner) + extension shortcut |
| ⌃R | Reset a pinned or CoreCore tab to its locked URL | extension shortcut |
| ⌘W, middle-click | Close; pinned and CoreCore tabs come back at their locked URL | Chrome (⌘W optionally the extension) |
| ⌥⇧N, from any app | New Little Arc | extension shortcut (Global) |
| ⌘O / ⇧⌘O | Little Arc → open in Chrome / pick a window or group | extension shortcut |
| ⌥⌘-click a link | Open it in a Little Arc | extension |
| ⌘L in a Little Arc | Show its address (selected, ready to ⌘C); type a URL or search + Enter to go | extension |
| ⇧⌘S | Save Page As (moved off ⌘S) | `setup.sh` |

"Extension shortcut" means you set it in `chrome://extensions/shortcuts` (step 7 below).

## Set up on a new Mac

You need Google Chrome, [Homebrew](https://brew.sh) and git.

**1. Clone to a permanent place.** Chrome loads the extension from this folder, so don't put it in Downloads.

Use this repository's clone URL from its GitHub page (Code → HTTPS), for example:

```bash
git clone https://github.com/YOUR-GITHUB-USERNAME/erics-arc-for-chrome.git ~/dev/erics-arc-for-chrome
```

**2. Run the setup script.** It sets the Chrome menu shortcuts (⌘S, ⌥⌘↓/↑), installs Karabiner-Elements (asks for your password) with the ⌃Tab rule, installs Chrome Launcher with a login item and a Dock icon, and builds the sidebar mini player (needs the Xcode command line tools: `xcode-select --install`). Safe to re-run.

```bash
~/dev/erics-arc-for-chrome/setup.sh
```

**3. Approve Karabiner.** Open Karabiner-Elements and follow its prompts:
- System Settings → General → Login Items & Extensions → Driver Extensions (ⓘ) → turn on **Karabiner-DriverKit-VirtualHIDDevice**
- System Settings → Privacy & Security → Input Monitoring → allow **Karabiner-Core-Service**

Your keyboard can pause for a moment while the driver starts; unplug and replug it if it doesn't come back.

Karabiner sends every keyboard through its own virtual keyboard, so per-keyboard settings in System Settings → Keyboard → Keyboard Shortcuts → Modifier Keys stop applying. If you swapped keys there (say Control ↔ Command on a PC keyboard), redo it in Karabiner → Devices → pick the keyboard → Simple Modifications.

**4. Restart Chrome through the launcher.** Quit Chrome (⌘Q), then open **Chrome Launcher** from the Dock or `~/Applications`. From now on always open Chrome that way (it also starts at login). If Chrome was started some other way, the launcher shows a notification telling you to quit and reopen it.

**5. Chrome settings.**
- Right-click the tab bar → **Show Tabs Vertically**
- Settings → On startup → **Continue where you left off**
- Settings → Default browser → **Make default** (Little Arc catches links from other apps)
- `chrome://flags/#browser-initiated-automatic-picture-in-picture` → **Enabled**, then relaunch from Chrome Launcher: a playing video (YouTube, X, …) pops out into a floating window when you switch tabs, like Arc's mini player. Chrome's ♫ toolbar button gives play/pause for any tab playing sound.

**6. Load the extension.** `chrome://extensions` → turn on **Developer mode** → **Load unpacked** → pick `~/dev/erics-arc-for-chrome`. When you pull changes later, click ↻ on its card.

**7. Set its shortcuts** in `chrome://extensions/shortcuts`. Chrome only pre-fills some of them, and never the ones added in an update:

| Command | Shortcut | Scope |
|---|---|---|
| Close tab (locked tabs come back at their locked URL) | ⌘W (optional: skips Chrome's "press ⌘W again" toast on pinned tabs) | In Chrome |
| Reset pinned tab to its pinned URL | ⌃R | In Chrome |
| Replace pinned URL with current | anything, or none | In Chrome |
| Recently used tab: start | ⌃. (Karabiner sends it for the first ⌃Tab) | In Chrome |
| Recently used tab: keep going | ⌃⇧. (Karabiner sends it for more ⌃Tabs while ⌃ is held) | In Chrome |
| Recently used tab: step back | ⌃, (Karabiner sends it for ⌃⇧Tab) | In Chrome |
| New Little Arc | ⌥⇧N | **Global** |
| Little Arc: open in Chrome | ⌘O | In Chrome |
| Little Arc: open in window or tab group… | ⇧⌘O | In Chrome |

**8. Make your locked tabs.** Pin the tabs you want as favorites, and put your everyday tabs in a tab group named `CoreCore` (or change `LOCKED_GROUPS` in `background.js` to your group's name and reload the extension).

**9. Optional: bring over Arc.** If Arc is on this Mac, this merges its last 90 days of history (so Chrome's address bar ranks those pages like Arc did) and its form autofill into Chrome. It quits and reopens Chrome, backs up both databases first, and only runs once.

```bash
~/dev/erics-arc-for-chrome/migrate/arc-to-chrome.sh
```

## Features

### Locked tabs: pinned tabs and the CoreCore group

Pinned tabs, and tabs in the `CoreCore` tab group, remember the URL they had when they got locked, like Arc's Favorites and pinned tabs.

- **Close it** (⌘W, middle-click): it comes back in the same spot at its locked URL. Unpin it, or drag it out of the group, to really close it.
- **⌃R** or the toolbar button: reset the current locked tab in place.
- **Replace pinned URL with current**: make the page you're on its new locked URL.

Locked URLs survive restarts by matching tabs in order, per pinned area and per group. If Chrome restores them in a different order, use "Replace pinned URL with current" or re-lock. Closing a whole window that has locked tabs, then quitting, can shift them by one.

### New tabs at the top

New tabs open at the top of the tab list, right under the locked tabs, like Arc's Today list. That includes ⌘T and Little Arcs moved into Chrome. A link opened in a new tab from a normal tab lands right after that tab. A link opened in the background (⌘-click) from a pinned or CoreCore tab goes to the top instead, and doesn't join CoreCore (and get locked); one that opens in the foreground becomes a Peek (below). Tabs in your other groups are left alone, and session restore doesn't reorder anything.

### ⌃Tab by recent use

⌃Tab jumps to the tab you used last, in any window. Keep holding ⌃ and press Tab again to go further back through recent tabs; ⌃⇧Tab steps back one. Letting go of ⌃ starts over, and only the tab you end on counts as used, so ⌃Tab, release, ⌃Tab takes you back to where you started, even after going several tabs back (A → B → C, release, ⌃Tab → A). A link you open in a background tab (right-click ▸ Open Link in New Tab, ⌘-click) is next in line, so ⌃Tab goes straight to it.

Chrome doesn't let extensions use the Tab key or tell them when ⌃ is released, so the Karabiner rule (`karabiner/ctrl-tab.json`) does that part while Chrome is in front: the first ⌃Tab since ⌃ went down becomes ⌃., more ⌃Tabs while ⌃ is held become ⌃⇧., and ⌃⇧Tab becomes ⌃,.

### Little Arc

Small throwaway windows for quick lookups. They're Chrome popup windows: no tab strip, no sidebar; ⌘[ goes back.

- **⌥⇧N**, from any app: a new Little Arc with a search box. Type a URL or a search (uses Chrome's default search engine). Esc closes it.
- **Links from other apps** (Slack, Mail, …) open in a Little Arc. They land in the main window for a moment first, so it flashes.
- **Peek**: a link from a pinned or CoreCore tab that would open a new tab opens as a Little Arc over the window instead, with the page behind dimmed, like Arc's Peek. Click the dimmed page or any other window to close it; ⌘O keeps it as a tab. It's a window in front of Chrome, not a sheet inside it, so it has its own title bar. Links (`target="_blank"`) and the page's own `window.open` are caught before Chrome makes a tab; anything else that opens a new tab from a locked tab (a form, say) passes through the main window first and flashes.
- **⌥⌘-click** a link on any page to open it in a Little Arc.
- **⌘L** or **🔗** (top right): an address field with the page's URL selected, so ⌘C copies it. Type a URL or search and press Enter to go there; Esc closes it. (Chrome's popup windows have no address bar of their own.)
- **⌘O** or **Open in Chrome** (top right of the page): move it into the main window as a normal tab.
- **⇧⌘O** or **▾**: pick a window or tab group to move it into.
- Little Arcs left unfocused for 12 hours close themselves. Size and position are remembered.

### Sidebar mini player

While a music site has a track loaded and you're on another tab, a small player sits at the bottom of the tab sidebar, like Arc's: artwork, title, artist, ⏮ ⏯ ⏭. Click the track to go to its tab. × hides it until you've been back to the music tab and left again. It hides when you're on the music tab, when the sidebar is collapsed (⌘S) and when Chrome isn't in front. On those sites it also stops Chrome popping the site's own mini player out into a floating window when you switch tabs (their pop-out button still works). Sites: Spotify, YouTube Music, SoundCloud, Apple Music, Tidal, Bandcamp, Pandora, Amazon Music, Deezer (add more in `manifest.json`, both `music.js` entries).

Chrome doesn't let extensions draw in its tab strip, so the player is a small Mac app (`player/ArcPlayer.swift`) floating over the sidebar. Chrome starts it while there's music and it quits when there isn't; `setup.sh` builds and registers it (`player/install.sh`; re-run it if you move this folder). It covers the last couple of tabs in a long list, and trails a little behind when you drag the window.

### Address bar goes to the page you visited

Typing words and pressing Enter opens the page from your history that matches them (`acme/commits` → github.com/acme-corp/app/commits), like Arc's command bar. Chrome only allows this with `--enable-features=OmniboxForceAllowedToBeDefault`, which isn't on `chrome://flags`, so Chrome Launcher passes it at startup. Searches you've made before can still outrank pages for the same words.

To change launch flags: edit `launcher/chrome-launcher.sh`, re-run `launcher/install.sh`, then quit Chrome and open the launcher.

### Chrome menu shortcuts

`setup.sh` adds macOS App Shortcuts for Chrome's own menu items:

- **⌘S** → View → Collapse Vertical Tabs (hides/shows the tab sidebar, like Arc). Save Page As moves to ⇧⌘S.
- **⌥⌘↓ / ⌥⌘↑** → Tab → Select Next / Previous Tab: move down / up the tab list.

They're in System Settings → Keyboard → Keyboard Shortcuts → App Shortcuts, and take effect when Chrome restarts.

### Split view

Nothing to set up: Chrome's own split view covers it. Drag a tab to the left, right or bottom edge of the page, or right-click a tab → New split view with current tab, or ⌥⌘N.

## Uninstall

```bash
~/dev/erics-arc-for-chrome/uninstall.sh
```

It removes Chrome Launcher (app, login item, Dock icon), the mini player's registration with Chrome, this project's two Chrome App Shortcuts (your other App Shortcuts stay) and its Karabiner rule (Karabiner stays installed). Then remove the extension in `chrome://extensions` and quit and reopen Chrome.

## Test

```bash
npm install && npx playwright-core install chromium && npm test
```

`HEADFUL=1 npm test` also checks links from other apps, which headless Chromium can't receive.
