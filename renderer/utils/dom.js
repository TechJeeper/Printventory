// utils/dom.js

function resetInputState(inputElement) {
  if (!inputElement) return;

  inputElement.disabled = false;
  inputElement.readOnly = false;
  inputElement.blur();

  setTimeout(() => {
    inputElement.focus();
    inputElement.click();

    setTimeout(() => {
      if (document.activeElement !== inputElement) {
        inputElement.focus();
        inputElement.click();
      }
    }, 100);
  }, 50);
}


function forceDialogRefresh(dialog, input) {
  dialog.style.display = 'none';
  requestAnimationFrame(() => {
    dialog.style.display = '';
    resetInputState(input);
  });
}

function scrollToView(el) {
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function debounce(func, wait = 300) {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}
// Add window visibility change handler to clean up resources when tab is hidden
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    // Clean up WebGL resources when tab is hidden
    cleanupWebGLResources();
  }
});

// Add window unload handler to clean up resources when page is closed
window.addEventListener('beforeunload', () => {
  cleanupWebGLResources();
});


// Update the multi-license change handler to use autoSaveMultipleModels
document.getElementById('multi-license').addEventListener('change', async (e) => {
  await autoSaveMultipleModels('license', e.target.value);
});

document.getElementById('multi-designer').addEventListener('change', async (e) => {
  await autoSaveMultipleModels('designer', e.target.value);
});

// Add event listener for multi-source input
document.getElementById('multi-source').addEventListener('input', debounce(async (e) => {
  await autoSaveMultipleModels('source', e.target.value);
}), 500); // 500ms debounce

// Add event listeners for notes fields
document.getElementById('model-notes')?.addEventListener('change', async (e) => {
  const filePath = document.getElementById('model-path').value;
  await autoSaveModel('notes', e.target.value, filePath);
});

document.getElementById('multi-notes')?.addEventListener('input', debounce(async (e) => {
  await autoSaveMultipleModels('notes', e.target.value);
}), 500);


// Add a focus event listener to repopulate all AI configuration fields
window.addEventListener('focus', async () => {
  // Repopulate API Key field
  const apiKeyEl = document.getElementById('ai-api-key');
  if (apiKeyEl) {
    const storedApiKey = await window.electron.getSetting('apiKey');
    apiKeyEl.value = storedApiKey || '';
  }

  // Repopulate API Endpoint field
  const endpointEl = document.getElementById('ai-endpoint');
  if (endpointEl) {
    const storedEndpoint = await window.electron.getSetting('apiEndpoint');
    endpointEl.value = storedEndpoint || 'https://api.openai.com/v1';
  }

  // Repopulate AI Model field
  const modelEl = document.getElementById('ai-model');
  if (modelEl) {
    const storedModel = await window.electron.getSetting('aiModel');
    modelEl.value = storedModel || 'gpt-4o-mini';
  }

  // Repopulate AI Service field
  const serviceEl = document.getElementById('ai-service-select');
  if (serviceEl) {
    const storedService = await window.electron.getSetting('aiService');
    serviceEl.value = storedService || 'openai';
  }
});


// Keep only this single DOMContentLoaded event listener
document.addEventListener('DOMContentLoaded', async () => {
  const tosAccepted = await checkTermsOfService();
  if (!tosAccepted) return; // Don't continue if TOS was declined

  debugLog('DOM fully loaded and parsed');

  // (update check and app initialization code already present)
  try {
    console.log('Checking for updates on startup...');
    let currentVersion = await window.electron.getSetting('currentVersion');
    const isBeta = (await window.electron.getSetting('betaOptIn')) === 'true';
    const latestVersion = await window.electron.checkForUpdates(isBeta);
    const lastDeclinedVersion = await window.electron.getSetting('lastDeclinedVersion');

    console.log('Version check results:', {
      currentVersion,
      latestVersion,
      lastDeclinedVersion,
      isBeta
    });

    if (
      latestVersion &&
      latestVersion !== currentVersion &&
      latestVersion > currentVersion &&
      latestVersion !== lastDeclinedVersion
    ) {
      const shouldUpdate = await window.electron.showMessage(
        'Update Available',
        `Version ${latestVersion} is available. You are currently running version ${currentVersion}. Would you like to update?`,
        ['Yes', 'No']
      );

      if (shouldUpdate === 'Yes') {
        await window.electron.openUpdatePage(isBeta);
      } else {
        console.log('User declined update, storing version:', latestVersion);
        await window.electron.saveSetting('lastDeclinedVersion', latestVersion);
      }
    }

    await window.electron.saveSetting('latestVersion', latestVersion);
    await window.electron.saveSetting('lastUpdateCheck', new Date().toISOString());

  } catch (error) {
    console.error('Error checking for updates:', error);
  }

  // Continue with normal initialization...
  await initializeApp();

  // NEW: Prompt the user to render pending thumbnails (if any)
  await promptPendingThumbnails();

  // (Any additional event listeners and UI initialization code below)
});

// Add event listeners for the multi-edit panel move and delete buttons
document.getElementById('move-selected-button')?.addEventListener('click', async () => {
  if (selectedModels.size === 0) {
    await window.electron.showMessage('No Selection', 'Please select models to move.');
    return;
  }
  const count = selectedModels.size;
  const confirmation = await window.electron.showMessage(
    'Confirm Move',
    `Are you sure you want to move ${count} selected model${count !== 1 ? 's' : ''}?`,
    ['Yes', 'No']
  );
  if (confirmation !== 'Yes') return;

  // Open folder dialog via IPC
  const result = await window.electron.openFolderDialog('Select Destination Folder');
  if (!result.canceled && result.filePaths && result.filePaths.length > 0) {
    const destinationFolder = result.filePaths[0];
    try {
      // Move files
      for (const filePath of selectedModels) {
        const newDestination = path.join(destinationFolder, path.basename(filePath));
        await fs.promises.rename(filePath, newDestination);
        db.prepare('UPDATE models SET filePath = ? WHERE filePath = ?').run(newDestination, filePath);
      }
      // Clear selected models after moving
      selectedModels.clear();
      updateSelectedCount(); // Update the UI to reflect the cleared selection
      document.querySelectorAll('.file-item').forEach(item => item.classList.remove('selected')); // Clear visual selection
    } catch (error) {
      console.error('Error moving selected models:', error);
    }
  }
});

document.getElementById('delete-selected-button')?.addEventListener('click', async () => {
  if (selectedModels.size === 0) {
    await window.electron.showMessage('No Selection', 'Please select models to delete.');
    return;
  }
  const count = selectedModels.size;
  const confirmation = await window.electron.showMessage(
    'Confirm Deletion',
    `Are you sure you want to DELETE ${count} selected model${count !== 1 ? 's' : ''}? This cannot be undone!`,
    ['Yes', 'No']
  );
  if (confirmation !== 'Yes') return;

  // Delete selected models one-by-one.
  for (const filePath of selectedModels) {
    try {
      await window.electron.deleteFile(filePath);
    } catch (error) {
      console.error(`Error deleting file ${filePath}:`, error);
    }
  }
  // Clear selected models after deletion.
  selectedModels.clear();
  // Refresh the display (assuming 'refreshModelDisplay' exists).
  await refreshModelDisplay();
});

// Add WebGL context loss handling
window.addEventListener('webglcontextlost', (event) => {
  event.preventDefault();
  sharedRenderer = null;
}, false);


// Update the edit mode toggle handler
document.getElementById('edit-mode-toggle')?.addEventListener('click', () => {
  isMultiSelectMode = !isMultiSelectMode;
  const button = document.getElementById('edit-mode-toggle');
  const multiEditPanel = document.getElementById('multi-edit-panel');
  const detailsPanel = document.getElementById('model-details');

  if (isMultiSelectMode) {
    button.textContent = 'Exit Multi-Edit Mode';
    button.classList.add('active');
    multiEditPanel.classList.remove('hidden');
    detailsPanel.classList.add('hidden');
    showMultiEditPanel();
  } else {
    exitMultiEditMode();
  }
});

// Update the exit button handler
document.getElementById('exit-multi-edit-button')?.addEventListener('click', exitMultiEditMode);

// Add change event listeners for auto-save
document.getElementById('model-parent').addEventListener('change', async (e) => {
  const filePath = document.getElementById('model-path').value;
  await autoSaveModel('parentModel', e.target.value, filePath);
});

document.getElementById('multi-parent').addEventListener('change', async (e) => {
  await autoSaveMultipleModels('parentModel', e.target.value);
});

// Update tag handling for multi-edit panel
document.getElementById('multi-tag-select').addEventListener('change', async () => {
  const selectedTag = document.getElementById('multi-tag-select').value;
  if (selectedTag) {
    // Use the same addTagToModel function as single mode
    addTagToModel(selectedTag, 'multi-tags');
    document.getElementById('multi-tag-select').value = ''; // Reset selection
  }
});

// Cancel Button Handler
document.getElementById('cancel-parent-button')?.addEventListener('click', () => {
  const dialog = document.getElementById('new-parent-dialog');
  const input = document.getElementById('new-parent-name');
  input.value = '';
  dialog.close();
});

// Parent Model Button Click Handler
document.querySelectorAll('.add-parent-button, #add-new-parent-button').forEach(button => {
  button?.addEventListener('click', () => {
    const dialog = document.getElementById('new-parent-dialog');
    const input = document.getElementById('new-parent-name');

    // Reset form and input state
    dialog.querySelector('form').reset();
    input.value = '';
    input.disabled = false;
    input.readOnly = false;

    // Store which dropdown triggered the dialog
    dialog.dataset.sourceDropdown = button.closest('.designer-input-container')?.querySelector('select')?.id || 'model-parent';

    // Show dialog and force refresh exactly like designer
    dialog.showModal();
    requestAnimationFrame(() => {
      input.focus();
      input.click();
    });
  });
});
// Add bulk edit button to the main content area
const bulkEditButton = document.createElement('button');
bulkEditButton.id = 'bulk-edit-button';
bulkEditButton.className = 'bulk-edit-button';
bulkEditButton.textContent = 'Edit Selected Models';
document.querySelector('.main-content').appendChild(bulkEditButton);

// Add bulk edit functionality
bulkEditButton.addEventListener('click', () => {
  const dialog = document.getElementById('bulk-edit-dialog');

  // Populate dropdowns
  populateModelDesignerDropdown();
  populateParentModelDropdown();

  dialog.showModal();
});

// Handle bulk edit save
document.getElementById('bulk-edit-dialog').addEventListener('submit', async (event) => {
  event.preventDefault();

  const updates = {
    designer: document.getElementById('bulk-designer').value,
    parentModel: document.getElementById('bulk-parent').value,
    source: document.getElementById('bulk-source').value,
    printed: document.getElementById('bulk-printed').value
  };

  try {
    for (const filePath of selectedModels) {
      const model = await window.electron.getModel(filePath);
      const updatedModel = {
        ...model,
        designer: updates.designer || model.designer,
        parentModel: updates.parentModel === 'none' ? '' : (updates.parentModel || model.parentModel),
        source: updates.source || model.source,
        printed: updates.printed ? (updates.printed === 'true') : model.printed
      };
      await window.electron.saveModel(updatedModel);
    }

    // Refresh the view
    const models = await window.electron.getAllModels();
    await renderFiles(models);

    // Clear selection
    selectedModels.clear();
    document.getElementById('bulk-edit-button').classList.remove('visible');

    await window.electron.showMessage('Success', 'Changes saved successfully!');
  } catch (error) {
    console.error('Error saving bulk changes:', error);
    await window.electron.showMessage('Error', 'Error saving changes');
  }

  document.getElementById('bulk-edit-dialog').close();
});

// Handle bulk edit cancel
document.getElementById('bulk-cancel-button')?.addEventListener('click', () => {
  document.getElementById('bulk-edit-dialog').close();
});

// Update the add button event listeners to handle both panels
document.querySelectorAll('.add-designer-button').forEach(button => {
  button.addEventListener('click', () => {
    const dialog = document.getElementById('new-designer-dialog');
    // Store which dropdown triggered the dialog
    dialog.dataset.sourceDropdown = button.closest('.designer-input-container').querySelector('select').id;
    dialog.showModal();
  });
});

document.querySelectorAll('.add-parent-button').forEach(button => {
  button.addEventListener('click', () => {
    const dialog = document.getElementById('new-parent-dialog');
    // Store which dropdown triggered the dialog
    dialog.dataset.sourceDropdown = button.closest('.designer-input-container').querySelector('select').id;
    dialog.showModal();
  });
});

document.querySelectorAll('.add-tag-button').forEach(button => {
  button.addEventListener('click', () => {
    const dialog = document.getElementById('new-tag-dialog');
    // Store which container triggered the dialog
    dialog.dataset.sourceContainer = button.closest('.tags-container').querySelector('.tags-list').id;
    dialog.showModal();
  });
});

// Update the dialog submit handlers to use the stored dropdown IDs
document.getElementById('new-designer-dialog').addEventListener('submit', async (event) => {
  event.preventDefault();
  const newDesignerName = document.getElementById('new-designer-name').value.trim();
  const sourceDropdownId = event.target.closest('dialog').dataset.sourceDropdown;

  if (newDesignerName) {
    // Add the new designer to the dropdown
    const designerSelect = document.getElementById(sourceDropdownId);
    const option = document.createElement('option');
    option.value = newDesignerName;
    option.textContent = newDesignerName;
    designerSelect.appendChild(option);

    // Select the new designer
    designerSelect.value = newDesignerName;

    // Clear the input
    document.getElementById('new-designer-name').value = '';

    // Close the dialog
    document.getElementById('new-designer-dialog').close();
  }
});

// Parent Model Dialog Submit Handler
document.getElementById('new-parent-dialog').addEventListener('submit', async (event) => {
  event.preventDefault();
  const newParentName = document.getElementById('new-parent-name').value.trim();
  const sourceDropdownId = event.target.closest('dialog').dataset.sourceDropdown || 'model-parent';

  if (newParentName) {
    const parentSelect = document.getElementById(sourceDropdownId);
    if (parentSelect) {
      const option = document.createElement('option');
      option.value = newParentName;
      option.textContent = newParentName;
      parentSelect.appendChild(option);
      parentSelect.value = newParentName;
    }

    // Clear the input and close the dialog immediately
    document.getElementById('new-parent-name').value = '';
    document.getElementById('new-parent-dialog').close();

    // Trigger auto-save and updates after dialog is closed
    if (sourceDropdownId === 'multi-parent') {
      await autoSaveMultipleModels('parentModel', newParentName);
    } else {
      const filePath = document.getElementById('model-path').value;
      await autoSaveModel('parentModel', newParentName, filePath);
    }

    // Update the filter dropdown
    await populateParentModelFilter();
  }
});

// Update the multi-tag-select change handler
document.getElementById('multi-tag-select').addEventListener('change', async () => {
  const tagSelect = document.getElementById('multi-tag-select');
  const selectedTag = tagSelect.value;
  if (selectedTag) {
    // Use the same addTagToModel function as single mode
    addTagToModel(selectedTag, 'multi-tags');
    document.getElementById('multi-tag-select').value = ''; // Reset selection
  }
});

