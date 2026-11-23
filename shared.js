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

  // Where a header check finds its value.
  const HEADER_FROM = {
    contains: 'URL contains',
    after: 'path part after',
    before: 'path part before',
    regex: 'regex',
  };

  // Font sizes of the in-page label and its header, in px.
  const MIN_SIZE = 8;
  const MAX_SIZE = 24;
  // Earlier versions picked a named size: px for the label, relative to the label for the header.
  const OLD_SIZES = { small: 11, medium: 12, large: 15, xlarge: 19 };
  const OLD_HEADER_SIZES = { xsmall: 0.7, small: 0.8, same: 1 };

  function fontSize(value, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return fallback;
    return Math.min(MAX_SIZE, Math.max(MIN_SIZE, Math.round(n)));
  }

  const PILL_CSS = `
.pill{display:inline-flex;align-items:center;box-sizing:border-box;font:600 12px/1 system-ui,-apple-system,"Segoe UI",sans-serif;
  padding:.42em .85em;white-space:nowrap;letter-spacing:.02em;box-shadow:0 1px 4px rgba(0,0,0,.35);transition:opacity .15s}
.pill.square{border-radius:.25em}
.pill.round{border-radius:999px}
.pill.arrow{padding:.42em 1.35em;box-shadow:none;
  clip-path:polygon(.85em 0,calc(100% - .85em) 0,100% 50%,calc(100% - .85em) 100%,.85em 100%,0 50%)}
.pill.two{flex-direction:column;align-items:flex-start;gap:.3em;line-height:1.1}
.pill.two.arrow{align-items:center}
.pill .sub{font-weight:400}
`;

  function newId() {
    return crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
  }

  const flag = (value, fallback) => (value === undefined ? fallback : !!value);
  // Shown text is trimmed with runs of spaces collapsed, like browsers do with tab titles.
  const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
  const isObject = (r) => r && typeof r === 'object' && !Array.isArray(r);

  function normalizeTextCheck(t = {}) {
    return {
      matchType: t.matchType === 'regex' ? 'regex' : 'contains',
      pattern: String(t.pattern ?? ''),
      text: clean(t.text),
    };
  }

  function normalizeHeaderCheck(c = {}) {
    return {
      from: HEADER_FROM[c.from] ? c.from : 'after',
      pattern: String(c.pattern ?? ''),
      text: clean(c.text),
    };
  }

  // The header is a second, smaller line read from the URL, e.g. the topic name on a topic page.
  function normalizeHeader(hd = {}, labelSize = 12) {
    const p = hd.placements || {};
    return {
      enabled: !!hd.enabled,
      checks: (Array.isArray(hd.checks) ? hd.checks : []).filter(isObject).map(normalizeHeaderCheck),
      placements: { title: flag(p.title, true), page: flag(p.page, true) },
      look: normalizeHeaderLook(hd.look, labelSize),
    };
  }

  function normalizeHeaderLook(l = {}, labelSize = 12) {
    return {
      textColor: /^#[0-9a-f]{6}$/i.test(l.textColor) ? l.textColor.toLowerCase() : '', // '' = automatic
      size: fontSize(l.size, fontSize(labelSize * (OLD_HEADER_SIZES[l.size] ?? 0.8), 10)),
      italic: flag(l.italic, true),
    };
  }

  function normalizeRule(r = {}) {
    const p = r.placements || {};
    const pageSize = fontSize(r.pageSize, OLD_SIZES[r.pageSize] ?? 12);
    return {
      id: typeof r.id === 'string' && r.id ? r.id : newId(),
      name: String(r.name ?? ''),
      enabled: r.enabled !== false,
      matchType: r.matchType === 'regex' ? 'regex' : 'contains',
      pattern: String(r.pattern ?? ''),
      caseSensitive: !!r.caseSensitive,
      // `displayName` is the version 1 name for the default text.
      defaultText: clean(r.defaultText ?? r.displayName),
      texts: (Array.isArray(r.texts) ? r.texts : []).filter(isObject).map(normalizeTextCheck),
      shape: SHAPES[r.shape] ? r.shape : 'square',
      color: /^#[0-9a-f]{6}$/i.test(r.color) ? r.color.toLowerCase() : '#d93025',
      placements: {
        title: flag(p.title, false),
        favicon: flag(p.favicon, true),
        badge: flag(p.badge, true),
        page: flag(p.page, false),
      },
      pagePosition: POSITIONS[r.pagePosition] ? r.pagePosition : 'bottom-left',
      // Drop the site's own tab title, keeping only the label and/or header. Briefly lived under `header`.
      replaceTitle: !!(r.replaceTitle ?? r.header?.replaceTitle),
      textColor: /^#[0-9a-f]{6}$/i.test(r.textColor) ? r.textColor.toLowerCase() : '', // '' = automatic
      pageSize,
      header: normalizeHeader(r.header, pageSize),
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

  function normalizeEnvGroup(g = {}) {
    return {
      id: typeof g.id === 'string' && g.id ? g.id : newId(),
      name: String(g.name ?? ''),
      keepPath: g.keepPath !== false,
      envs: (Array.isArray(g.envs) ? g.envs : [])
        .filter(isObject)
        .map((e) => ({ name: String(e.name ?? ''), template: String(e.template ?? '').trim() })),
    };
  }

  function normalizeState(data = {}) {
    const rules = Array.isArray(data.rules) ? data.rules : Array.isArray(data.looks) ? migrateV2(data) : [];
    const envGroups = Array.isArray(data.envGroups) ? data.envGroups : [];
    return {
      rules: rules.filter(isObject).map(normalizeRule),
      envGroups: envGroups.filter(isObject).map(normalizeEnvGroup),
    };
  }

  function hasPlacement(rule) {
    const hd = rule.header;
    return Object.values(rule.placements).some(Boolean) || (hd.enabled && (hd.placements.title || hd.placements.page));
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

  const decode = (s) => {
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  };

  // Also accepts an address typed without "https://", like "example.com/a".
  function parseUrl(url) {
    for (const s of [url, `https://${url}`]) {
      try {
        const u = new URL(s);
        if (u.hostname) return u;
      } catch {}
    }
    return null;
  }

  // The value a header check finds in the URL, or null. "contains" finds the pattern itself.
  // "after"/"before" look for the pattern as whole parts of the address ("all-topics",
  // "clusters/local" or "example.com/app") and take the part next to it. The host (without
  // "www.") counts as the first part, and a hash route like "#/topics/x" as part of the path.
  function headerValue(check, caseSensitive, url) {
    if (check.from === 'regex' || check.from === 'contains') return find(check.from, check.pattern, caseSensitive, url);
    const u = parseUrl(url);
    if (!u) return null;
    const norm = (s) => (caseSensitive ? s : s.toLowerCase());
    const noWww = (s) => s.replace(/^www\./i, '');
    const hashPath = u.hash.startsWith('#/') ? u.hash.slice(1).split('?')[0] : '';
    const parts = [noWww(u.hostname), ...(u.pathname + hashPath).split('/').filter(Boolean).map(decode)];
    const want = check.pattern.split('/').filter(Boolean).map(norm);
    if (want.length) want[0] = noWww(want[0]);
    if (!want.length) return null;
    for (let i = 0; i + want.length <= parts.length; i++) {
      if (!want.every((w, j) => norm(parts[i + j]) === w)) continue;
      const value = check.from === 'after' ? parts[i + want.length] : parts[i - 1];
      if (value) return value;
    }
    return null;
  }

  // "TOPIC:" + "X" → "TOPIC: X". `{}` places the value somewhere else: "{} (API)".
  function fillHeader(text, value) {
    if (!text) return value;
    return text.includes('{}') ? text.replaceAll('{}', value) : `${text} ${value}`;
  }

  // Picks the header for a URL. `check` is the index of the header check used, or -1 for none.
  function pickHeader(rule, url) {
    if (!rule.header.enabled) return { text: '', check: -1 };
    for (let i = 0; i < rule.header.checks.length; i++) {
      const c = rule.header.checks[i];
      const value = headerValue(c, rule.caseSensitive, url);
      if (!value) continue;
      // "contains" shows its text as is; the value is just the pattern.
      const text = c.from === 'contains' ? c.text.trim() || value : fillHeader(c.text.trim(), value);
      return { text: text.trim(), check: i };
    }
    return { text: '', check: -1 };
  }

  function makeLabel(rule, text, header = '') {
    return {
      name: rule.name,
      displayName: text,
      header,
      headerPlacements: rule.header.placements,
      headerLook: rule.header.look,
      replaceTitle: rule.replaceTitle,
      shape: rule.shape,
      color: rule.color,
      placements: rule.placements,
      pagePosition: rule.pagePosition,
      textColor: rule.textColor,
      pageSize: rule.pageSize,
    };
  }

  // First enabled rule that matches the URL and ends up with some text.
  function resolve(state, url) {
    for (const rule of state.rules) {
      if (!matches(rule, url)) continue;
      const { text, check } = pickText(rule, url);
      if (text) return { rule, check, label: makeLabel(rule, text, pickHeader(rule, url).text) };
    }
    return null;
  }

  // ---- Environment switcher ----
  // An environment template is a host, optionally followed by a path prefix, where `*` marks the
  // part that stays the same: "*.example.com" or "example.com/staging/*". Everything after the
  // template (rest of the path, query, hash) is kept when switching.

  const escapeRe = (s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  const wildcard = (s) => s.split('*').map(escapeRe).join('([^/]*?)');

  function matchTemplate(template, url) {
    let u;
    try {
      u = new URL(url);
    } catch {
      return null;
    }
    if (!template || !/^https?:$/.test(u.protocol)) return null;
    const slash = template.indexOf('/');
    const hostPart = slash < 0 ? template : template.slice(0, slash);
    const pathPart = slash < 0 ? '' : template.slice(slash);

    // "dr.dk" also matches "www.dr.dk".
    const hostRe = new RegExp(`^${wildcard(hostPart)}$`, 'i');
    const host = hostRe.exec(u.host) || hostRe.exec(u.host.replace(/^www\./i, ''));
    if (!host) return null;
    const parts = host.slice(1);
    let rest = u.pathname + u.search + u.hash;
    if (pathPart) {
      // A trailing * in the path takes a whole segment.
      const path = new RegExp(`^${wildcard(pathPart).replace(/\(\[\^\/\]\*\?\)$/, '([^/]*)')}`, 'i').exec(rest);
      if (!path) return null;
      parts.push(...path.slice(1));
      rest = rest.slice(path[0].length);
    }
    return { parts, rest, protocol: u.protocol };
  }

  function fillTemplate(template, match, keepPath = true) {
    let i = 0;
    let target = template.replace(/\*/g, () => match.parts[i++] ?? '');
    let rest = keepPath ? match.rest : '';
    if (!rest && !target.includes('/')) rest = '/';
    if (rest && !rest.startsWith('/') && !target.endsWith('/') && !/^[?#]/.test(rest)) rest = `/${rest}`;
    if (target.endsWith('/') && rest.startsWith('/')) rest = rest.slice(1);
    return `${match.protocol}//${target}${rest}`;
  }

  // For each switcher group the URL belongs to: the current environment and the URL of every environment.
  function envSwitches(state, url) {
    const out = [];
    for (const group of state.envGroups || []) {
      const current = group.envs.findIndex((e) => matchTemplate(e.template, url));
      if (current < 0) continue;
      const match = matchTemplate(group.envs[current].template, url);
      out.push({
        group,
        current,
        targets: group.envs.map((e, i) => ({
          name: e.name,
          url: i === current ? url : fillTemplate(e.template, match, group.keepPath),
          current: i === current,
        })),
      });
    }
    return out;
  }

  function chars(s, n) {
    return Array.from(s).slice(0, n).join('');
  }

  function titlePrefix(label) {
    const s = SHAPES[label.shape];
    return `${s.open}${label.displayName}${s.close} `;
  }

  // The tab title for a page whose own title is `base`: "[PROD] TOPIC: X · base".
  // With replaceTitle the site's title is dropped, as long as the label or header is left to show.
  function composeTitle(label, base) {
    const prefix = label.placements.title ? titlePrefix(label) : '';
    const header = label.headerPlacements.title ? label.header : '';
    const own = label.replaceTitle && (prefix || header) ? '' : base;
    if (!header) return own ? prefix + own : prefix.trim();
    return prefix + header + (own ? ` · ${own}` : '');
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
    ctx.fillStyle = labelTextColor(label);
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

  // The label's own text color, or black/white for contrast when it's automatic.
  function labelTextColor(label) {
    return label.textColor || textColor(label.color);
  }

  // `sized` applies the in-page font size (the in-page label itself); other uses keep the default size.
  function fillPill(el, label, sized = false) {
    const header = label.headerPlacements?.page ? label.header : '';
    el.className = `pill ${label.shape}${header ? ' two' : ''}`;
    if (header) {
      const main = document.createElement('span');
      main.textContent = label.displayName;
      const sub = document.createElement('span');
      sub.textContent = header;
      styleHeader(sub, label);
      el.replaceChildren(main, sub);
    } else {
      el.textContent = label.displayName;
    }
    el.style.background = label.color;
    el.style.color = labelTextColor(label);
    el.style.fontSize = sized ? `${label.pageSize}px` : '';
  }

  // The header's own text color, or grey when it's automatic: light grey on dark label colors,
  // dark grey on light ones so it stays readable.
  function headerTextColor(label) {
    const look = label.headerLook || normalizeHeaderLook();
    return look.textColor || (textColor(label.color) === '#ffffff' ? '#d0d0d0' : '#555555');
  }

  function styleHeader(el, label) {
    const look = label.headerLook || normalizeHeaderLook();
    el.className = 'sub';
    // Relative to the label, so it scales along wherever the label is shown at another size.
    el.style.fontSize = `${(look.size / (label.pageSize || 12)).toFixed(3)}em`;
    el.style.fontStyle = look.italic ? 'italic' : 'normal';
    el.style.color = headerTextColor(label);
  }

  async function loadState() {
    return normalizeState(await chrome.storage.local.get(['rules', 'envGroups', 'looks', 'texts']));
  }

  async function saveState(state) {
    const s = normalizeState(state);
    await chrome.storage.local.set({ rules: s.rules, envGroups: s.envGroups });
    await chrome.storage.local.remove(['looks', 'texts']);
  }

  function buildExport(state) {
    return JSON.stringify(
      {
        format: 'url-labeler',
        version: 3,
        exportedAt: new Date().toISOString(),
        rules: state.rules,
        envGroups: state.envGroups,
      },
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
    if (!isObject(data) || !['rules', 'looks', 'envGroups'].some((k) => Array.isArray(data[k]))) {
      throw new Error('No labels or environment switchers found in the file.');
    }
    return normalizeState(data);
  }

  // Items with the same id are replaced, new ones are added.
  function mergeState(current, incoming) {
    const merge = (a, b) => {
      const out = [...a];
      for (const item of b) {
        const i = out.findIndex((x) => x.id === item.id);
        if (i >= 0) out[i] = item;
        else out.push(item);
      }
      return out;
    };
    return {
      rules: merge(current.rules, incoming.rules),
      envGroups: merge(current.envGroups, incoming.envGroups),
    };
  }

  return {
    SHAPES, PLACEMENTS, POSITIONS, MIN_SIZE, MAX_SIZE, HEADER_FROM, PILL_CSS,
    newId, normalizeRule, normalizeTextCheck, normalizeHeaderCheck, normalizeEnvGroup, normalizeState, matchTemplate, envSwitches, hasPlacement, regexError, find, matches, pickText, pickHeader,
    makeLabel, resolve, titlePrefix, composeTitle, badgeText, iconText, textColor, labelTextColor, headerTextColor, drawIcon, iconImageData, faviconDataUrl, fillPill,
    loadState, saveState, buildExport, parseImport, mergeState,
  };
})();
