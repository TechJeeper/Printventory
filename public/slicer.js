// slicer.js
// This module handles the Slicer Settings panel in the renderer process

let slicerEntries = [];

function createSlicerEntry(slicer = { name: '', path: '' }) {
  const template = document.getElementById('slicer-entry-template');
  if (!template) {
    console.error('Slicer entry template not found');
    return null;
  }

  const entry = template.content.cloneNode(true);
  const container = entry.querySelector('.slicer-entry');
  const nameInput = entry.querySelector('.slicer-name');
  const pathInput = entry.querySelector('.slicer-path');

  // Generate unique IDs for the inputs to avoid conflicts
  const uniqueId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
  nameInput.id = `slicer-name-${uniqueId}`;
  pathInput.id = `slicer-path-${uniqueId}`;

  // Set initial values and store them in data attributes
  nameInput.value = slicer.name || '';
  pathInput.value = slicer.path || '';
  nameInput.dataset.originalValue = slicer.name || '';
  pathInput.dataset.originalValue = slicer.path || '';

  // Add browse button handler
  const browseButton = entry.querySelector('.browse-slicer-button');
  browseButton.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();

    // Store current values before dialog
    const currentValues = Array.from(document.querySelectorAll('.slicer-entry')).map(entry => ({
      name: entry.querySelector('.slicer-name').value,
      path: entry.querySelector('.slicer-path').value
    }));

    const result = await window.electron.openSlicerDialog('Select Slicer');

    // Restore all values after dialog
    document.querySelectorAll('.slicer-entry').forEach((entry, index) => {
      if (currentValues[index]) {
        entry.querySelector('.slicer-name').value = currentValues[index].name;
        entry.querySelector('.slicer-path').value = currentValues[index].path;
      }
    });

    // Update only this entry's path
    if (!result.canceled && result.filePaths && result.filePaths.length > 0) {
      const thisEntry = e.target.closest('.slicer-entry');
      const thisPathInput = thisEntry.querySelector('.slicer-path');
      thisPathInput.value = result.filePaths[0];
    }
  });

  // Add remove button handler
  const removeButton = entry.querySelector('.remove-slicer-button');
  removeButton.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const thisEntry = e.target.closest('.slicer-entry');
    if (thisEntry) {
      thisEntry.remove();
    }
  });

  return container;
}

function openSlicerSettings() {
  const dialog = document.getElementById('slicer-dialog');
  if (!dialog) return;

  const slicerList = dialog.querySelector('#slicer-list');
  if (!slicerList) return;

  // Prevent form submission
  const form = dialog.querySelector('form');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
  });

  slicerList.innerHTML = '';

  // Load existing slicers
  window.electron.getSlicers()
    .then(slicers => {
      if (slicers && slicers.length > 0) {
        slicers.forEach(slicer => {
          const entry = createSlicerEntry(slicer);
          if (entry) {
            slicerList.appendChild(entry);
          }
        });
      }
    })
    .catch(err => {
      console.error('Error loading slicers:', err);
    });

  dialog.showModal();
}

function saveSlicerSettings() {
  const entries = document.querySelectorAll('.slicer-entry');
  const slicers = Array.from(entries).map(entry => ({
    name: entry.querySelector('.slicer-name').value.trim(),
    path: entry.querySelector('.slicer-path').value.trim()
  }));

  // Validate entries
  const invalidEntries = slicers.filter(s => !s.name || !s.path);
  if (invalidEntries.length > 0) {
    alert('Please fill in both name and path for all slicers.');
    return;
  }

  // Save all slicers - drop and recreate
  window.electron.clearAndSaveSlicers(slicers)
    .then(() => {
      alert('Slicer settings saved successfully.');
      document.getElementById('slicer-dialog').close();
    })
    .catch(err => {
      alert('Error saving slicer settings: ' + err.message);
      console.error('Error saving slicer settings:', err);
    });
}

document.addEventListener('DOMContentLoaded', () => {
  const dialog = document.getElementById('slicer-dialog');
  if (!dialog) return;

  // Prevent form submission
  const form = dialog.querySelector('form');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
  });

  // Add new slicer button handler
  document.getElementById('add-slicer-button')?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const slicerList = document.getElementById('slicer-list');
    const entry = createSlicerEntry();
    if (entry) {
      slicerList.appendChild(entry);
    }
  });

  // Add save button handler
  document.getElementById('save-slicer-settings')?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    saveSlicerSettings();
  });

  // Add cancel button handler
  document.getElementById('cancel-slicer-settings')?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    document.getElementById('slicer-dialog').close();
  });

  // Listen for the event from main process
  window.electron.onOpenSlicerSettings(() => {
    openSlicerSettings();
  });
});