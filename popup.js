const $ = (sel) => document.querySelector(sel);

const style = document.createElement('style');
style.textContent = UL.PILL_CSS;
document.head.append(style);

function openOptions(params) {
  chrome.tabs.create({ url: chrome.runtime.getURL(`options.html?${new URLSearchParams(params)}`) });
  window.close();
}

// One row of buttons per environment switcher the page belongs to. Click switches this tab,
// Ctrl/middle click opens the other environment in a new tab next to it.
function renderSwitches(tab, switches, state) {
  const box = $('#switches');
  for (const sw of switches) {
    const heading = document.createElement('p');
    heading.className = 'muted small switch-head';
    heading.textContent = `Switch to (${sw.group.name})`;
    const row = document.createElement('div');
    row.className = 'switch-row';

    for (const target of sw.targets) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = target.name;
      btn.title = target.url;
      btn.disabled = target.current;
      const label = UL.resolve(state, target.url)?.label;
      if (label) {
        btn.style.background = label.color;
        btn.style.borderColor = label.color;
        btn.style.color = UL.labelTextColor(label);
      }
      const go = (newTab) => {
        if (newTab) chrome.tabs.create({ url: target.url, index: tab.index + 1, active: false });
        else chrome.tabs.update(tab.id, { url: target.url });
        if (!newTab) window.close();
      };
      btn.onclick = (e) => go(e.ctrlKey || e.metaKey);
      btn.onauxclick = (e) => e.button === 1 && go(true);
      row.append(btn);
    }
    box.append(heading, row);
  }
}

(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab?.url || '';
  const state = await UL.loadState();
  const res = url ? UL.resolve(state, url) : null;
  if (url) renderSwitches(tab, UL.envSwitches(state, url), state);

  let host = '';
  try {
    host = new URL(url).hostname;
  } catch {}
  $('#host').textContent = host || url || 'Unknown page';

  if (res) {
    const pill = document.createElement('span');
    UL.fillPill(pill, res.label);
    const name = document.createElement('span');
    name.className = 'muted small';
    name.textContent = ` ${res.rule.name}`;
    $('#match').replaceChildren(pill, name);
    $('#editBtn').hidden = false;
    $('#editBtn').onclick = () => openOptions({ edit: res.rule.id, url });
  } else {
    $('#match').textContent = 'No label for this page.';
  }

  $('#newBtn').disabled = !host;
  $('#newBtn').onclick = () => openOptions({ new: host, url });
  $('#manageBtn').onclick = () => {
    chrome.runtime.openOptionsPage();
    window.close();
  };
})();
