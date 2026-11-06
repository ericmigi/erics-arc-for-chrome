// Clicks the extension takes before Chrome does. ⌥⌘-click a link opens it in a Little Arc. In a locked
// tab (pinned or CoreCore) a plain click on a link that would open a new tab opens a Peek instead,
// straight from the URL, so no tab passes through the main window first. The locked flag comes from
// the background: asked once at load, pushed again when the tab is pinned, unpinned or changes group.
// It's also put on <html> for little-open.js, which runs in the page's world and wraps window.open.
(() => {
  let locked = false;
  const setLocked = value => {
    locked = !!value;
    document.documentElement.toggleAttribute('data-erics-arc-locked', locked);
  };
  chrome.runtime.sendMessage({ little: 'locked?' }).then(setLocked).catch(() => {});
  chrome.runtime.onMessage.addListener(msg => { if (msg.little === 'locked') setLocked(msg.value); });

  addEventListener('click', e => {
    const a = e.target.closest?.('a[href]');
    if (!a || !/^https?:/.test(a.href)) return;
    const plain = e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
    const target = a.target || document.querySelector('base[target]')?.target;
    let little;
    if (e.altKey && e.metaKey) little = 'open';
    else if (locked && plain && target === '_blank') little = 'peek';
    else return;
    e.preventDefault();
    e.stopImmediatePropagation();
    chrome.runtime.sendMessage({ little, url: a.href });
  }, true);

  // window.open in a locked tab, relayed from the page's world by little-open.js.
  addEventListener('message', e => {
    if (e.source === window && typeof e.data?.ericsArcPeek === 'string') chrome.runtime.sendMessage({ little: 'peek', url: e.data.ericsArcPeek });
  });
})();
