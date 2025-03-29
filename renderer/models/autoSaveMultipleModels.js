async function autoSaveMultipleModels(field, value) {
  if (selectedModels.size === 0) {
    console.warn("No models selected for multi-edit.");
    return;
  }

  const updateData = { [field]: value };
  const updatePromises = [];
  const modelsToUnselect = new Set();

  for (const filePath of selectedModels) {
    try {
      const existingModel = await window.electron.getModel(filePath);
      if (!existingModel) {
        console.warn(`Model not found for file path: ${filePath}`);
        continue;
      }

      const updatedModel = { ...existingModel, ...updateData };
      await window.electron.saveModel(updatedModel);
      updatePromises.push(updateModelElement(filePath));

      // Check if the updated model still matches the current filter criteria
      const filteredModels = await window.getCombinedFilteredModels(0);
      const stillMatchesFilter = filteredModels.some(model => model.filePath === filePath);

      if (!stillMatchesFilter) {
        modelsToUnselect.add(filePath);
        console.log(`Model ${filePath} no longer matches filter criteria, will be unselected`);
      }
    } catch (error) {
      console.error(`Error updating model ${filePath}:`, error);
    }
  }

  await Promise.all(updatePromises);

  // Unselect models that no longer match the filter criteria
  if (modelsToUnselect.size > 0) {
    for (const filePath of modelsToUnselect) {
      selectedModels.delete(filePath);
      // Update UI to reflect unselection
      const fileItem = document.querySelector(`.file-item[data-path="${filePath}"]`);
      if (fileItem) {
        fileItem.classList.remove('selected');
      }
    }

    // Update the multi-edit panel count or hide it if no models are selected
    const countElement = document.getElementById('multi-edit-count');
    if (countElement) {
      countElement.textContent = `${selectedModels.size} model${selectedModels.size !== 1 ? 's' : ''} selected`;
    }

    if (selectedModels.size === 0) {
      const multiEditPanel = document.getElementById('multi-edit-panel');
      if (multiEditPanel) {
        multiEditPanel.classList.add('hidden');
      }
      isMultiSelectMode = false;
    }
  }

  if (['designer', 'parentModel', 'license', 'tags'].includes(field)) {
    await Promise.all([
      populateDesignerDropdown(),
      populateLicenseFilter(),
      populateParentModelFilter(),
      populateTagFilter()
    ]);
  }
}
