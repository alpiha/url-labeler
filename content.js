(() => {
  const PILL_ID = 'url-labeler-pill';
  const FAVICON_ID = 'url-labeler-favicon';
  const root = document.documentElement;

  let state = UL.normalizeState();
  let label = null;
  // Kept on the page so a re-injected script (after an extension reload) can strip the old prefix.
  let titlePrefix = root.dataset.urlLabelerPrefix || '';
  let lastUrl = location.href;
  let favicon = { key: '', url: '' };
  let pillHost = null;

  // After the extension is reloaded, this old copy of the script must stop touching the page.
  const alive = () => !!chrome.runtime?.id;

  function shutdown() {
    observer.disconnect();
    clearInterval(timer);
    document.removeEventListener('mousemove', trackMouse, { capture: true });
    document.documentElement.removeEventListener('mouseleave', trackMouse);
    window.removeEventListener('keydown', trackKeys, { capture: true });
    window.removeEventListener('keyup', trackKeys, { capture: true });
  }

  // ---- Tab title -------------------------------------------------------

  function setPrefix(prefix) {
    const title = document.title;
    const base = titlePrefix && title.startsWith(titlePrefix) ? title.slice(titlePrefix.length) : title;
    titlePrefix = prefix;
    if (prefix) root.dataset.urlLabelerPrefix = prefix;
    else delete root.dataset.urlLabelerPrefix;
    if (document.title !== prefix + base) document.title = prefix + base;
  }

  // Sites like YouTube rewrite their title constantly; put the prefix back each time.
  function enforceTitle() {
    if (titlePrefix && !document.title.startsWith(titlePrefix)) document.title = titlePrefix + document.title;
  }

  // ---- Favicon ---------------------------------------------------------

  function faviconUrl() {
    const key = [label.shape, label.color, UL.iconText(label)].join('|');
    if (favicon.key !== key) favicon = { key, url: UL.faviconDataUrl(label) };
    return favicon.url;
  }

  function enforceFavicon() {
    let link = document.getElementById(FAVICON_ID);

    if (!label?.placements.favicon) {
      link?.remove();
      document.querySelectorAll('link[data-url-labeler-rel]').forEach((l) => {
        l.rel = l.dataset.urlLabelerRel;
        delete l.dataset.urlLabelerRel;
      });
      return;
    }

    // Disable the site's own icons so Chrome uses ours.
    document.querySelectorAll(`link[rel~="icon" i]:not(#${FAVICON_ID})`).forEach((l) => {
      l.dataset.urlLabelerRel = l.rel;
      l.rel = 'x-url-labeler-disabled';
    });

    if (!link) {
      link = document.createElement('link');
      link.id = FAVICON_ID;
      link.rel = 'icon';
      link.type = 'image/png';
    }
    const href = faviconUrl();
    if (link.getAttribute('href') !== href) link.setAttribute('href', href);
    const head = document.head || root;
    if (link.parentNode !== head) head.appendChild(link);
  }

  // ---- In-page label ---------------------------------------------------

  function enforcePill() {
    if (!label?.placements.page) {
      pillHost?.remove();
      document.getElementById(PILL_ID)?.remove();
      return;
    }

    if (!pillHost) {
      document.getElementById(PILL_ID)?.remove(); // left behind by a previous instance
      pillHost = document.createElement('div');
      pillHost.id = PILL_ID;
      pillHost.attachShadow({ mode: 'open' }).innerHTML =
        `<style>${UL.PILL_CSS}${MENU_CSS}</style>` +
        `<div class="wrap"><span class="pill"></span><div class="menu"></div></div>`;
    }

    const [v, h] = label.pagePosition.split('-');
    // pointer-events:none lets clicks reach the page underneath (e.g. a navigation bar).
    // It's switched on only while the switch menu is open.
    pillHost.style.cssText =
      `all:initial!important;position:fixed!important;z-index:2147483647!important;` +
      `pointer-events:${menuOpen ? 'auto' : 'none'}!important;${v}:8px!important;${h}:8px!important;`;
    pillHost.shadowRoot.querySelector('.wrap').className = `wrap ${v} ${h}${menuOpen ? ' open' : ''}`;
    UL.fillPill(pillHost.shadowRoot.querySelector('.pill'), label, true);
    if (!pillHost.isConnected) root.appendChild(pillHost);
  }

  // ---- Switch menu (Ctrl + hover over the in-page label) ---------------

  const MENU_CSS = `
.wrap{display:flex;gap:6px;font:12px/1.3 system-ui,-apple-system,"Segoe UI",sans-serif}
.wrap.top{flex-direction:column}.wrap.bottom{flex-direction:column-reverse}
.wrap.left{align-items:flex-start}.wrap.right{align-items:flex-end}
.pill.faded{opacity:.15}
.menu{display:none;min-width:160px;max-width:300px;padding:8px 10px;border-radius:8px;
  background:#202124;color:#e8eaed;box-shadow:0 4px 18px rgba(0,0,0,.45)}
.wrap.open .menu{display:block}
.menu p{margin:0 0 4px;color:#9aa0a6;font-size:11px}
.menu .row{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px}
.menu button{all:initial;box-sizing:border-box;font:600 12px/1 system-ui,-apple-system,"Segoe UI",sans-serif;
  padding:6px 10px;border-radius:4px;cursor:pointer;background:#3c4043;color:#e8eaed}
.menu button:hover{filter:brightness(1.2)}
.menu button[disabled]{cursor:default;filter:none;outline:2px solid #e8eaed;outline-offset:1px}
.menu .hint{margin:0;color:#9aa0a6;font-size:10px}
`;

  let menuOpen = false;
  let ctrlHeld = false;

  function switchTo(url, newTab) {
    // New tabs open in the background next to this one, like the toolbar popup does.
    if (newTab) chrome.runtime.sendMessage({ type: 'openTab', url }).catch(() => window.open(url, '_blank', 'noopener'));
    else location.href = url;
  }

  function renderMenu(switches) {
    const menu = pillHost.shadowRoot.querySelector('.menu');
    menu.replaceChildren();
    for (const sw of switches) {
      const heading = document.createElement('p');
      heading.textContent = sw.group.name;
      const row = document.createElement('div');
      row.className = 'row';
      for (const target of sw.targets) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = target.name;
        btn.title = target.url;
        btn.disabled = target.current;
        const targetLabel = UL.resolve(state, target.url)?.label;
        if (targetLabel) {
          btn.style.background = targetLabel.color;
          btn.style.color = UL.labelTextColor(targetLabel);
        }
        btn.addEventListener('click', (e) => switchTo(target.url, e.ctrlKey || e.metaKey || e.shiftKey));
        btn.addEventListener('auxclick', (e) => e.button === 1 && switchTo(target.url, true));
        row.append(btn);
      }
      menu.append(heading, row);
    }
    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.textContent = 'Click to switch · Ctrl-click or middle-click for a new tab';
    menu.append(hint);
  }

  function setMenuOpen(open) {
    if (open === menuOpen || !pillHost) return;
    if (open) {
      const switches = UL.envSwitches(state, location.href);
      if (!switches.length) return;
      renderMenu(switches);
    }
    menuOpen = open;
    enforcePill();
  }

  // The label can't receive hover events (it lets clicks through), so watch the mouse position:
  // near the label it fades, and with Ctrl held it opens the switch menu. The menu stays open
  // until the mouse moves away from it.
  const NEAR_MARGIN = 12;
  let mouse = null;
  let hoverFrame = 0;

  function updateHover() {
    hoverFrame = 0;
    if (!pillHost?.isConnected) return;
    const wrap = pillHost.shadowRoot.querySelector('.wrap');
    const pill = wrap.querySelector('.pill');
    const r = (menuOpen ? wrap : pill).getBoundingClientRect();
    const near =
      !!mouse &&
      mouse.x >= r.left - NEAR_MARGIN && mouse.x <= r.right + NEAR_MARGIN &&
      mouse.y >= r.top - NEAR_MARGIN && mouse.y <= r.bottom + NEAR_MARGIN;

    if (menuOpen && !near) setMenuOpen(false);
    else if (!menuOpen && near && ctrlHeld) setMenuOpen(true);
    pill.classList.toggle('faded', near && !menuOpen);
  }

  function scheduleHover() {
    if (!hoverFrame) hoverFrame = requestAnimationFrame(updateHover);
  }

  function trackMouse(e) {
    if (!pillHost) return;
    mouse = e.type === 'mouseleave' ? null : { x: e.clientX, y: e.clientY };
    ctrlHeld = e.ctrlKey || e.metaKey;
    scheduleHover();
  }

  function trackKeys(e) {
    if (!pillHost) return;
    if (e.key === 'Escape' && e.type === 'keydown') return setMenuOpen(false);
    if (e.key !== 'Control' && e.key !== 'Meta') return;
    ctrlHeld = e.type === 'keydown';
    scheduleHover();
  }

  document.addEventListener('mousemove', trackMouse, { passive: true, capture: true });
  document.documentElement.addEventListener('mouseleave', trackMouse, { passive: true });
  window.addEventListener('keydown', trackKeys, { capture: true });
  window.addEventListener('keyup', trackKeys, { capture: true });
  window.addEventListener('blur', () => (ctrlHeld = false));

  // ---- Wiring ----------------------------------------------------------

  function update() {
    menuOpen = false; // its buttons belong to the previous URL or settings
    label = UL.resolve(state, location.href)?.label || null;
    const prefix = label?.placements.title ? UL.titlePrefix(label) : '';
    if (prefix !== titlePrefix) setPrefix(prefix);
    else enforceTitle();
    enforceFavicon();
    enforcePill();
  }

  const observer = new MutationObserver(() => {
    if (!alive()) return shutdown();
    if (!label) return;
    enforceTitle();
    enforceFavicon();
  });
  observer.observe(document.head || root, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['rel', 'href'],
  });

  // Catches single-page-app navigation (pushState) and a removed in-page label.
  const timer = setInterval(() => {
    if (!alive()) return shutdown();
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      update();
    } else if (label?.placements.page && !pillHost?.isConnected) {
      enforcePill();
    }
  }, 500);

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !(changes.rules || changes.looks) || !alive()) return;
    UL.loadState().then((s) => {
      state = s;
      update();
    });
  });

  UL.loadState().then((s) => {
    state = s;
    update();
  });
})();
