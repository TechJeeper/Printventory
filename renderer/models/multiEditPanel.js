// models/multiEditPanel.js

function setupMultiEditPanel() {
  const modelDetails = document.getElementById('model-details');


  // Update the edit mode toggle button listener
  document.getElementById('edit-mode-toggle')?.addEventListener('click', async () => {
    isMultiSelectMode = !isMultiSelectMode;
    const button = document.getElementById('edit-mode-toggle');
    const multiEditPanel = document.getElementById('multi-edit-panel');
    const detailsPanel = document.getElementById('model-details');

    // Clear selection when disabling multiselect
    if (!isMultiSelectMode) {
      selectedModels.clear();
      document.querySelectorAll('.file-item').forEach(item => item.classList.remove('selected'));
      multiEditPanel.classList.add('hidden');
      modelDetails.classList.remove('hidden');
      button.textContent = 'Multi-Edit Mode';
      button.classList.remove('active');
    } else {
      multiEditPanel.classList.remove('hidden');
      modelDetails.classList.add('hidden');
      button.textContent = 'Single-Edit Mode';
      button.classList.add('active');
      // Populate dropdowns
      await populateModelDesignerDropdown(null, 'multi-designer');
      await populateModelLicenseDropdown(null, 'multi-license');
      await populateParentModelDropdown(null, 'multi-parent');
      await populateTagSelect('multi-tag-select', 'multi-tags');

      // Scroll the multi-edit panel into view with smooth animation
      multiEditPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    updateSelectedCount();
  });

  // Update the save model button handler (single edit)
  document.getElementById('save-model-button')?.addEventListener('click', async () => {
    try {
      const filePath = document.getElementById('model-path').value;
      // Get all selected tags
      const tagElements = document.getElementById('model-tags').querySelectorAll('.tag');
      const tags = Array.from(tagElements).map(tag => tag.getAttribute('data-tag-name'));

      const modelData = {
        filePath,
        fileName: document.getElementById('model-name').value,
        designer: document.getElementById('model-designer').value || 'Unknown',
        source: document.getElementById('model-source').value || '',
        notes: document.getElementById('model-notes').value || '',
        printed: document.getElementById('model-printed').checked,
        parentModel: document.getElementById('model-parent').value || '',
        license: document.getElementById('model-license').value || '',
        tags: tags
      };

      // Save the model with tags
      await window.electron.saveModel(modelData);

      // Refresh all filter dropdowns
      await Promise.all([
        populateDesignerDropdown(),
        populateLicenseFilter(),
        populateParentModelFilter(),
        populateTagFilter()
      ]);

      // Reapply filters and refresh view
      await refreshModelDisplay();

    } catch (error) {
      console.error('Error saving model:', error);
    }
  });

}



function addContextMenuToTextInputs() {
  const textInputs = document.querySelectorAll('input[type="text"], textarea');
  textInputs.forEach(input => {
    input.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const menu = new Menu();
      menu.append(new MenuItem({ role: 'cut', label: 'Cut' }));
      menu.append(new MenuItem({ role: 'copy', label: 'Copy' }));
      menu.append(new MenuItem({ role: 'paste', label: 'Paste' }));
      menu.popup({ window: remote.getCurrentWindow() });
    });
  });
}
