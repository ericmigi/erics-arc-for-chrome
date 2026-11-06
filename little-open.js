// Runs in the page's own world so it can wrap the page's window.open. In a locked tab (little-click.js
// marks <html> with data-erics-arc-locked) a window.open that would make a new tab becomes a Peek,
// passed back to little-click.js with postMessage. It returns null, as a blocked popup would; a site
// that opens a blank window and sets its location later isn't caught here and gets a real tab, which
// then becomes a Peek the slow way (through the main window).
(() => {
  const pageOpen = window.open;
  window.open = function (url, target, features) {
    if ((!target || target === '_blank') && !features && url && document.documentElement.hasAttribute('data-erics-arc-locked')) {
      let href = null;
      try { href = new URL(String(url), location.href).href; } catch {}
      if (href && /^https?:/.test(href)) {
        postMessage({ ericsArcPeek: href }, '*');
        return null;
      }
    }
    return pageOpen.apply(this, arguments);
  };
})();
