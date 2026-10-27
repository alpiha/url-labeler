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
        `<style>${UL.PILL_CSS}.pill:hover{opacity:.15}</style><span class="pill"></span>`;
    }

    const [v, h] = label.pagePosition.split('-');
    pillHost.style.cssText =
      `all:initial!important;position:fixed!important;z-index:2147483647!important;` +
      `${v}:8px!important;${h}:8px!important;`;
    UL.fillPill(pillHost.shadowRoot.querySelector('.pill'), label);
    pillHost.title = `URL Labeler: ${label.name || label.displayName}`;
    if (!pillHost.isConnected) root.appendChild(pillHost);
  }

  // ---- Wiring ----------------------------------------------------------

  function update() {
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
