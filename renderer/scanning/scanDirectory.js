// scanning/scanDirectory.js

function setupScanDirectoryButton() {
  // Add scan directory button event listener
  document.getElementById('scan-directory-button')?.addEventListener('click', async () => {
    if (isScanning) return; // Prevent multiple scans

    const directoryPath = await window.electron.openFileDialog();
    if (!directoryPath || directoryPath.length === 0) return;

    await window.electron.saveDirectory(directoryPath[0]);
    console.log('Scanning directory:', directoryPath[0]);

    // Disable the button and update its appearance
    const scanButton = document.getElementById('scan-directory-button');
    scanButton.disabled = true;
    scanButton.style.opacity = '0.5';
    scanButton.style.cursor = 'not-allowed';
    isScanning = true;

    // Show progress section
    showProgressBars();

    try {
      // Update progress bars
      const progressSection = document.getElementById('progress-section');
      const progressContainer = document.getElementById('progress-container');
      const progressBar = document.getElementById('progress-bar');
      const progressText = document.getElementById('progress-text');
      const renderProgressContainer = document.getElementById('render-progress-container');
      const renderProgressBar = document.getElementById('render-progress-bar');
      const renderProgressText = document.getElementById('render-progress-text');

      progressSection.classList.remove('hidden');
      progressContainer.classList.remove('hidden');
      renderProgressContainer.classList.remove('hidden');

      // Listen for progress updates
      window.electron.onScanProgress((progress) => {
        const percent = (progress.processed / progress.total) * 100;
        progressBar.style.width = `${percent}%`;
        progressText.textContent = `Gathering files: ${progress.total}`;
      });

      window.electron.onDbProgress((progress) => {
        const percent = (progress.processed / progress.total) * 100;
        renderProgressBar.style.width = `${percent}%`;
        renderProgressText.textContent = `Processing models: ${progress.processed} / ${progress.total}`;
      });

      // This function now handles both scanning and thumbnail generation
      await scanAndRenderDirectory(directoryPath[0]);

      // Update UI after scan completes
      await populateDesignerDropdown();
      await populateParentModelFilter();
      await populateTagFilter();
      await populateLicenseFilter();

      // Reset filters
      document.getElementById('designer-select').value = '';
      document.getElementById('parent-select').value = '';
      document.getElementById('printed-select').value = 'all';
      document.getElementById('tag-filter').value = '';

      // Load and display models
      const allModels = await window.electron.getAllModels();
      await renderFiles(allModels);

      // Update counts
      await updateModelCounts(allModels.length);

    } catch (error) {
      console.error('Error scanning directory:', error);
      await window.electron.showMessage('Error', 'Failed to scan directory');
    } finally {
      hideProgressBars();
      // Re-enable the button
      scanButton.disabled = false;
      scanButton.style.opacity = '1';
      scanButton.style.cursor = 'pointer';
      isScanning = false;
    }
  });
}

// Update showSpinner function to show progress section instead
function showProgressBars() {
  const progressSection = document.getElementById('progress-section');
  const progressBar = document.getElementById('progress-bar');
  const renderProgressBar = document.getElementById('render-progress-bar');
  const progressText = document.getElementById('progress-text');
  const renderProgressText = document.getElementById('render-progress-text');

  progressSection.classList.remove('hidden');
  progressBar.style.width = '0%';
  renderProgressBar.style.width = '0%';
  progressText.textContent = '0 / 0 files';
  renderProgressText.textContent = '0 / 0 models';
}

// Update hideSpinner function
function hideProgressBars() {
  const progressSection = document.getElementById('progress-section');
  progressSection.classList.add('hidden');
}


function resetScanProgressUI() {
  const bar = document.getElementById('render-progress-bar');
  const text = document.getElementById('render-progress-text');
  if (bar) bar.style.width = '0%';
  if (text) text.textContent = 'Starting...';
}
