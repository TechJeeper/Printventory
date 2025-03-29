// Add these functions at the top level
async function autoSaveModel(field, value, filePath) {
  try {
    console.log(`autoSaveModel called with field: ${field}, value: ${value}, filePath: ${filePath}`);

    const model = await window.electron.getModel(filePath);
    if (!model) {
      console.error('No model found for path:', filePath);
      return;
    }

    // Ensure we have the model ID
    if (!model.id) {
      console.error('Model is missing ID:', model);
      return;
    }

    const modelData = {
      ...model,
      [field]: value
    };

    console.log('Auto-saving model:', modelData);
    await window.electron.saveModel(modelData);
    console.log(`Model saved successfully for field: ${field}`);

    // Check if the updated model still matches the current filter criteria
    const filteredModels = await window.getCombinedFilteredModels(0);
    const stillMatchesFilter = filteredModels.some(model => model.filePath === filePath);

    if (!stillMatchesFilter) {
      console.log(`Model ${filePath} no longer matches filter criteria, hiding element`);
      // Hide the element in the grid
      const fileItem = document.querySelector(`.file-item[data-filepath="${CSS.escape(filePath)}"]`);
      if (fileItem) {
        fileItem.style.display = 'none';
      }
    } else {
      // Update just this model's element instead of refreshing everything
      await updateModelElement(filePath);
    }

    if (['designer', 'parentModel', 'license', 'tags'].includes(field)) {
      debugLog('Refreshing dropdowns after saving');
      await Promise.all([
        populateDesignerDropdown(),
        populateParentModelFilter(),
        populateLicenseFilter(),
        populateTagFilter()
      ]);
    }

  } catch (error) {
    console.error('Error auto-saving model:', error);
    // Show an error message to the user
    const errorMessage = document.createElement('div');
    errorMessage.className = 'error-message';
    errorMessage.textContent = `Failed to save: ${error.message}`;

    // Add to the model details panel
    const detailsPanel = document.getElementById('model-details');
    if (detailsPanel) {
      detailsPanel.appendChild(errorMessage);
      // Remove after 5 seconds
      setTimeout(() => {
        if (errorMessage.parentNode) {
          errorMessage.parentNode.removeChild(errorMessage);
        }
      }, 5000);
    }
  }
}
