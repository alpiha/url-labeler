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
let state = { rules: [] };
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
}

function renderRow(rule, i) {
  const pill = h('span');
  UL.fillPill(pill, UL.makeLabel(rule, sampleText(rule)));

  const chips = h('div', { className: 'chips' });
  for (const [key, label] of Object.entries(UL.PLACEMENTS)) {
    if (rule.placements[key]) chips.append(h('span', { className: 'chip', textContent: label }));
  }
  if (rule.texts.length) chips.append(h('span', { className: 'chip', textContent: plural(rule.texts.length, 'text check') }));
  const badRegex = [rule, ...rule.texts].some((r) => r.matchType === 'regex' && UL.regexError(r.pattern));
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
  $('#checks').append(row);
  return row;
}

$('#addCheck').onclick = () => {
  $('.ck-pattern', addCheckRow()).focus();
  refreshEditor();
};

const checkRows = () => [...$('#checks').children];

// ---- Editor ------------------------------------------------------------

function buildEditorControls() {
  $('#shapes').replaceChildren(
    ...Object.entries(UL.SHAPES).map(([key, s]) =>
      h(
        'label',
        { className: 'shape-opt', title: s.label },
        h('input', { type: 'radio', name: 'shape', value: key }),
        h('span', { className: 'frame' }, h('span', { className: `pill ${key}`, textContent: s.label }))
      )
    )
  );
  $('#placements').replaceChildren(
    ...Object.entries(UL.PLACEMENTS).map(([key, label]) =>
      h('label', {}, h('input', { type: 'checkbox', name: `pl-${key}` }), ` ${label}`)
    )
  );
  f.pagePosition.replaceChildren(
    ...Object.entries(UL.POSITIONS).map(([key, label]) => h('option', { value: key, textContent: label }))
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
  f.shape.value = rule.shape;
  f.color.value = rule.color;
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
    shape: f.shape.value,
    color: f.color.value,
    placements,
    pagePosition: f.pagePosition.value,
    enabled: f.enabled.checked,
  });
}

// Runs the URL in the test box through the label being edited and explains the result.
function testEditor(rule, url) {
  const out = $('#editorTest');
  if (!url) {
    setResult(out, 'muted', 'Paste a URL above to check whether this label matches it.');
    return { text: sampleText(rule), check: null, matched: null };
  }
  if (!UL.find(rule.matchType, rule.pattern, rule.caseSensitive, url)) {
    setResult(out, 'no', `✗ No match. The URL doesn't ${rule.matchType === 'regex' ? 'match' : 'contain'} "${rule.pattern}", so this label won't show.`);
    return { text: sampleText(rule), check: null, matched: false };
  }

  const { text, check } = UL.pickText(rule, url);
  if (!text) {
    setResult(out, 'no', '✗ The URL matches, but no text check matches and there is no default text, so no label is shown.');
    return { text: sampleText(rule), check: null, matched: false };
  }

  const source = check >= 0 ? `text check ${check + 1}` : 'default text';
  const parts = ['✓ Matches. Shows ', h('strong', { textContent: text }), ` (${source}).`];
  if (!rule.enabled) parts.push(' The label is disabled, though.');

  // Another label higher up in the list might win for this URL.
  const others = state.rules.map((r) => (r.id === editingId ? rule : r));
  if (editingId === null) others.push(rule);
  const winner = UL.resolve({ rules: others }, url);
  if (rule.enabled && winner && winner.rule !== rule) parts.push(` But "${winner.rule.name}" is higher in the list and wins.`);

  setResult(out, 'ok', ...parts);
  return { text, check, matched: true };
}

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

  $('#positionRow').hidden = !rule.placements.page;
  form.querySelectorAll('.shape-opt .pill').forEach((p) => {
    p.style.background = rule.color;
    p.style.color = UL.textColor(rule.color);
  });

  const result = testEditor(rule, url);
  checkRows().forEach((row, i) => row.classList.toggle('hit', result.check === i));
  $('#preview').classList.toggle('nomatch', result.matched === false);

  const label = UL.makeLabel(rule, result.text);

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
  $('#pvTitle').textContent = (label.placements.title ? UL.titlePrefix(label) : '') + 'Page title';

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
  badge.style.color = UL.textColor(label.color);

  const pill = $('#pvPill');
  UL.fillPill(pill, label);
  const [v, hz] = label.pagePosition.split('-');
  Object.assign(pill.style, { top: '', bottom: '', left: '', right: '', [v]: v === 'top' ? '20px' : '6px', [hz]: '6px' });

  form.querySelectorAll('.pv-item').forEach((el) => {
    const on = el.dataset.placement.split(' ').some((p) => label.placements[p]);
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
  checkRows().forEach((row) => {
    const type = $('.ck-type', row).value;
    const pattern = $('.ck-pattern', row);
    if (!pattern.value.trim() || (type === 'regex' && UL.regexError(pattern.value))) invalid.push(pattern);
  });
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
  $('#importSummary').textContent = `"${file.name}" contains ${plural(pendingImport.rules.length, 'label')}.`;
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
  if (area !== 'local' || !changes.rules) return;
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
