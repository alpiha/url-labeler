const $ = (sel, el = document) => el.querySelector(sel);

function h(tag, props = {}, ...children) {
  const el = Object.assign(document.createElement(tag), props);
  el.append(...children.filter((c) => c != null));
  return el;
}

document.head.append(h('style', { textContent: UL.PILL_CSS }));

const form = $('#form');
const f = form.elements;
const editor = $('#editor');
let state = { rules: [], envGroups: [] };
let editingId = null; // null = new label
let pendingImport = null;

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function persist() {
  return UL.saveState(state);
}

// Text to show for a rule when there's no URL to pick it from.
function sampleText(rule) {
  const t = rule.texts[0];
  return rule.defaultText || t?.text || t?.pattern || rule.name || 'Label';
}

// ---- List --------------------------------------------------------------

function render() {
  $('#list').replaceChildren(...state.rules.map(renderRow));
  $('#empty').hidden = state.rules.length > 0;
  runMainTest();
  renderSwitchers(); // options-env.js
}

function renderRow(rule, i) {
  const pill = h('span');
  UL.fillPill(pill, UL.makeLabel(rule, sampleText(rule)));

  const chips = h('div', { className: 'chips' });
  for (const [key, label] of Object.entries(UL.PLACEMENTS)) {
    if (rule.placements[key]) chips.append(h('span', { className: 'chip', textContent: label }));
  }
  if (rule.texts.length) chips.append(h('span', { className: 'chip', textContent: plural(rule.texts.length, 'text check') }));
  if (rule.header.enabled) chips.append(h('span', { className: 'chip', textContent: 'Header' }));
  const badRegex =
    [rule, ...rule.texts].some((r) => r.matchType === 'regex' && UL.regexError(r.pattern)) ||
    (rule.header.enabled && rule.header.checks.some((c) => c.from === 'regex' && UL.regexError(c.pattern)));
  if (badRegex) chips.append(h('span', { className: 'chip bad', textContent: 'Invalid regex' }));
  if (!UL.hasPlacement(rule)) {
    chips.append(
      h('span', { className: 'chip bad', textContent: 'Not shown anywhere' }),
      h('button', { type: 'button', className: 'link danger', textContent: 'Delete it?', onclick: () => deleteRule(rule.id) })
    );
  }

  const toggle = h('input', {
    type: 'checkbox',
    checked: rule.enabled,
    title: 'Enabled',
    onchange: (e) => {
      rule.enabled = e.target.checked;
      persist();
    },
  });

  return h(
    'li',
    { className: 'rule' + (rule.enabled ? '' : ' disabled') },
    h('label', { className: 'switch' }, toggle),
    h('div', { className: 'rule-pill' }, pill),
    h(
      'div',
      { className: 'rule-info' },
      h('strong', { textContent: rule.name || '(unnamed)' }),
      h('code', { textContent: `${rule.matchType}: ${rule.pattern}` }),
      chips
    ),
    h(
      'div',
      { className: 'rule-actions' },
      h('button', { type: 'button', textContent: '↑', title: 'Move up', disabled: i === 0, onclick: () => move(i, -1) }),
      h('button', { type: 'button', textContent: '↓', title: 'Move down', disabled: i === state.rules.length - 1, onclick: () => move(i, 1) }),
      h('button', { type: 'button', textContent: 'Edit', onclick: () => openEditor(rule) }),
      h('button', { type: 'button', textContent: 'Delete', className: 'danger', onclick: () => deleteRule(rule.id) })
    )
  );
}

function move(i, dir) {
  const r = state.rules;
  [r[i], r[i + dir]] = [r[i + dir], r[i]];
  persist();
  render();
}

function deleteRule(id) {
  const rule = state.rules.find((r) => r.id === id);
  if (!rule || !confirm(`Delete the label "${rule.name || sampleText(rule)}"?`)) return false;
  state.rules = state.rules.filter((r) => r.id !== id);
  persist();
  render();
  return true;
}

function setResult(el, kind, ...content) {
  el.hidden = !kind;
  el.className = `test-result ${kind || ''}`;
  el.replaceChildren(...content);
}

function runMainTest() {
  const url = $('#testUrl').value.trim();
  const out = $('#testResult');
  if (!url) return setResult(out, null);
  const res = UL.resolve(state, url);
  if (!res) return setResult(out, 'no', '✗ No label for this URL');
  const pill = h('span');
  UL.fillPill(pill, res.label);
  setResult(out, 'ok', '✓ ', pill, ` from "${res.rule.name}"`);
}

// ---- Editor: text checks -----------------------------------------------

function addCheckRow(check = UL.normalizeTextCheck()) {
  const row = $('#checkRow').content.firstElementChild.cloneNode(true);
  $('.ck-text', row).value = check.text;
  $('.ck-type', row).value = check.matchType;
  $('.ck-pattern', row).value = check.pattern;
  wireRow(row);
  $('#checks').append(row);
  return row;
}

function addHeaderRow(check = UL.normalizeHeaderCheck()) {
  const row = $('#headerRow').content.firstElementChild.cloneNode(true);
  $('.ck-type', row).append(
    ...Object.entries(UL.HEADER_FROM).map(([key, label]) => h('option', { value: key, textContent: label }))
  );
  $('.ck-text', row).value = check.text;
  $('.ck-type', row).value = check.from;
  $('.ck-pattern', row).value = check.pattern;
  wireRow(row);
  $('#headerChecks').append(row);
  return row;
}

// Move up / down / remove buttons of a text or header check row.
function wireRow(row) {
  $('.ck-up', row).onclick = () => {
    row.previousElementSibling?.before(row);
    refreshEditor();
  };
  $('.ck-down', row).onclick = () => {
    row.nextElementSibling?.after(row);
    refreshEditor();
  };
  $('.ck-remove', row).onclick = () => {
    row.remove();
    refreshEditor();
  };
}

$('#addCheck').onclick = () => {
  $('.ck-pattern', addCheckRow()).focus();
  refreshEditor();
};

$('#addHeaderCheck').onclick = () => {
  $('.ck-pattern', addHeaderRow()).focus();
  refreshEditor();
};

// Turning the header on for the first time gives an empty row to fill in.
f.headerEnabled.addEventListener('change', () => {
  if (f.headerEnabled.checked && !headerRows().length) addHeaderRow();
});

const checkRows = () => [...$('#checks').children];
const headerRows = () => [...$('#headerChecks').children];

// Pattern inputs of check rows that are empty or hold an invalid regex.
const badPatterns = (rows) =>
  rows
    .map((row) => [$('.ck-type', row).value, $('.ck-pattern', row)])
    .filter(([type, input]) => !input.value.trim() || (type === 'regex' && UL.regexError(input.value)))
    .map(([, input]) => input);

// ---- Editor ------------------------------------------------------------

// Each option is a preview of the shape.
const shapeOptions = (name) =>
  Object.entries(UL.SHAPES).map(([key, s]) =>
    h(
      'label',
      { className: 'shape-opt', title: s.label },
      h('input', { type: 'radio', name, value: key }),
      h('span', { className: 'frame' }, h('span', { className: `pill ${key}`, textContent: s.label }))
    )
  );

function buildEditorControls() {
  $('#shapes').replaceChildren(...shapeOptions('shape'));
  f.headerSize.replaceChildren(
    ...Object.entries(UL.HEADER_SIZES).map(([key, s]) => h('option', { value: key, textContent: s.label }))
  );
  $('#placements').replaceChildren(
    ...Object.entries(UL.PLACEMENTS).map(([key, label]) =>
      h('label', {}, h('input', { type: 'checkbox', name: `pl-${key}` }), ` ${label}`)
    )
  );
  f.pagePosition.replaceChildren(
    ...Object.entries(UL.POSITIONS).map(([key, label]) => h('option', { value: key, textContent: label }))
  );
  f.pageSize.replaceChildren(
    ...Object.entries(UL.SIZES).map(([key, s]) => h('option', { value: key, textContent: s.label }))
  );
}

function openEditor(rule, isNew = false) {
  editingId = isNew ? null : rule.id;
  $('#editorTitle').textContent = isNew ? 'New label' : `Edit: ${rule.name}`;
  $('#deleteBtn').hidden = isNew;

  f.name.value = rule.name;
  f.matchType.value = rule.matchType;
  f.pattern.value = rule.pattern;
  f.caseSensitive.checked = rule.caseSensitive;
  f.defaultText.value = rule.defaultText;
  $('#checks').replaceChildren();
  rule.texts.forEach((t) => addCheckRow(t));
  f.headerEnabled.checked = rule.header.enabled;
  $('#headerChecks').replaceChildren();
  rule.header.checks.forEach((c) => addHeaderRow(c));
  f.headerTitle.checked = rule.header.placements.title;
  f.headerPage.checked = rule.header.placements.page;
  const look = rule.header.look;
  f.headerAutoTextColor.checked = !look.textColor;
  f.headerTextColor.value = look.textColor || UL.headerTextColor({ color: rule.color });
  f.headerSize.value = look.size;
  f.headerItalic.checked = look.italic;
  f.replaceTitle.checked = rule.replaceTitle;
  f.shape.value = rule.shape;
  f.color.value = rule.color;
  f.autoTextColor.checked = !rule.textColor;
  f.textColor.value = rule.textColor || UL.textColor(rule.color);
  f.pageSize.value = rule.pageSize;
  for (const key of Object.keys(UL.PLACEMENTS)) f[`pl-${key}`].checked = rule.placements[key];
  f.pagePosition.value = rule.pagePosition;
  f.enabled.checked = rule.enabled;
  f.testUrl.value = $('#testUrl').value;
  form.querySelectorAll('.invalid').forEach((el) => el.classList.remove('invalid'));

  refreshEditor();
  editor.showModal();
  f.name.focus();
}

function readForm() {
  const placements = {};
  for (const key of Object.keys(UL.PLACEMENTS)) placements[key] = f[`pl-${key}`].checked;
  return UL.normalizeRule({
    id: editingId ?? 'new',
    name: f.name.value.trim(),
    matchType: f.matchType.value,
    pattern: f.pattern.value.trim(),
    caseSensitive: f.caseSensitive.checked,
    defaultText: f.defaultText.value.trim(),
    texts: checkRows().map((row) => ({
      text: $('.ck-text', row).value.trim(),
      matchType: $('.ck-type', row).value,
      pattern: $('.ck-pattern', row).value.trim(),
    })),
    header: {
      enabled: f.headerEnabled.checked,
      checks: headerRows().map((row) => ({
        text: $('.ck-text', row).value.trim(),
        from: $('.ck-type', row).value,
        pattern: $('.ck-pattern', row).value.trim(),
      })),
      placements: { title: f.headerTitle.checked, page: f.headerPage.checked },
      look: {
        textColor: f.headerAutoTextColor.checked ? '' : f.headerTextColor.value,
        size: f.headerSize.value,
        italic: f.headerItalic.checked,
      },
    },
    replaceTitle: f.replaceTitle.checked,
    shape: f.shape.value,
    color: f.color.value,
    textColor: f.autoTextColor.checked ? '' : f.textColor.value,
    pageSize: f.pageSize.value,
    placements,
    pagePosition: f.pagePosition.value,
    enabled: f.enabled.checked,
  });
}

// Header to show for a rule when there's no URL to read it from.
function sampleHeader(rule) {
  const c = rule.header.checks[0];
  if (!rule.header.enabled || !c) return '';
  if (c.from === 'contains') return c.text || c.pattern;
  return c.text.includes('{}') ? c.text.replaceAll('{}', 'value') : `${c.text} value`.trim();
}

// Runs the URL in the test box through the label being edited and explains the result.
function testEditor(rule, url) {
  const out = $('#editorTest');
  const sample = { text: sampleText(rule), header: sampleHeader(rule), check: null, headerCheck: null };
  if (!url) {
    setResult(out, 'muted', 'Paste a URL above to check whether this label matches it.');
    return { ...sample, matched: null };
  }
  if (!UL.find(rule.matchType, rule.pattern, rule.caseSensitive, url)) {
    setResult(out, 'no', `✗ No match. The URL doesn't ${rule.matchType === 'regex' ? 'match' : 'contain'} "${rule.pattern}", so this label won't show.`);
    return { ...sample, matched: false };
  }

  const { text, check } = UL.pickText(rule, url);
  if (!text) {
    setResult(out, 'no', '✗ The URL matches, but no text check matches and there is no default text, so no label is shown.');
    return { ...sample, matched: false };
  }

  const source = check >= 0 ? `text check ${check + 1}` : 'default text';
  const parts = ['✓ Matches. Shows ', h('strong', { textContent: text }), ` (${source}).`];
  const header = UL.pickHeader(rule, url);
  if (rule.header.enabled) {
    if (header.text) parts.push(' Header: ', h('strong', { textContent: header.text }), ` (header check ${header.check + 1}).`);
    else parts.push(' No header check finds a value in this URL, so there is no header.');
  }
  if (!rule.enabled) parts.push(' The label is disabled, though.');

  // Another label higher up in the list might win for this URL.
  const others = state.rules.map((r) => (r.id === editingId ? rule : r));
  if (editingId === null) others.push(rule);
  const winner = UL.resolve({ rules: others }, url);
  if (rule.enabled && winner && winner.rule !== rule) parts.push(` But "${winner.rule.name}" is higher in the list and wins.`);

  setResult(out, 'ok', ...parts);
  return { text, check, header: header.text, headerCheck: header.check, matched: true };
}

const HEADER_PLACEHOLDERS = { contains: '/drtv', after: 'all-topics', before: 'swagger-ui', regex: '/topics/([^/]+)' };

function refreshEditor() {
  const rule = readForm();
  const url = f.testUrl.value.trim();

  const err = rule.matchType === 'regex' && rule.pattern ? UL.regexError(rule.pattern) : null;
  $('#patternError').hidden = !err;
  $('#patternError').textContent = err ? `Invalid regex: ${err}` : '';

  checkRows().forEach((row, i) => {
    const type = $('.ck-type', row).value;
    const pattern = $('.ck-pattern', row);
    $('.ck-text', row).placeholder = pattern.value.trim() || 'matched text';
    pattern.classList.toggle('invalid', type === 'regex' && !!pattern.value && !!UL.regexError(pattern.value));
    $('.ck-up', row).disabled = i === 0;
    $('.ck-down', row).disabled = !row.nextElementSibling;
  });
  headerRows().forEach((row, i) => {
    const type = $('.ck-type', row).value;
    const pattern = $('.ck-pattern', row);
    pattern.placeholder = HEADER_PLACEHOLDERS[type];
    pattern.classList.toggle('invalid', type === 'regex' && !!pattern.value && !!UL.regexError(pattern.value));
    $('.ck-up', row).disabled = i === 0;
    $('.ck-down', row).disabled = !row.nextElementSibling;
  });
  $('#headerBody').hidden = !rule.header.enabled;
  // The header's display row stays put, greyed out while the header is off.
  $('#headerDisplay').classList.toggle('off', !rule.header.enabled);
  $('#headerDisplay').querySelectorAll('input').forEach((el) => (el.disabled = !rule.header.enabled));
  // Only offered while something else is put in the tab title.
  f.replaceTitle.disabled = !rule.placements.title && !(rule.header.enabled && rule.header.placements.title);

  $('#positionRow').hidden = !rule.placements.page;
  // While automatic, the swatch shows (and later starts from) the automatic color.
  f.textColor.disabled = f.autoTextColor.checked;
  if (f.autoTextColor.checked) f.textColor.value = UL.textColor(rule.color);
  form.querySelectorAll('#shapes .pill').forEach((p) => {
    p.style.background = rule.color;
    p.style.color = UL.labelTextColor(rule);
  });

  // Automatic header text color is grey, light or dark depending on the label color.
  f.headerTextColor.disabled = f.headerAutoTextColor.checked;
  if (f.headerAutoTextColor.checked) f.headerTextColor.value = UL.headerTextColor({ color: rule.color });

  const result = testEditor(rule, url);
  checkRows().forEach((row, i) => row.classList.toggle('hit', result.check === i));
  headerRows().forEach((row, i) => row.classList.toggle('hit', result.headerCheck === i));
  $('#preview').classList.toggle('nomatch', result.matched === false);

  const label = UL.makeLabel(rule, result.text, result.header);

  const fav = $('#pvFavicon').getContext('2d');
  if (label.placements.favicon) {
    UL.drawIcon(fav, 32, label, UL.iconText(label));
  } else {
    fav.clearRect(0, 0, 32, 32);
    fav.fillStyle = '#9aa0a6';
    fav.beginPath();
    fav.arc(16, 16, 13, 0, Math.PI * 2);
    fav.fill();
  }
  const title = UL.composeTitle(label, 'Page title');
  $('#pvTitle').textContent = title;

  // Address-bar suggestions show the title and icon the browser saved in its history.
  const suggest = $('#pvSuggestIcon').getContext('2d');
  suggest.clearRect(0, 0, 32, 32);
  suggest.drawImage($('#pvFavicon'), 0, 0);
  $('#pvSuggestTitle').textContent = title;
  $('#pvSuggestUrl').textContent = ` – ${url.replace(/^https?:\/\//, '') || 'example.com/…'}`;

  const icon = $('#pvIcon').getContext('2d');
  icon.clearRect(0, 0, 32, 32);
  if (label.placements.badge) UL.drawIcon(icon, 32, label);
  else {
    const img = new Image();
    img.onload = () => icon.drawImage(img, 0, 0, 32, 32);
    img.src = 'icons/icon32.png';
  }
  const badge = $('#pvBadge');
  badge.hidden = !label.placements.badge;
  badge.textContent = UL.badgeText(label);
  badge.style.background = label.color;
  badge.style.color = UL.labelTextColor(label);

  // The mini page is drawn at about 80% scale.
  const pill = $('#pvPill');
  UL.fillPill(pill, label);
  pill.style.fontSize = `${Math.round(UL.SIZES[label.pageSize].px * 0.8)}px`;
  const [v, hz] = label.pagePosition.split('-');
  Object.assign(pill.style, { top: '', bottom: '', left: '', right: '', [v]: v === 'top' ? '20px' : '6px', [hz]: '6px' });

  const shown = {
    ...label.placements,
    'header-title': !!label.header && label.headerPlacements.title,
    'header-page': !!label.header && label.headerPlacements.page,
  };
  form.querySelectorAll('.pv-item').forEach((el) => {
    const on = el.dataset.placement.split(' ').some((p) => shown[p]);
    el.classList.toggle('off', !on);
  });
}

form.addEventListener('input', refreshEditor);
form.addEventListener('change', refreshEditor);

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const rule = readForm();
  if (editingId === null) rule.id = UL.newId();

  form.querySelectorAll('.invalid').forEach((el) => el.classList.remove('invalid'));
  const invalid = [];
  if (!rule.name) invalid.push(f.name);
  if (!rule.pattern || (rule.matchType === 'regex' && UL.regexError(rule.pattern))) invalid.push(f.pattern);
  invalid.push(...badPatterns(checkRows()));
  if (rule.header.enabled) invalid.push(...badPatterns(headerRows()));
  if (!rule.defaultText && !rule.texts.length) invalid.push(f.defaultText);
  if (invalid.length) {
    invalid.forEach((el) => el.classList.add('invalid'));
    invalid[0].focus();
    return;
  }

  const i = state.rules.findIndex((r) => r.id === rule.id);
  if (i >= 0) state.rules[i] = rule;
  else state.rules.push(rule);
  persist();
  render();
  editor.close();
});

$('#cancelBtn').onclick = () => editor.close();
// The ✕ in a dialog's title bar closes it without saving, like Cancel.
document.querySelectorAll('dialog [data-close]').forEach((btn) => (btn.onclick = () => btn.closest('dialog').close()));
$('#deleteBtn').onclick = () => {
  if (deleteRule(editingId)) editor.close();
};

// ---- Import / export ---------------------------------------------------

$('#exportBtn').onclick = () => {
  const blob = new Blob([UL.buildExport(state)], { type: 'application/json' });
  const a = h('a', {
    href: URL.createObjectURL(blob),
    download: `url-labels-${new Date().toISOString().slice(0, 10)}.json`,
  });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast(`Exported ${plural(state.rules.length, 'label')}.`);
};

$('#importBtn').onclick = () => $('#importFile').click();

$('#importFile').onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    pendingImport = UL.parseImport(await file.text());
  } catch (err) {
    toast(err.message, true);
    return;
  }
  $('#importSummary').textContent = `"${file.name}" contains ${plural(pendingImport.rules.length, 'label')} and ${plural(pendingImport.envGroups.length, 'environment switcher')}.`;
  $('#importDialog').showModal();
};

function finishImport(replace) {
  state = replace ? pendingImport : UL.mergeState(state, pendingImport);
  persist();
  render();
  $('#importDialog').close();
  toast('Import complete.');
}

$('#importMerge').onclick = () => finishImport(false);
$('#importReplace').onclick = () => {
  if (confirm('Delete all your current labels and replace them with the file?')) finishImport(true);
};
$('#importCancel').onclick = () => $('#importDialog').close();
$('#importDialog').addEventListener('close', () => (pendingImport = null));

let toastTimer;
function toast(message, isError = false) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.toggle('bad', isError);
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 3500);
}

// ---- Startup -----------------------------------------------------------

$('#addBtn').onclick = () => openEditor(UL.normalizeRule({}), true);
$('#testUrl').addEventListener('input', runMainTest);

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local' || !(changes.rules || changes.envGroups)) return;
  state = await UL.loadState();
  render();
});

(async () => {
  buildEditorControls();
  state = await UL.loadState();
  render();

  // Links from the popup: ?new=<host> or ?edit=<id>
  const params = new URLSearchParams(location.search);
  if (params.has('new')) {
    const host = params.get('new');
    openEditor(UL.normalizeRule({ name: host, pattern: host }), true);
    f.testUrl.value = params.get('url') || '';
    refreshEditor();
    f.defaultText.focus();
  } else if (params.has('edit')) {
    const rule = state.rules.find((r) => r.id === params.get('edit'));
    if (rule) {
      openEditor(rule);
      if (params.get('url')) {
        f.testUrl.value = params.get('url');
        refreshEditor();
      }
    }
  }
  history.replaceState(null, '', location.pathname);
})();
