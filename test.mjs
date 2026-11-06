// Loads the extension into a throwaway Chromium and checks pinned-tab reset.
// Run: npm install && npx playwright-core install chromium && npm test
import { chromium } from 'playwright-core';
import http from 'node:http';
import assert from 'node:assert';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const ext = import.meta.dirname;
const server = http.createServer((req, res) => res.end(`<title>${req.url}</title>${req.url}`)).listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'arc-for-chrome-test-'));
const ctx = await chromium.launchPersistentContext(profile, {
  channel: 'chromium',
  headless: !process.env.HEADFUL,
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const settle = () => sw.evaluate(() => queue).then(() => sleep(300)).then(() => sw.evaluate(() => queue));
const pinnedUrls = () => sw.evaluate(async () => (await chrome.tabs.query({ pinned: true })).map(t => t.pendingUrl || t.url));
const open = (p, pinned = false) => sw.evaluate(async ([url, pinned]) => {
  const t = await chrome.tabs.create({ url });
  await new Promise(r => setTimeout(r, 300));
  if (pinned) await chrome.tabs.update(t.id, { pinned: true });
  return t.id;
}, [base + p, pinned]);
const go = (id, p) => sw.evaluate(([id, url]) => chrome.tabs.update(id, { url }), [id, base + p]).then(() => sleep(300));
const urlOf = id => sw.evaluate(async id => { const t = await chrome.tabs.get(id); return t.pendingUrl || t.url; }, id);
const call = (fn, id) => sw.evaluate(async ([fn, id]) => { await self[fn](await chrome.tabs.get(id)); }, [fn, id]);
const close = id => sw.evaluate(id => chrome.tabs.remove(id), id).then(settle);
const pageFor = async url => {
  for (let i = 0; i < 50; i++) {
    const p = ctx.pages().find(p => p.url().startsWith(url));
    if (p) return p;
    await sleep(100);
  }
  throw new Error('no page for ' + url);
};

const a = await open('/a', true);
const b = await open('/b', true);
await settle();

await go(a, '/a2');
await call('reset', a);
await sleep(300);
assert.equal(await urlOf(a), `${base}/a`);
console.log('reset after navigation: ok');

// Closing a pinned tab puts it back at its pinned URL in the same spot.
await go(a, '/a3');
await close(a);
assert.deepEqual(await pinnedUrls(), [`${base}/a`, `${base}/b`]);
console.log('close brings pinned tab back: ok');

// Simulated restart: session map forgotten, tabs have drifted, URLs come back from saved order.
const [a2, b2] = await sw.evaluate(async () => (await chrome.tabs.query({ pinned: true })).map(t => t.id));
await go(a2, '/x');
await go(b2, '/y');
await sw.evaluate(async () => { await queue; await chrome.storage.session.clear(); });
await call('reset', b2);
await sleep(300);
assert.equal(await urlOf(b2), `${base}/b`);
console.log('reset after simulated restart: ok');

// Replace pinned URL with current.
await call('repin', a2);
await go(a2, '/z');
await call('reset', a2);
await sleep(300);
assert.equal(await urlOf(a2), `${base}/x`);
console.log('repin: ok');

// Pinning a new tab records its own URL, not a neighbour's.
const c = await open('/c', true);
await settle();
await go(c, '/c2');
await call('reset', c);
await sleep(300);
assert.equal(await urlOf(c), `${base}/c`);
console.log('newly pinned tab keeps its own URL: ok');

// Unpinned tabs: reset does nothing, close really closes.
await sw.evaluate(id => chrome.tabs.update(id, { pinned: false }), c);
await settle();
await go(c, '/c3');
await call('reset', c);
await sleep(300);
assert.equal(await urlOf(c), `${base}/c3`);
await close(c);
assert.deepEqual(await pinnedUrls(), [`${base}/x`, `${base}/b`]);
console.log('unpinned tab ignored: ok');

// Locked tab group: tabs in "CoreCore" behave like pinned tabs. (New tabs open at the top, so g1,
// opened last, ends up first.)
const g2 = await open('/g2');
const g1 = await open('/g1');
await sw.evaluate(async ids => {
  const groupId = await chrome.tabs.group({ tabIds: ids });
  await chrome.tabGroups.update(groupId, { title: 'CoreCore', color: 'blue' });
}, [g1, g2]);
await settle();
const groupUrls = () => sw.evaluate(async () => {
  const [g] = await chrome.tabGroups.query({ title: 'CoreCore' });
  if (!g) return [];
  return (await chrome.tabs.query({ groupId: g.id })).map(t => t.pendingUrl || t.url);
});
await go(g1, '/g1-drift');
await close(g1);
assert.deepEqual(await groupUrls(), [`${base}/g1`, `${base}/g2`]);
console.log('closed group tab comes back in group: ok');

// ⌘W command closes the active tab through the extension; a locked one comes back.
await sw.evaluate(id => chrome.tabs.update(id, { active: true }), g2);
await go(g2, '/g2-drift');
await sw.evaluate(() => closeTabs());
await settle();
assert.deepEqual(await groupUrls(), [`${base}/g1`, `${base}/g2`]);
console.log('close command on group tab: ok');

// Closing every tab in the group brings the whole group back.
const groupIds = await sw.evaluate(async () => {
  const [g] = await chrome.tabGroups.query({ title: 'CoreCore' });
  return (await chrome.tabs.query({ groupId: g.id })).map(t => t.id);
});
await sw.evaluate(ids => chrome.tabs.remove(ids), groupIds);
await settle();
assert.deepEqual(await groupUrls(), [`${base}/g1`, `${base}/g2`]);
console.log('whole group comes back: ok');

// A tab dragged out of the group is a normal tab again.
const [out] = await sw.evaluate(async () => {
  const [g] = await chrome.tabGroups.query({ title: 'CoreCore' });
  return (await chrome.tabs.query({ groupId: g.id })).map(t => t.id);
});
await sw.evaluate(id => chrome.tabs.ungroup(id), out);
await settle();
await close(out);
assert.deepEqual(await groupUrls(), [`${base}/g2`]);
console.log('ungrouped tab really closes: ok');

// Order saved for the next launch, per slot.
assert.deepEqual((await sw.evaluate(() => chrome.storage.local.get('order'))).order,
  { pinned: [`${base}/x`, `${base}/b`], CoreCore: [`${base}/g2`] });
console.log('saved order: ok');

// New tabs open right under the locked tabs: pinned, then the CoreCore group.
const lastLockedIndex = () => sw.evaluate(async () => {
  const [g] = await chrome.tabGroups.query({ title: 'CoreCore' });
  const tabs = await chrome.tabs.query({ windowId: g.windowId });
  return Math.max(...tabs.filter(t => t.pinned || t.groupId === g.id).map(t => t.index));
});
const indexOf = id => sw.evaluate(async id => (await chrome.tabs.get(id)).index, id);
const n1 = await open('/n1');
await settle();
assert.equal(await indexOf(n1), (await lastLockedIndex()) + 1);
console.log('new tab opens under CoreCore: ok');

// A new tab that lands in CoreCore (a link opened from a CoreCore tab) is taken out and not locked.
const corePage = await pageFor(`${base}/g2`);
await corePage.bringToFront(); // Chrome records the active tab as a link's opener
await corePage.evaluate(url => { document.body.innerHTML = `<a href="${url}">go</a>`; }, `${base}/from-core`);
await corePage.click('a', { modifiers: ['Meta'] });
await settle();
const n2 = await sw.evaluate(async url => (await chrome.tabs.query({ url }))[0].id, `${base}/from-core`);
assert.equal(await sw.evaluate(async id => (await chrome.tabs.get(id)).groupId, n2), -1);
assert.equal(await indexOf(n2), (await lastLockedIndex()) + 1);
assert.deepEqual(await groupUrls(), [`${base}/g2`]);
console.log('new tab dropped into CoreCore is taken out: ok');

// A link opened in a new tab from a normal tab lands right after that tab, not at the top.
const n1Page = await pageFor(`${base}/n1`);
await n1Page.bringToFront();
await n1Page.evaluate(url => { document.body.innerHTML = `<a href="${url}">go</a>`; }, `${base}/from-n1`);
await n1Page.click('a', { modifiers: ['Meta'] });
await settle();
const n3 = await sw.evaluate(async url => (await chrome.tabs.query({ url }))[0].id, `${base}/from-n1`);
assert.equal(await indexOf(n3), (await indexOf(n1)) + 1);
console.log('link from a normal tab opens right after it: ok');

// ⌘T: Chrome gives the new tab an opener too, but a New Tab page still goes to the top.
const n4 = await sw.evaluate(async opener => (await chrome.tabs.create({ url: 'chrome://newtab/', openerTabId: opener })).id, n1);
await settle();
assert.equal(await indexOf(n4), (await lastLockedIndex()) + 1);
await sw.evaluate(ids => chrome.tabs.remove(ids), [n1, n2, n3, n4]);
await settle();
console.log('new tab page with an opener goes to the top: ok');

// Recent tabs. Karabiner sends recent-next for the first ⌃Tab after Control goes down, recent-continue
// for more ⌃Tabs while Control is held, recent-prev for ⌃⇧Tab.
const activate = id => sw.evaluate(id => chrome.tabs.update(id, { active: true }), id).then(() => sleep(50));
const active = () => sw.evaluate(async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0].id);
const command = name => sw.evaluate(async name => {
  const fn = { 'recent-next': () => recent(1, true), 'recent-continue': () => recent(1, false), 'recent-prev': () => recent(-1, false) }[name];
  await fn();
}, name);
const r1 = await open('/r1'), r2 = await open('/r2'), r3 = await open('/r3');
await activate(r1); await activate(r2); await activate(r3);
await command('recent-next'); // ⌃Tab, release
assert.equal(await active(), r2);
await command('recent-next'); // ⌃Tab again right away: back where we came from
assert.equal(await active(), r3);
console.log('ctrl+tab, release, ctrl+tab goes back: ok');
await command('recent-next'); // hold Control: ⌃Tab, ⌃Tab
await command('recent-continue');
assert.equal(await active(), r1);
await command('recent-prev'); // still holding: ⌃⇧Tab
assert.equal(await active(), r2);
console.log('holding control walks back, ctrl+shift+tab steps back: ok');

// From A, ⌃Tab ⌃Tab to C, release, ⌃Tab: back to A (the tab the walk passed through doesn't count).
const [tabA, tabB, tabC] = [r1, r2, r3];
await activate(tabC); await activate(tabB); await activate(tabA); // recent order: A, B, C
await sleep(1100);
await command('recent-next');
await command('recent-continue');
assert.equal(await active(), tabC);
await sleep(300);
await command('recent-next');
assert.equal(await active(), tabA);
console.log('walk A to C, release, ctrl+tab goes back to A: ok');

// Clicking a tab yourself counts as using it.
await activate(tabB);
await sleep(300);
await command('recent-next');
assert.equal(await active(), tabA);
console.log('clicked tab counts, ctrl+tab returns to the one before: ok');

// A link opened in a background tab is next: ⌃Tab goes to it, then ⌃Tab comes back.
const bg = await sw.evaluate(async () => (await chrome.tabs.create({ url: 'about:blank', active: false })).id);
await settle();
await command('recent-next');
assert.equal(await active(), bg);
await sleep(300);
await command('recent-next');
assert.equal(await active(), tabA);
await close(bg);
console.log('background tab is next for ctrl+tab: ok');

// Little Arc.
const littleWindows = () => sw.evaluate(async () => {
  const { little = {} } = await chrome.storage.session.get('little');
  const wins = await chrome.windows.getAll({ populate: true });
  return wins.filter(w => w.id in little).map(w => ({ id: w.id, type: w.type, urls: w.tabs.map(t => t.pendingUrl || t.url) }));
});

// ⌥⌘N: blank Little Arc with a search box; typing a URL goes there and the bar shows up.
await sw.evaluate(() => littleCommand('little-new'));
let [lw] = await littleWindows();
assert.equal(lw.type, 'popup');
assert.match(lw.urls[0], /little\.html$/);
const box = await pageFor(lw.urls[0]);
await box.fill('input', `${base}/little-typed`);
await box.press('input', 'Enter');
const typed = await pageFor(`${base}/little-typed`);
await typed.waitForSelector('#erics-little-arc-bar', { state: 'attached' });
console.log('little arc: new, type URL, bar shows: ok');

// ⌘L opens the address field with the URL selected; typing a new one and Enter goes there.
await typed.keyboard.press('Meta+l');
assert.equal(await typed.evaluate(() => getSelection().toString()), `${base}/little-typed`); // ready to ⌘C
await typed.keyboard.type(`${base}/little-cmd-l`);
await typed.keyboard.press('Enter');
await pageFor(`${base}/little-cmd-l`);
console.log('little arc: cmd+L address field: ok');

// ⌘O: moves the page into the main window as a normal tab; the Little Arc goes away.
const littleTab = await sw.evaluate(async id => (await chrome.tabs.query({ windowId: id }))[0].id, lw.id);
await sw.evaluate(id => moveToMain(id), littleTab);
await sleep(300);
assert.deepEqual(await littleWindows(), []);
assert.equal(await sw.evaluate(async id => (await chrome.windows.get((await chrome.tabs.get(id)).windowId)).type, littleTab), 'normal');
assert.equal(await indexOf(littleTab), (await lastLockedIndex()) + 1);
console.log('little arc: open in Chrome, lands under CoreCore: ok');

// ⌥⌘-click a link opens it in a Little Arc.
await go(await open('/with-link'), '/with-link');
const linkPage = await pageFor(`${base}/with-link`);
await linkPage.evaluate(url => { document.body.innerHTML = `<a href="${url}">go</a>`; }, `${base}/clicked`);
await linkPage.click('a', { modifiers: ['Alt', 'Meta'] });
await sleep(500);
[lw] = await littleWindows();
assert.deepEqual(lw.urls, [`${base}/clicked`]);
assert.equal(linkPage.url(), `${base}/with-link`);
console.log('little arc: alt-cmd-click: ok');

// Peek: a link from a locked tab that opens a new tab (target=_blank) becomes a Little Arc over the
// window, the locked page dimmed behind it; another window taking focus closes it and undims the page.
// The content script catches the click, so the page opens in the Peek directly: its tab has no opener.
const pinnedPage = await pageFor(`${base}/x`);
await pinnedPage.bringToFront();
const peekWindow = async url => (await littleWindows()).find(w => w.urls[0] === `${base}${url}`);
const dimmed = () => pinnedPage.evaluate(() => !!document.getElementById('erics-little-arc-dim'));
const waitFor = async check => { for (let i = 0; i < 30 && !(await check()); i++) await sleep(100); return check(); };
const openerOf = async url => sw.evaluate(async url => (await chrome.tabs.query({ url }))[0]?.openerTabId, `${base}${url}`);
const mainWindow = await sw.evaluate(async id => (await chrome.tabs.get(id)).windowId, a2);
const focusMain = async () => { await sw.evaluate(id => run(() => littleFocused(id)), mainWindow); await settle(); };

await pinnedPage.evaluate(url => { document.body.innerHTML = `<a href="${url}" target="_blank">go</a>`; }, `${base}/peeked`);
await pinnedPage.click('a');
assert.ok(await waitFor(() => peekWindow('/peeked')));
assert.equal((await peekWindow('/peeked')).type, 'popup');
assert.equal(await openerOf('/peeked'), undefined);
assert.equal(await sw.evaluate(async () => Object.keys((await chrome.storage.session.get('peek')).peek).length), 1);
assert.ok(await waitFor(dimmed));
await focusMain();
assert.equal(await peekWindow('/peeked'), undefined);
assert.equal(await dimmed(), false);
console.log('little arc: peek from a locked tab, closed by focus elsewhere: ok');

// window.open from the locked page's own script is caught the same way and returns null.
assert.equal(await pinnedPage.evaluate(url => window.open(url) === null, `${base}/peek-opened`), true);
assert.ok(await waitFor(() => peekWindow('/peek-opened')));
assert.equal(await openerOf('/peek-opened'), undefined);
await focusMain();
console.log('little arc: peek from window.open: ok');

// A new tab the content script didn't catch (here: made with an opener directly) still becomes a Peek,
// moved out of the main window.
const fallback = await sw.evaluate(async ([url, opener, windowId]) => (await chrome.tabs.create({ url, openerTabId: opener, windowId, active: true })).id, [`${base}/peek-fallback`, a2, mainWindow]);
assert.ok(await waitFor(() => peekWindow('/peek-fallback')));
assert.equal(await sw.evaluate(async id => (await chrome.tabs.query({ windowId: id }))[0].id, (await peekWindow('/peek-fallback')).id), fallback);
await focusMain();
assert.deepEqual((await littleWindows()).filter(w => w.urls[0].startsWith(`${base}/peek`)), []);
console.log('little arc: peek fallback for a tab Chrome already opened: ok');

// An unlocked tab's new-tab links are left to Chrome.
await sw.evaluate(id => chrome.tabs.update(id, { pinned: false }), a2);
await settle();
await pinnedPage.evaluate(url => { document.body.innerHTML = `<a href="${url}" target="_blank">go</a>`; }, `${base}/not-peeked`);
await pinnedPage.click('a');
await sleep(500);
assert.equal(await peekWindow('/not-peeked'), undefined);
assert.equal(await openerOf('/not-peeked'), a2);
await sw.evaluate(id => chrome.tabs.update(id, { pinned: true }), a2);
await settle();
console.log('little arc: no peek from an unpinned tab: ok');

// A page that finished loading before it moved into a Little Arc still gets the bar.
const loaded = await open('/already-loaded');
await sleep(300);
await sw.evaluate(id => openLittle({ tabId: id }), loaded);
await (await pageFor(`${base}/already-loaded`)).waitForSelector('#erics-little-arc-bar', { state: 'attached', timeout: 3000 });
await sw.evaluate(id => chrome.tabs.remove(id), loaded);
console.log('little arc: bar on an already-loaded page: ok');

// Left alone for 12 hours, it closes.
await sw.evaluate(async () => { await chrome.storage.session.set({ focused: -1 }); await archiveLittle(Date.now() + 13 * 3600e3); });
await sleep(300);
assert.deepEqual(await littleWindows(), []);
console.log('little arc: archived after 12 hours: ok');

// A link from another app (a second launch handing a URL to the running browser) opens in a Little Arc.
// Headless Chromium doesn't accept that hand-off, so this one needs HEADFUL=1.
if (process.env.HEADFUL) {
  spawn(chromium.executablePath(), [`--user-data-dir=${profile}`, `${base}/from-other-app`], { stdio: 'ignore', detached: true }).unref();
  for (let i = 0; i < 50 && !(await littleWindows()).length; i++) await sleep(100);
  [lw] = await littleWindows();
  assert.deepEqual(lw?.urls, [`${base}/from-other-app`]);
  console.log('little arc: link from another app: ok');
} else console.log('little arc: link from another app: skipped (run with HEADFUL=1)');

// Mini player: player/install.sh works out the extension's ID from its folder the way Chrome does.
const idFromPath = p => [...crypto.createHash('sha256').update(p).digest('hex').slice(0, 32)]
  .map(c => String.fromCharCode(97 + parseInt(c, 16))).join('');
assert.equal(await sw.evaluate(() => chrome.runtime.id), idFromPath(fs.realpathSync(ext)));
console.log('mini player: extension id from folder: ok');

// A music site's track reaches the player, and the player's buttons reach the site's handlers.
await ctx.route('https://open.spotify.com/**', route => route.fulfill({ contentType: 'text/html', body: `<script>
  navigator.mediaSession.metadata = new MediaMetadata({ title: 'Song', artist: 'Band', artwork: [{ src: '/small.png' }, { src: '/big.png' }] });
  navigator.mediaSession.setActionHandler('nexttrack', () => { document.title = 'next'; });
</script>` }));
const songPage = await ctx.newPage(); // (tabs the extension opens don't go through ctx.route)
await songPage.goto('https://open.spotify.com/');
const song = await sw.evaluate(async () => (await chrome.tabs.query({ url: 'https://open.spotify.com/*' }))[0].id);
for (let i = 0; i < 50 && !(await sw.evaluate(id => music.has(id), song)); i++) await sleep(100);
const state = await sw.evaluate(() => playerState());
assert.deepEqual([state.title, state.artist, state.artwork], ['Song', 'Band', 'https://open.spotify.com/big.png']);
await sw.evaluate(() => playerAction({ action: 'nexttrack' }));
await songPage.waitForFunction(() => document.title === 'next', null, { timeout: 3000 });
// Shows while you're on another tab with the sidebar open; × hides it until you've been back on the
// music tab. (Headless Chromium has no sidebar and won't move focus, so the focused window is faked.)
const onTab = id => sw.evaluate(async id => {
  chrome.windows.getLastFocused = async () => ({ type: 'normal', state: 'normal', left: 0, top: 0, width: 1200, height: 800,
    tabs: [{ id, active: true, width: 950 }] });
  return (await playerState()).show;
}, id);
assert.equal(await onTab(-1), true);
await sw.evaluate(() => playerAction({ action: 'close' }));
assert.equal(await onTab(-1), false);
assert.equal(await onTab(song), false); // on the music tab: never shown
assert.equal(await onTab(-1), true);
await close(song);
assert.equal(await sw.evaluate(id => music.has(id), song), false);
console.log('mini player: track info and buttons: ok');

// The helper (if built: player/install.sh) reads a message that arrives in pieces, stays up, and quits
// when Chrome closes the connection.
const helper = path.join(ext, 'player/ArcPlayer');
if (fs.existsSync(helper)) {
  const p = spawn(helper, [], { stdio: ['pipe', 'ignore', 'inherit'] });
  const body = Buffer.from(JSON.stringify({ show: false, title: 'Song' }));
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length);
  const frame = Buffer.concat([header, body]);
  p.stdin.write(frame.subarray(0, 2));
  await sleep(200);
  p.stdin.write(frame.subarray(2));
  await sleep(500);
  assert.equal(p.exitCode, null);
  p.stdin.end();
  assert.equal(await new Promise(r => p.on('exit', r)), 0);
  console.log('mini player: helper reads messages, quits with Chrome: ok');
} else console.log('mini player: helper: skipped (run player/install.sh)');

await ctx.close();
server.close();
fs.rmSync(profile, { recursive: true, force: true });
