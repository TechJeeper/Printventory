'use strict';

function $(id) {
  return document.getElementById(id);
}

function setStatus(kind, text) {
  const el = $('status');
  el.className = 'status' + (kind ? ' ' + kind : '');
  el.textContent = text || '';
}

function fillForm(data) {
  $('parentModel').value = (data && data.parentModel) || '';
  $('designer').value = (data && data.designer) || '';
  $('license').value = (data && data.license) || '';
  $('source').value = (data && (data.source || data.url)) || '';
  $('notes').value = (data && data.notes) || '';
}

function readForm() {
  return {
    parentModel: $('parentModel').value.trim() || null,
    designer: $('designer').value.trim() || null,
    license: $('license').value.trim() || null,
    source: $('source').value.trim() || null,
    notes: $('notes').value.trim() || null
  };
}

async function enrichInPopup(data, tabUrl) {
  if (!self.PrintventoryExtract || typeof self.PrintventoryExtract.enrichFromApi !== 'function') {
    return data;
  }
  const href = (data && (data.source || data.url)) || tabUrl;
  const catalog = self.PrintventoryExtract.parseCatalog(href);
  if (!catalog || !catalog.isModelPage) return data;
  try {
    const api = await self.PrintventoryExtract.enrichFromApi(catalog, fetch);
    if (!api || (!api.designer && !api.parentModel && !api.notes)) return data;
    return {
      url: (data && data.url) || catalog.canonicalHref,
      source: (data && data.source) || catalog.canonicalHref,
      catalogId: catalog.id,
      site: catalog.site,
      parentModel: api.parentModel || (data && data.parentModel) || catalog.slugTitle,
      designer: api.designer || (data && data.designer) || null,
      notes: api.notes || (data && data.notes) || null,
      license: api.license || (data && data.license) || 'Unknown'
    };
  } catch (e) {
    return data;
  }
}

function loadActive() {
  setStatus('', 'Reading page…');
  chrome.runtime.sendMessage({ action: 'extractActiveTab' }, async (response) => {
    if (chrome.runtime.lastError) {
      setStatus('err', chrome.runtime.lastError.message);
      return;
    }
    if (!response || !response.ok) {
      setStatus('err', (response && response.error) || 'Could not read this tab');
      return;
    }
    let data = response.data;
    if (!data) {
      data = self.PrintventoryExtract && self.PrintventoryExtract.metadataFromUrl
        ? self.PrintventoryExtract.metadataFromUrl(response.tab && response.tab.url)
        : null;
    }
    if (!data) {
      setStatus('err', 'Not a supported model page. Open MakerWorld, Printables, Thingiverse, Thangs, Cults3D, or MyMiniFactory.');
      fillForm({ source: response.tab && response.tab.url });
      $('addPage').disabled = true;
      return;
    }
    fillForm(data);
    if (!data.designer || !data.notes || !data.license || data.license === 'Unknown') {
      setStatus('', 'Fetching model details…');
      data = await enrichInPopup(data, response.tab && response.tab.url);
      fillForm(data);
    }
    $('addPage').disabled = false;
    setStatus('ok', 'Check the fields, then Add page — or download the file.');
  });
}

$('refresh').addEventListener('click', loadActive);

$('addPage').addEventListener('click', () => {
  const data = readForm();
  if (!data.source && !data.parentModel) {
    setStatus('err', 'Need a title or source URL');
    return;
  }
  $('addPage').disabled = true;
  chrome.runtime.sendMessage({ action: 'queuePage', data: data }, (response) => {
    $('addPage').disabled = false;
    if (chrome.runtime.lastError) {
      setStatus('err', chrome.runtime.lastError.message);
      return;
    }
    if (response && response.ok) {
      setStatus('ok', 'Queued. Printventory will import within a minute of opening.');
    } else {
      setStatus('err', (response && response.error) || 'Failed to write inbox file');
    }
  });
});

$('openOptions').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

function refreshSetupBanner() {
  chrome.storage.local.get({ printventoryFolderConfigured: false }, (items) => {
    $('setupBanner').classList.toggle('visible', !items.printventoryFolderConfigured);
  });
}

$('chooseFolder').addEventListener('click', async () => {
  if (!window.showDirectoryPicker) {
    chrome.runtime.openOptionsPage();
    return;
  }
  try {
    const handle = await window.showDirectoryPicker({ id: 'pv-printventory-dir', mode: 'readwrite' });
    const granted = await PrintventoryFolder.ensureWritePermission(handle);
    if (!granted) {
      setStatus('err', 'Folder permission was not granted');
      return;
    }
    const hasDb = await PrintventoryFolder.folderHasDatabase(handle);
    await PrintventoryFolder.setDirectoryHandle(handle);
    chrome.storage.local.set({
      printventoryFolderConfigured: true,
      printventoryFolderName: handle.name,
      printventoryFolderHasDb: hasDb
    }, refreshSetupBanner);
    setStatus(hasDb ? 'ok' : '', hasDb
      ? 'Folder saved. Inbox will go next to Printventory.'
      : 'Folder saved, but printventory.db was not found there.');
  } catch (err) {
    if (err && err.name === 'AbortError') return;
    setStatus('err', err && err.message ? err.message : String(err));
  }
});

refreshSetupBanner();
loadActive();
