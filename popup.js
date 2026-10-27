const $ = (sel) => document.querySelector(sel);

const style = document.createElement('style');
style.textContent = UL.PILL_CSS;
document.head.append(style);

function openOptions(params) {
  chrome.tabs.create({ url: chrome.runtime.getURL(`options.html?${new URLSearchParams(params)}`) });
  window.close();
}

(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab?.url || '';
  const res = url ? UL.resolve(await UL.loadState(), url) : null;

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
