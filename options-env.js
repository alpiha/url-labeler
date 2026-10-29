// Environment switcher section of the options page. Uses $, h, state, persist, plural from options.js.

const envForm = $('#envForm');
const envEditor = $('#envEditor');
let editingSwitcherId = null; // null = new switcher

function renderSwitchers() {
  const groups = state.envGroups;
  $('#switcherList').replaceChildren(
    ...groups.map((g) =>
      h(
        'li',
        { className: 'rule switcher' },
        h(
          'div',
          { className: 'rule-info' },
          h('strong', { textContent: g.name || '(unnamed)' }),
          h('div', { className: 'chips' }, ...g.envs.map((e) => h('span', { className: 'chip mono', textContent: `${e.name}: ${e.template}` })))
        ),
        h(
          'div',
          { className: 'rule-actions' },
          h('button', { type: 'button', textContent: 'Edit', onclick: () => openSwitcher(g) }),
          h('button', { type: 'button', textContent: 'Delete', className: 'danger', onclick: () => deleteSwitcher(g.id) })
        )
      )
    )
  );
  $('#switcherEmpty').hidden = groups.length > 0;
}

function deleteSwitcher(id) {
  const g = state.envGroups.find((x) => x.id === id);
  if (!g || !confirm(`Delete the switcher "${g.name}"?`)) return false;
  state.envGroups = state.envGroups.filter((x) => x.id !== id);
  persist();
  renderSwitchers();
  return true;
}

// ---- Editor ------------------------------------------------------------

const envRows = () => [...$('#envRows').children];

function addEnvRow(env = { name: '', template: '' }) {
  const row = $('#envRow').content.firstElementChild.cloneNode(true);
  $('.env-name', row).value = env.name;
  $('.env-template', row).value = env.template;
  $('.ck-up', row).onclick = () => {
    row.previousElementSibling?.before(row);
    refreshSwitcher();
  };
  $('.ck-down', row).onclick = () => {
    row.nextElementSibling?.after(row);
    refreshSwitcher();
  };
  $('.ck-remove', row).onclick = () => {
    row.remove();
    refreshSwitcher();
  };
  $('#envRows').append(row);
  return row;
}

$('#addEnv').onclick = () => {
  $('.env-name', addEnvRow()).focus();
  refreshSwitcher();
};

function openSwitcher(group, isNew = false) {
  editingSwitcherId = isNew ? null : group.id;
  $('#envTitle').textContent = isNew ? 'New switcher' : `Edit: ${group.name}`;
  $('#envDelete').hidden = isNew;
  envForm.elements.name.value = group.name;
  envForm.elements.keepPath.checked = group.keepPath;
  envForm.elements.testUrl.value = $('#testUrl').value;
  $('#envRows').replaceChildren();
  const envs = group.envs.length ? group.envs : [{ name: '', template: '' }, { name: '', template: '' }];
  envs.forEach((e) => addEnvRow(e));
  envForm.querySelectorAll('.invalid').forEach((el) => el.classList.remove('invalid'));
  refreshSwitcher();
  envEditor.showModal();
  envForm.elements.name.focus();
}

function readSwitcher() {
  return UL.normalizeEnvGroup({
    id: editingSwitcherId ?? 'new',
    name: envForm.elements.name.value.trim(),
    keepPath: envForm.elements.keepPath.checked,
    envs: envRows().map((row) => ({
      name: $('.env-name', row).value.trim(),
      template: $('.env-template', row).value.trim().replace(/^https?:\/\//, ''),
    })),
  });
}

function refreshSwitcher() {
  const group = readSwitcher();
  envRows().forEach((row, i) => {
    $('.ck-up', row).disabled = i === 0;
    $('.ck-down', row).disabled = !row.nextElementSibling;
    row.classList.remove('hit');
  });

  const out = $('#envTest');
  const url = envForm.elements.testUrl.value.trim();
  if (!url) {
    out.className = 'test-result muted';
    out.replaceChildren('Paste a URL above to see where each environment would take you.');
    return;
  }
  const [sw] = UL.envSwitches({ envGroups: [group] }, url);
  if (!sw) {
    out.className = 'test-result no';
    out.replaceChildren("✗ This URL doesn't match any of the environments.");
    return;
  }
  envRows()[sw.current]?.classList.add('hit');
  out.className = 'test-result ok';
  out.replaceChildren(
    `✓ This is ${sw.targets[sw.current].name}. Switching goes to:`,
    h(
      'ul',
      { className: 'env-targets' },
      ...sw.targets
        .filter((t) => !t.current)
        .map((t) => h('li', {}, h('strong', { textContent: `${t.name || '?'}: ` }), h('code', { textContent: t.url })))
    )
  );
}

envForm.addEventListener('input', refreshSwitcher);
envForm.addEventListener('change', refreshSwitcher);

envForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const group = readSwitcher();
  if (editingSwitcherId === null) group.id = UL.newId();

  envForm.querySelectorAll('.invalid').forEach((el) => el.classList.remove('invalid'));
  const invalid = [];
  if (!group.name) invalid.push(envForm.elements.name);
  envRows().forEach((row) => {
    for (const cls of ['.env-name', '.env-template']) {
      const input = $(cls, row);
      if (!input.value.trim()) invalid.push(input);
    }
  });
  if (group.envs.length < 2) {
    toast('Add at least two environments to switch between.', true);
    return;
  }
  if (invalid.length) {
    invalid.forEach((el) => el.classList.add('invalid'));
    invalid[0].focus();
    return;
  }

  const i = state.envGroups.findIndex((g) => g.id === group.id);
  if (i >= 0) state.envGroups[i] = group;
  else state.envGroups.push(group);
  persist();
  renderSwitchers();
  envEditor.close();
});

$('#envCancel').onclick = () => envEditor.close();
$('#envDelete').onclick = () => {
  if (deleteSwitcher(editingSwitcherId)) envEditor.close();
};
$('#addSwitcher').onclick = () => openSwitcher(UL.normalizeEnvGroup({}), true);
