// Arc-style locked tabs. A tab is locked when it's pinned or sits in one of LOCKED_GROUPS; it
// remembers the URL it had when it got locked. Closing it (⌘W, middle-click) puts it back at that
// URL in the same spot; ⌃R or the toolbar button resets it in place. Unpin it or drag it out of the
// group first to really close it.
//
// ⌘W is taken over by this extension so it closes tabs itself: Chrome's own ⌘W on a pinned tab
// shows a "press ⌘W again" toast first, and there's no setting to turn that off.
//
// Tab and group ids don't survive a browser restart, so locked URLs are also saved per slot
// ('pinned', or the group title) in tab order. During the first minute of a browser session
// (or after the extension reloads) a locked tab we haven't seen takes the URL saved at its position
// in its slot; after that, a newly locked tab takes its own current URL.
// ponytail: position matching assumes Chrome restores tabs in the same order across all windows;
// closing a window that has locked tabs and then quitting can shift URLs by one.
// "Replace pinned URL with current" or re-locking fixes a wrong one.

// ponytail: hardcoded; add an options page when there's a second group to lock.
const LOCKED_GROUPS = ['CoreCore'];

// Every read-modify-write goes through this queue so overlapping tab events can't clobber each other.
let queue = Promise.resolve();
const run = fn => (queue = queue.then(fn).catch(console.error));

async function lockedTabs() {
  const groups = await chrome.tabGroups.query({});
  const locked = new Map(groups.filter(g => LOCKED_GROUPS.includes(g.title)).map(g => [g.id, g]));
  const tabs = await chrome.tabs.query({});
  return {
    ids: new Set(tabs.map(t => t.id)),
    locked: tabs.filter(t => t.pinned || locked.has(t.groupId))
      .map(t => ({ t, group: t.pinned ? null : locked.get(t.groupId) })),
  };
}

// Entries for closed tabs are kept (onRemoved still needs them if it runs after this) and dropped
// by onRemoved itself; session storage is wiped on restart anyway.
async function sync(change) {
  let { pins = {}, where = {}, restoreUntil } = await chrome.storage.session.get(['pins', 'where', 'restoreUntil']);
  restoreUntil ??= Date.now() + 60_000; // session storage is empty: browser just started or extension reloaded
  const restoring = Date.now() < restoreUntil;
  let { order = {} } = await chrome.storage.local.get('order');
  if (Array.isArray(order)) order = { pinned: order }; // saved before groups were supported
  change?.(pins);
  const { ids, locked } = await lockedTabs();
  const next = {};
  for (const { t, group } of locked) {
    const slot = group ? group.title : 'pinned';
    next[slot] ??= [];
    pins[t.id] ??= (restoring && order[slot]?.[next[slot].length]) || t.url;
    next[slot].push(pins[t.id]);
    where[t.id] = { windowId: t.windowId, index: t.index, group: group?.title, color: group?.color };
  }
  const lockedIds = new Set(locked.map(({ t }) => t.id));
  for (const id in pins) if (ids.has(+id) && !lockedIds.has(+id)) delete pins[id];
  await chrome.storage.session.set({ pins, where, restoreUntil });
  await chrome.storage.local.set({ order: next });
  return pins;
}

const resync = () => run(() => sync());
chrome.runtime.onStartup.addListener(resync);
chrome.runtime.onInstalled.addListener(resync);
chrome.tabs.onMoved.addListener(resync);
chrome.tabs.onAttached.addListener(resync);
chrome.tabGroups.onUpdated.addListener(resync);

chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (!('pinned' in change) && !('groupId' in change)) return;
  run(async () => {
    // Chrome also reports pinned:false / ungrouped just before closing a tab; that's not a real unlock.
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) return;
    const group = tab.groupId === -1 ? null : await chrome.tabGroups.get(tab.groupId);
    const isLocked = tab.pinned || LOCKED_GROUPS.includes(group?.title);
    await sync(p => { if (isLocked) p[tabId] ??= tab.url || tab.pendingUrl; else delete p[tabId]; });
    // The tab's content script (little-click.js) catches new-tab links in locked tabs; it asks once per
    // page load and hears about changes here. (A group renamed to or from CoreCore isn't pushed; those
    // tabs fall back to the tab-then-Peek path until they reload.)
    chrome.tabs.sendMessage(tabId, { little: 'locked', value: isLocked }).catch(() => {});
  });
});

chrome.tabs.onRemoved.addListener((tabId, { isWindowClosing }) => {
  if (isWindowClosing) return; // window closed or Chrome quitting: keep the saved order for next launch
  run(async () => {
    const { pins = {}, where = {} } = await chrome.storage.session.get(['pins', 'where']);
    const url = pins[tabId], at = where[tabId];
    delete where[tabId];
    await chrome.storage.session.set({ where });
    if (!url || !at) return sync(p => { delete p[tabId]; });
    recreating++;
    try {
      const tab = await chrome.tabs.create({ url, pinned: !at.group, active: false, windowId: at.windowId, index: at.index });
      if (at.group) {
        const [g] = await chrome.tabGroups.query({ windowId: at.windowId, title: at.group });
        const groupId = await chrome.tabs.group(g ? { groupId: g.id, tabIds: tab.id } : { tabIds: tab.id, createProperties: { windowId: at.windowId } });
        if (!g) await chrome.tabGroups.update(groupId, { title: at.group, color: at.color });
      }
      await sync(p => { delete p[tabId]; p[tab.id] = url; });
    } finally {
      recreating--;
    }
  });
});

// New tabs open at the top of the tab list, just under the locked tabs (pinned, then the CoreCore
// group), like Arc's Today list. A tab opened from a link in a normal tab stays where Chrome puts
// it, right after that tab. One opened in the background from a locked tab goes to the top, and if
// Chrome dropped it into the locked group it's taken out, so it doesn't get locked; one opened in the
// foreground from a locked tab becomes a Peek (little-arc.js). Tabs in other groups are left alone.
const STARTUP_GRACE_MS = 5000; // session restore recreates every tab; leave those where they are
let browserStarted = 0;
let recreating = 0; // locked tabs we're putting back stay where they're put
chrome.runtime.onStartup.addListener(() => { browserStarted = Date.now(); });
const starting = () => browserStarted && Date.now() - browserStarted < STARTUP_GRACE_MS;

async function isLocked(tabId) {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab || tab.pinned) return !!tab;
  return tab.groupId !== -1 && LOCKED_GROUPS.includes((await chrome.tabGroups.get(tab.groupId)).title);
}

async function topIndex(windowId, exceptTabId) {
  const groups = await chrome.tabGroups.query({ windowId });
  const locked = new Set(groups.filter(g => LOCKED_GROUPS.includes(g.title)).map(g => g.id));
  const tabs = await chrome.tabs.query({ windowId });
  return tabs.filter(t => t.id !== exceptTabId && (t.pinned || locked.has(t.groupId)))
    .reduce((top, t) => Math.max(top, t.index + 1), 0);
}

chrome.tabs.onCreated.addListener(created => {
  if (recreating || created.pinned || starting()) return;
  run(async () => {
    const tab = await chrome.tabs.get(created.id).catch(() => null);
    if (!tab || tab.pinned) return;
    if ((await chrome.windows.get(tab.windowId)).type !== 'normal') return;
    // Chrome records an opener for ⌘T too; only a link (not the New Tab page) stays by its opener.
    const newTabPage = /^chrome:\/\/new-?tab/.test(created.pendingUrl || created.url);
    if (tab.openerTabId && !newTabPage && !(await isLocked(tab.openerTabId))) return;
    if (tab.openerTabId && !newTabPage && tab.active) { // queues its own run(): don't wait for it inside this one
      openPeek({ tabId: tab.id }, { id: tab.openerTabId, windowId: tab.windowId }).catch(console.error);
      return;
    }
    if (tab.groupId !== -1) {
      if (!LOCKED_GROUPS.includes((await chrome.tabGroups.get(tab.groupId)).title)) return;
      await chrome.tabs.ungroup(tab.id);
    }
    const index = await topIndex(tab.windowId, tab.id);
    if (tab.index !== index) await chrome.tabs.move(tab.id, { index });
  });
});

function reset(tab) {
  return run(async () => {
    const url = (await sync())[tab.id];
    if (url && tab.url !== url) await chrome.tabs.update(tab.id, { url });
  });
}

function repin(tab) {
  return run(() => sync(p => { if (p[tab.id]) p[tab.id] = tab.url; }));
}

async function closeTabs() {
  const tabs = await chrome.tabs.query({ highlighted: true, currentWindow: true });
  await chrome.tabs.remove(tabs.map(t => t.id));
}

// Recent tabs, Arc-style: ⌃Tab walks through tabs in every window, most recently used first, for as
// long as Control is held; letting go of Control ends the walk, so the next ⌃Tab goes back to the tab
// you came from. Chrome won't give extensions the Tab key or tell them when Control is released, so
// Karabiner (karabiner/ctrl-tab.json) sends:
//   ⌃.  first ⌃Tab since Control went down: start a new walk (recent-next)
//   ⌃⇧. more ⌃Tabs with Control still held: keep walking (recent-continue)
//   ⌃,  ⌃⇧Tab: walk back one step (recent-prev)
// The order is our own most-recently-used list (newest first, in session storage), not Chrome's
// lastAccessed: tabs a walk passes through don't count as used, only the one it ends on does. So
// A → B → C, release, ⌃Tab goes back to A, not B. Tabs we haven't seen yet fall back to lastAccessed.
let walk = null; // { list, i, visited }

async function mruList() {
  const { mru = [] } = await chrome.storage.session.get('mru');
  const tabs = await chrome.tabs.query({});
  const known = mru.filter(id => tabs.some(t => t.id === id));
  const rest = tabs.filter(t => !known.includes(t.id)).sort((a, b) => b.lastAccessed - a.lastAccessed);
  return [...known, ...rest.map(t => t.id)];
}

async function touch(tabId, at = 0) {
  const list = (await mruList()).filter(id => id !== tabId);
  list.splice(at, 0, tabId);
  await chrome.storage.session.set({ mru: list });
}

// A walk ends when the next one starts or you go to a tab some other way; only then does the tab it
// ended on count as used.
async function endWalk() {
  if (!walk) return;
  const last = walk.list[walk.i];
  walk = null;
  await touch(last);
}

function recent(step, fresh) {
  return run(async () => {
    if (fresh || !walk) {
      await endWalk();
      walk = { list: await mruList(), i: 0, visited: new Set() };
    }
    walk.i = (walk.i + step + walk.list.length) % walk.list.length;
    const id = walk.list[walk.i];
    walk.visited.add(id);
    walk.at = Date.now();
    const tab = await chrome.tabs.update(id, { active: true }).catch(() => null);
    if (tab) await chrome.windows.update(tab.windowId, { focused: true });
  });
}

function activated(tabId) {
  return run(async () => {
    // The walk's own moves arrive a moment after each step; a later click on one of those tabs is yours.
    if (walk?.visited.has(tabId) && Date.now() - walk.at < 1000) return;
    await endWalk();
    await touch(tabId);
  });
}

chrome.tabs.onActivated.addListener(({ tabId }) => activated(tabId));
// A tab opened in the background (right-click ▸ Open Link in New Tab, ⌘-click) goes right after the
// current tab, so the next ⌃Tab goes to it. Locked tabs we put back and restored tabs don't.
chrome.tabs.onCreated.addListener(tab => {
  if (tab.active || recreating || starting()) return;
  run(async () => {
    await endWalk(); // so the tab you're on is first in the list
    await touch(tab.id, 1);
  });
});
chrome.windows.onFocusChanged.addListener(async windowId => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  const [tab] = await chrome.tabs.query({ active: true, windowId });
  if (tab) activated(tab.id);
});

importScripts('little-arc.js', 'player.js');

chrome.action.onClicked.addListener(reset);

chrome.commands.onCommand.addListener((command, tab) => {
  if (command.startsWith('little-')) return littleCommand(command);
  if (command === 'recent-next') return recent(1, true);
  if (command === 'recent-continue') return recent(1, false);
  if (command === 'recent-prev') return recent(-1, false);
  if (command === 'close-tab') return closeTabs();
  if (command === 'reset-tab') return reset(tab);
  if (command === 'repin-current') return repin(tab);
});
