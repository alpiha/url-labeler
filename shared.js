// Shared helpers used by the background worker, content script, options page and popup.
// Declared with `var` so re-injecting the script into a tab doesn't throw.
//
// A rule matches a URL (contains / regex) and decides how the label looks and where it's shown.
// Its text comes from the first matching entry in `texts`, or `defaultText` if none match.
// Rules are checked in order; the first rule that matches and has some text wins.
var UL = (() => {
  const SHAPES = {
    square: { label: 'Square', open: '[', close: ']' },
    round: { label: 'Round', open: '(', close: ')' },
    arrow: { label: 'Arrow', open: '‹', close: '›' },
  };

  const PLACEMENTS = {
    title: 'Tab title',
    favicon: 'Tab icon',
    badge: 'Toolbar badge',
    page: 'In-page label',
  };

  const POSITIONS = {
    'top-left': 'Top left',
    'top-right': 'Top right',
    'bottom-left': 'Bottom left',
    'bottom-right': 'Bottom right',
  };

  const PILL_CSS = `
.pill{display:inline-flex;align-items:center;box-sizing:border-box;font:600 12px/1 system-ui,-apple-system,"Segoe UI",sans-serif;
  padding:5px 10px;white-space:nowrap;letter-spacing:.02em;box-shadow:0 1px 4px rgba(0,0,0,.35);transition:opacity .15s}
.pill.square{border-radius:3px}
.pill.round{border-radius:999px}
.pill.arrow{padding:5px 16px;box-shadow:none;
  clip-path:polygon(10px 0,calc(100% - 10px) 0,100% 50%,calc(100% - 10px) 100%,10px 100%,0 50%)}
`;

  function newId() {
    return crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
  }

  const flag = (value, fallback) => (value === undefined ? fallback : !!value);
  const isObject = (r) => r && typeof r === 'object' && !Array.isArray(r);

  function normalizeTextCheck(t = {}) {
    return {
      matchType: t.matchType === 'regex' ? 'regex' : 'contains',
      pattern: String(t.pattern ?? ''),
      text: String(t.text ?? ''),
    };
  }

  function normalizeRule(r = {}) {
    const p = r.placements || {};
    return {
      id: typeof r.id === 'string' && r.id ? r.id : newId(),
      name: String(r.name ?? ''),
      enabled: r.enabled !== false,
      matchType: r.matchType === 'regex' ? 'regex' : 'contains',
      pattern: String(r.pattern ?? ''),
      caseSensitive: !!r.caseSensitive,
      // `displayName` is the version 1 name for the default text.
      defaultText: String(r.defaultText ?? r.displayName ?? ''),
      texts: (Array.isArray(r.texts) ? r.texts : []).filter(isObject).map(normalizeTextCheck),
      shape: SHAPES[r.shape] ? r.shape : 'square',
      color: /^#[0-9a-f]{6}$/i.test(r.color) ? r.color.toLowerCase() : '#d93025',
      placements: {
        title: flag(p.title, true),
        favicon: flag(p.favicon, false),
        badge: flag(p.badge, true),
        page: flag(p.page, false),
      },
      pagePosition: POSITIONS[r.pagePosition] ? r.pagePosition : 'bottom-left',
    };
  }

  // Version 2 split rules into separate `looks` and `texts` lists. Each look becomes a rule
  // with every text copied in as a text check.
  function migrateV2(data) {
    const texts = (Array.isArray(data.texts) ? data.texts : [])
      .filter((t) => isObject(t) && t.enabled !== false)
      .map((t) => ({ matchType: t.matchType, pattern: t.pattern, text: t.displayName }));
    return (Array.isArray(data.looks) ? data.looks : [])
      .filter((l) => isObject(l) && l.id !== 'default')
      .map((l) => ({ ...l, defaultText: l.label ?? '', texts }));
  }

  function normalizeState(data = {}) {
    const rules = Array.isArray(data.rules) ? data.rules : Array.isArray(data.looks) ? migrateV2(data) : [];
    return { rules: rules.filter(isObject).map(normalizeRule) };
  }

  function hasPlacement(rule) {
    return Object.values(rule.placements).some(Boolean);
  }

  function regexError(pattern) {
    try {
      new RegExp(pattern);
      return null;
    } catch (e) {
      return e.message;
    }
  }

  // Returns the matched text (regex: first capture group, else the whole match), or null.
  function find(matchType, pattern, caseSensitive, url) {
    if (!pattern) return null;
    if (matchType === 'regex') {
      try {
        const m = new RegExp(pattern, caseSensitive ? '' : 'i').exec(url);
        return m ? m[1] ?? m[0] : null;
      } catch {
        return null;
      }
    }
    const hit = caseSensitive ? url.includes(pattern) : url.toLowerCase().includes(pattern.toLowerCase());
    return hit ? pattern : null;
  }

  function matches(rule, url) {
    return rule.enabled && find(rule.matchType, rule.pattern, rule.caseSensitive, url) !== null;
  }

  // Picks the label text for a URL. `check` is the index of the text check used, or -1 for the default text.
  function pickText(rule, url) {
    for (let i = 0; i < rule.texts.length; i++) {
      const t = rule.texts[i];
      const found = find(t.matchType, t.pattern, rule.caseSensitive, url);
      if (found !== null) return { text: (t.text || found).trim(), check: i };
    }
    return { text: rule.defaultText.trim(), check: -1 };
  }

  function makeLabel(rule, text) {
    return {
      name: rule.name,
      displayName: text,
      shape: rule.shape,
      color: rule.color,
      placements: rule.placements,
      pagePosition: rule.pagePosition,
    };
  }

  // First enabled rule that matches the URL and ends up with some text.
  function resolve(state, url) {
    for (const rule of state.rules) {
      if (!matches(rule, url)) continue;
      const { text, check } = pickText(rule, url);
      if (text) return { rule, check, label: makeLabel(rule, text) };
    }
    return null;
  }

  function chars(s, n) {
    return Array.from(s).slice(0, n).join('');
  }

  function titlePrefix(label) {
    const s = SHAPES[label.shape];
    return `${s.open}${label.displayName}${s.close} `;
  }

  function badgeText(label) {
    return chars(label.displayName, 4);
  }

  function iconText(label) {
    return chars(label.displayName.trim(), 2);
  }

  function textColor(hex) {
    const n = parseInt(hex.slice(1), 16);
    const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255];
    return 0.299 * r + 0.587 * g + 0.114 * b > 160 ? '#000000' : '#ffffff';
  }

  function shapePath(ctx, shape, x, y, w, h) {
    ctx.beginPath();
    if (shape === 'round') {
      ctx.roundRect(x, y, w, h, Math.min(w, h) / 2);
    } else if (shape === 'arrow') {
      const t = Math.min(w * 0.28, h / 2);
      ctx.moveTo(x, y + h / 2);
      ctx.lineTo(x + t, y);
      ctx.lineTo(x + w - t, y);
      ctx.lineTo(x + w, y + h / 2);
      ctx.lineTo(x + w - t, y + h);
      ctx.lineTo(x + t, y + h);
      ctx.closePath();
    } else {
      ctx.roundRect(x, y, w, h, Math.max(1, h * 0.12));
    }
  }

  // Draws the label's shape filling the canvas, optionally with a short text on top.
  function drawIcon(ctx, size, label, text = '') {
    ctx.clearRect(0, 0, size, size);
    shapePath(ctx, label.shape, 0, 0, size, size);
    ctx.fillStyle = label.color;
    ctx.fill();
    if (!text) return;

    const maxWidth = size * (label.shape === 'arrow' ? 0.56 : label.shape === 'round' ? 0.74 : 0.88);
    let fontSize = size * 0.62;
    ctx.font = `bold ${fontSize}px system-ui, "Segoe UI", sans-serif`;
    const width = ctx.measureText(text).width;
    if (width > maxWidth) {
      fontSize *= maxWidth / width;
      ctx.font = `bold ${fontSize}px system-ui, "Segoe UI", sans-serif`;
    }
    ctx.fillStyle = textColor(label.color);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, size / 2, size / 2 + fontSize * 0.06);
  }

  function makeCanvas(size) {
    if (typeof document !== 'undefined') {
      const c = document.createElement('canvas');
      c.width = c.height = size;
      return c;
    }
    return new OffscreenCanvas(size, size);
  }

  // Toolbar icon: the shape only, the badge carries the text.
  function iconImageData(label) {
    const out = {};
    for (const size of [16, 32]) {
      const ctx = makeCanvas(size).getContext('2d');
      drawIcon(ctx, size, label);
      out[size] = ctx.getImageData(0, 0, size, size);
    }
    return out;
  }

  function faviconDataUrl(label) {
    const canvas = makeCanvas(64);
    drawIcon(canvas.getContext('2d'), 64, label, iconText(label));
    return canvas.toDataURL('image/png');
  }

  function fillPill(el, label) {
    el.className = `pill ${label.shape}`;
    el.textContent = label.displayName;
    el.style.background = label.color;
    el.style.color = textColor(label.color);
  }

  async function loadState() {
    return normalizeState(await chrome.storage.local.get(['rules', 'looks', 'texts']));
  }

  async function saveState(state) {
    await chrome.storage.local.set({ rules: normalizeState(state).rules });
    await chrome.storage.local.remove(['looks', 'texts']);
  }

  function buildExport(state) {
    return JSON.stringify(
      { format: 'url-labeler', version: 3, exportedAt: new Date().toISOString(), rules: state.rules },
      null,
      2
    );
  }

  // Accepts exports from any version, or a bare array of rules.
  function parseImport(text) {
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error('The file is not valid JSON.');
    }
    if (Array.isArray(data)) data = { rules: data };
    if (!isObject(data) || !(Array.isArray(data.rules) || Array.isArray(data.looks))) {
      throw new Error('No rules found in the file.');
    }
    return normalizeState(data);
  }

  // Rules with the same id are replaced, new ones are added.
  function mergeState(current, incoming) {
    const rules = [...current.rules];
    for (const rule of incoming.rules) {
      const i = rules.findIndex((r) => r.id === rule.id);
      if (i >= 0) rules[i] = rule;
      else rules.push(rule);
    }
    return { rules };
  }

  return {
    SHAPES, PLACEMENTS, POSITIONS, PILL_CSS,
    newId, normalizeRule, normalizeTextCheck, normalizeState, hasPlacement, regexError, find, matches, pickText,
    makeLabel, resolve, titlePrefix, badgeText, iconText, textColor, drawIcon, iconImageData, faviconDataUrl, fillPill,
    loadState, saveState, buildExport, parseImport, mergeState,
  };
})();
