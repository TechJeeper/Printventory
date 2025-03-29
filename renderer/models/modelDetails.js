// models/modelDetails.js

function setupModelDetailsHandlers() {
  const modelDetailsPanel = document.getElementById('model-details');
  const printCheckbox = document.getElementById('model-printed');
  const sourceInput = document.getElementById('model-source');
  const designerSelect = document.getElementById('model-designer');
  const parentSelect = document.getElementById('model-parent');
  const licenseSelect = document.getElementById('model-license');
  const notesInput = document.getElementById('model-notes');
  const saveButton = document.getElementById('save-model-button');

  if (!modelDetailsPanel) return;

  printCheckbox?.addEventListener('change', () => autoSaveModel());
  sourceInput?.addEventListener('change', () => autoSaveModel());
  designerSelect?.addEventListener('change', () => autoSaveModel());
  parentSelect?.addEventListener('change', () => autoSaveModel());
  licenseSelect?.addEventListener('change', () => autoSaveModel());
  notesInput?.addEventListener('input', debounce(() => autoSaveModel(), 300));

  saveButton?.addEventListener('click', () => autoSaveModel());

  document.getElementById('model-path')?.addEventListener('dblclick', (e) => {
    const path = e.target.value;
    if (path) {
      window.electron.showItemInFolder(path);
    }
  });

  document.getElementById('open-file-button')?.addEventListener('click', () => {
    const path = document.getElementById('model-path')?.value;
    if (path) {
      window.electron.showItemInFolder(path);
    }
  });

  document.getElementById('fetch-source-button')?.addEventListener('click', async () => {
    const sourceInput = document.getElementById('model-source');
    const url = sourceInput.value.trim();

    if (!url) {
      await window.electron.showMessage('Error', 'Please enter a source URL');
      return;
    }

    try {
      if (url.includes('thangs.com')) {
        // Extract designer and model name from URL
        const urlParts = url.split('/');
        const designerIndex = urlParts.indexOf('designer');

        if (designerIndex !== -1 && designerIndex + 1 < urlParts.length) {
          const designer = urlParts[designerIndex + 1];

          // Find the model name after "3d-model/"
          const modelIndex = urlParts.indexOf('3d-model');
          if (modelIndex !== -1 && modelIndex + 1 < urlParts.length) {
            let modelName = urlParts[modelIndex + 1];
            // Clean up the model name by replacing URL encoding
            modelName = decodeURIComponent(modelName)
              .replace(/-/g, ' ')  // Replace hyphens with spaces
              .replace(/\.stl$|\.3mf$/i, ''); // Remove file extension if present

            // Update the designer field
            const designerSelect = document.getElementById('model-designer');
            if (!Array.from(designerSelect.options).some(opt => opt.value === designer)) {
              const option = document.createElement('option');
              option.value = designer;
              option.textContent = designer;
              designerSelect.appendChild(option);
            }
            designerSelect.value = designer;

            // Update the parent model field
            const parentSelect = document.getElementById('model-parent');
            if (!Array.from(parentSelect.options).some(opt => opt.value === modelName)) {
              const option = document.createElement('option');
              option.value = modelName;
              option.textContent = modelName;
              parentSelect.appendChild(option);
            }
            parentSelect.value = modelName;

            // Trigger auto-save for both fields
            const filePath = document.getElementById('model-path').value;
            await autoSaveModel('designer', designer, filePath);
            await autoSaveModel('parentModel', modelName, filePath);
          }
        }
      } else if (url.includes('makerworld.com')) {
        try {
          // Use window.electron to fetch the page content to avoid CORS issues
          const pageData = await window.electron.fetchMakerWorldPage(url);

          if (pageData) {
            let designer = pageData.designer;
            let modelName = pageData.modelName;

            // Update the designer field
            const designerSelect = document.getElementById('model-designer');
            if (designer && !Array.from(designerSelect.options).some(opt => opt.value === designer)) {
              const option = document.createElement('option');
              option.value = designer;
              option.textContent = designer;
              designerSelect.appendChild(option);
            }
            if (designer) {
              designerSelect.value = designer;
            }

            // Update the parent model field
            const parentSelect = document.getElementById('model-parent');
            if (modelName && !Array.from(parentSelect.options).some(opt => opt.value === modelName)) {
              const option = document.createElement('option');
              option.value = modelName;
              option.textContent = modelName;
              parentSelect.appendChild(option);
            }
            if (modelName) {
              parentSelect.value = modelName;
            }

            // Trigger auto-save for both fields
            const filePath = document.getElementById('model-path').value;
            if (designer) {
              await autoSaveModel('designer', designer, filePath);
            }
            if (modelName) {
              await autoSaveModel('parentModel', modelName, filePath);
            }
          }
        } catch (error) {
          console.error('Error fetching MakerWorld page:', error);
          await window.electron.showMessage('Error', 'Failed to fetch MakerWorld page details: ' + error.message);
        }
      } else {
        await window.electron.showMessage('Error', 'Only Thangs.com and Makerworld.com URLs are currently supported');
      }
    } catch (error) {
      console.error('Error fetching page:', error);
      await window.electron.showMessage('Error', 'Failed to fetch page details: ' + error.message);
    }
  });

}
