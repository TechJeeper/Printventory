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


// Helper function to create a DOM element for a model item
function createModelItem(model) {
  const item = document.createElement('div');
  item.className = 'file-item';
  item.dataset.filepath = model.filePath;

  // Print status element
  const printStatus = document.createElement('div');
  printStatus.className = 'print-status' + (model.printed ? ' printed' : '');
  printStatus.textContent = model.printed ? 'Printed' : 'Not Printed';
  item.appendChild(printStatus);

  // Thumbnail container with fixed size
  const thumbnailContainer = document.createElement('div');
  thumbnailContainer.className = 'thumbnail-container';
  const img = document.createElement('img');
  // Use model.thumbnail if available, otherwise use fallback image
  img.src = model.thumbnail || '3d.png';
  img.style.width = '250px';
  img.style.height = '250px';
  thumbnailContainer.appendChild(img);
  item.appendChild(thumbnailContainer);

  // File info container
  const fileInfo = document.createElement('div');
  fileInfo.className = 'file-info';

  // File name element
  const fileName = document.createElement('div');
  fileName.className = 'file-name';
  fileName.textContent = model.fileName || '';
  fileInfo.appendChild(fileName);

  // Add designer info if available
  if (model.designer) {
    const designerInfo = document.createElement('div');
    designerInfo.className = 'designer-info';
    designerInfo.innerHTML = `<span class="directory-label">Designer:</span> ${model.designer}`;
    fileInfo.appendChild(designerInfo);
  }

  item.appendChild(fileInfo);

  // Add click event handler for model selection
  item.addEventListener('click', () => {
    toggleModelSelection(item, model.filePath);
  });

  return item;
}

// Virtual grid function—renders only items visible in the scroll window.
function renderVirtualGrid(models) {
  const container = document.querySelector('.file-grid');
  container.innerHTML = ''; // clear existing content
  container.style.position = 'relative';
  container.style.overflowY = 'auto';

  // Assume fixed item size (in pixels)
  const itemWidth = 250;   // fixed model width (including margins)
  const itemHeight = 300;  // fixed model height
  const containerWidth = container.clientWidth;
  // Calculate number of columns (at least 1)
  const columns = Math.max(Math.floor(containerWidth / itemWidth), 1);
  const rowCount = Math.ceil(models.length / columns);

  // Create a spacer element of full height to allow scrolling
  const spacer = document.createElement('div');
  spacer.style.height = (rowCount * itemHeight) + 'px';
  container.appendChild(spacer);

  // Create an absolutely positioned element within the container to hold the items
  const virtualContent = document.createElement('div');
  virtualContent.style.position = 'absolute';
  virtualContent.style.top = '0';
  virtualContent.style.left = '0';
  virtualContent.style.width = '100%';
  container.appendChild(virtualContent);

  // Function to (re)render only the visible rows (plus a small buffer)
  function renderVisibleItems() {
    const scrollTop = container.scrollTop;
    const containerHeight = container.clientHeight;
    const buffer = 2; // extra rows to render before and after the visible area
    const startRow = Math.max(0, Math.floor(scrollTop / itemHeight) - buffer);
    const endRow = Math.min(rowCount, Math.ceil((scrollTop + containerHeight) / itemHeight) + buffer);

    // Clear and re-render only the visible items
    virtualContent.innerHTML = '';
    for (let row = startRow; row < endRow; row++) {
      for (let col = 0; col < columns; col++) {
        const index = row * columns + col;
        if (index >= models.length) break;
        const model = models[index];
        const item = createModelItem(model);
        item.style.position = 'absolute';
        item.style.top = (row * itemHeight) + 'px';
        item.style.left = (col * itemWidth) + 'px';
        virtualContent.appendChild(item);
      }
    }
  }

  // Attach the scroll event handler to update visible items on scroll
  container.addEventListener('scroll', renderVisibleItems);
  // Initial render of visible items
  renderVisibleItems();
}