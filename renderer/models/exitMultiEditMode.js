// Update the exit multi-edit mode functionality
function exitMultiEditMode() {
  // Clear selections
  selectedModels.clear();
  document.querySelectorAll('.file-item').forEach(item => {
    item.classList.remove('selected');
  });

  // Update the selection count display
  updateSelectedCount();

  // Switch back to single edit mode
  isMultiSelectMode = false;
  const multiEditPanel = document.getElementById('multi-edit-panel');
  const detailsPanel = document.getElementById('model-details');
  multiEditPanel.classList.add('hidden');
  detailsPanel.classList.remove('hidden');
  document.getElementById('edit-mode-toggle').textContent = 'Multi-Edit Mode';
  document.getElementById('edit-mode-toggle').classList.remove('active');

  // Remove all event listeners from model form fields
  const formFields = [
    'model-designer',
    'model-source',
    'model-notes',
    'model-printed',
    'model-parent',
    'model-license'
  ];

  formFields.forEach(fieldId => {
    const element = document.getElementById(fieldId);
    if (element) {
      // Clone and replace the element to remove all event listeners
      const newElement = element.cloneNode(true);
      element.parentNode.replaceChild(newElement, element);
    }
  });

  // Clear the form
  document.getElementById('model-path').value = '';
  document.getElementById('model-name').value = '';
  document.getElementById('model-designer').value = '';
  document.getElementById('model-source').value = '';
  document.getElementById('model-notes').value = '';
  document.getElementById('model-printed').checked = false;
  document.getElementById('model-parent').value = '';
  document.getElementById('model-license').value = '';
  document.getElementById('model-tags').innerHTML = '';
}
