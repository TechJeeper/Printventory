
async function initializeApp() {
  try {
    // Initialize the combined search functionality from search.js
    if (typeof window.initializeCombinedSearch === 'function') {
      window.initializeCombinedSearch();
    }

    console.log('1. Starting initialization sequence');

    // Initialize all settings first
    console.log('2. Loading settings...');
    await initializeSettings();

    console.log('3. Checking current version...');
    const currentVersion = await window.electron.getSetting('currentVersion');
    const isBeta = (await window.electron.getSetting('betaOptIn')) === 'true';

    console.log('4. Current app state:', {
      currentVersion,
      isBeta,
      checkingForUpdates: true
    });

    // Check if version check was already performed by main process
    const versionCheckPerformed = await window.electron.getSetting('versionCheckPerformedOnStartup');
    let latestVersion;

    if (versionCheckPerformed === 'true') {
      console.log('5. Version check already performed by main process, retrieving stored version');
      // Get the latest version from the database instead of making another HTTP request
      latestVersion = await window.electron.getSetting('latestVersion');
      console.log('Retrieved latest version from database:', latestVersion);
    } else {
      console.log('5. Checking for updates...');
      latestVersion = await window.electron.checkForUpdates(isBeta);
    }

    // Reset the flag for next app start
    await window.electron.saveSetting('versionCheckPerformedOnStartup', 'false');

    const lastDeclinedVersion = await window.electron.getSetting('lastDeclinedVersion');

    console.log('6. Version check results:', {
      currentVersion,
      latestVersion,
      lastDeclinedVersion,
      isBeta,
      needsUpdate: latestVersion !== currentVersion
    });

    // Only show prompt if it's a new version and not the one user previously declined
    if (latestVersion &&
      latestVersion !== currentVersion &&
      latestVersion > currentVersion &&
      latestVersion !== lastDeclinedVersion) {
      console.log('7. Update available - showing prompt');
      const shouldUpdate = await window.electron.showMessage(
        'Update Available',
        `Version ${latestVersion} is available. You are currently running version ${currentVersion}. Would you like to update?`,
        ['Yes', 'No']
      );

      console.log('Renderer - Update prompt response:', shouldUpdate);
      if (shouldUpdate === 'Yes') {
        await window.electron.openUpdatePage(isBeta);
      } else {
        // Store the declined version
        console.log('Renderer - User declined update, storing version:', latestVersion);
        await window.electron.saveSetting('lastDeclinedVersion', latestVersion);
      }
    }

    // Store the latest version after check
    if (latestVersion) {
      console.log('Renderer - Saving latest version to settings:', latestVersion);
      await window.electron.saveSetting('latestVersion', latestVersion);
      await window.electron.saveSetting('lastUpdateCheck', new Date().toISOString());
    }

    console.log('8. Initializing UI components');
    initializeDialogHandlers();
    initializePerformanceSettings();

    console.log('9. Initialization complete');
  } catch (error) {
    console.error('Fatal error during initialization:', error);
    throw error; // Re-throw to be caught by the DOMContentLoaded handler
  }
}

async function initializeGrid(sortOption = 'name') {
  try {
    const models = await window.electron.getAllModels(sortOption);
    const fileGrid = document.querySelector('.file-grid');

    // Show welcome message if no models
    if (models.length === 0) {
      const welcomeDialog = document.getElementById('welcome-message');
      if (welcomeDialog && !welcomeDialog.hasAttribute('open')) {
        welcomeDialog.showModal();
      }
    }

    await updateModelCounts(models.length);
    fileGrid.innerHTML = '';
    // ... rest of grid initialization
  } catch (error) {
    console.error('Error initializing grid:', error);
  }
}

async function initializeSettings() {
  try {
    // For example, load and apply the model background color setting.
    const backgroundColor = await window.electron.getSetting('modelBackgroundColor');
    if (backgroundColor) {
      document.documentElement.style.setProperty('--model-background-color', backgroundColor);
      const bgInput = document.getElementById('model-background-color');
      if (bgInput) {
        bgInput.value = backgroundColor;
      }
    }
    // Add any additional settings initialization here as needed.
  } catch (error) {
    console.error('Error initializing settings:', error);
  }
}

async function initializePerformanceSettings() {
  try {
    // For example, load and apply performance settings.
    const maxFileSizeSetting = await window.electron.getSetting('maxFileSizeMB') || '50';
    const maxFileSizeInput = document.getElementById('max-file-size');
    if (maxFileSizeInput) {
      maxFileSizeInput.value = maxFileSizeSetting;
    }

    // Update the global variable MAX_FILE_SIZE_MB (assuming it's declared elsewhere in the file)
    MAX_FILE_SIZE_MB = parseInt(maxFileSizeSetting, 10);

    // Add additional performance-related settings initialization as needed.
  } catch (error) {
    console.error('Error initializing performance settings:', error);
  }
}

async function initializeTags() {
  const tagSelect = document.getElementById('tag-select');
  const multiTagSelect = document.getElementById('multi-tag-select');

  // Handle selecting a tag from the single edit dropdown
  tagSelect.addEventListener('change', () => {
    const selectedTag = tagSelect.value;
    if (selectedTag) {
      addTagToModel(selectedTag, 'model-tags');
      tagSelect.value = ''; // Reset selection
    }
  });

  // Handle selecting a tag from the multi edit dropdown
  multiTagSelect.addEventListener('change', () => {
    const selectedTag = multiTagSelect.value;
    if (selectedTag) {
      addTagToModel(selectedTag, 'multi-tags');
      multiTagSelect.value = ''; // Reset selection
    }
  });

  // Initial population of tag dropdowns
  await populateTagSelect('tag-select', 'model-tags');
  await populateTagSelect('multi-tag-select', 'multi-tags');
}

// Add this function to handle enabling/disabling analytics
function toggleAnalytics(enable) {
  console.log('Toggling analytics:', enable);

  const script1 = document.getElementById('analytics-script-1');
  const script2 = document.getElementById('analytics-script-2');

  if (!script1 || !script2) {
    console.log('Analytics scripts not found in the DOM');
    return;
  }

  if (enable) {
    // Enable analytics
    console.log('Enabling analytics scripts');
    script1.removeAttribute('disabled');
    script2.removeAttribute('disabled');

    // Initialize analytics if it wasn't already
    if (typeof gtag === 'undefined') {
      const newScript = document.createElement('script');
      newScript.async = true;
      newScript.src = "https://www.googletagmanager.com/gtag/js?id=G-N4766Y9R11";
      document.head.appendChild(newScript);

      newScript.onload = () => {
        window.dataLayer = window.dataLayer || [];
        function gtag(){dataLayer.push(arguments);}
        gtag('js', new Date());
        gtag('config', 'G-N4766Y9R11');
      };
    }
  } else {
    // Disable analytics
    console.log('Disabling analytics scripts');
    script1.setAttribute('disabled', '');
    script2.setAttribute('disabled', '');

    // Clear any existing analytics data
    if (window.dataLayer) {
      window.dataLayer = [];
    }
  }
}

// Add this new function
function refreshUIContent() {
  // Refresh the file grid if it exists
  const fileGrid = document.querySelector('.file-grid');
  if (fileGrid) {
    // Re-render the current view
    window.electron.getAllModels(
      document.getElementById('sort-select')?.value || 'name',
      50
    ).then(models => {
      renderFiles(models);

    }).catch(console.error);
  }
}

async function savePerformanceSettings() {
  try {
    const input = document.getElementById('max-file-size');
    if (!input) {
      throw new Error('Could not find max file size input');
    }

    const maxFileSize = parseInt(input.value);

    // Validate input
    if (isNaN(maxFileSize) || maxFileSize < 1 || maxFileSize > 1000) {
      throw new Error('Invalid max file size. Must be between 1 and 1000 MB.');
    }

    // Save to database
    await window.electron.saveSetting('maxFileSizeMB', maxFileSize.toString());

    // Update the global variable
    MAX_FILE_SIZE_MB = maxFileSize;

    // Close dialog and show success message
    const dialog = document.getElementById('performance-settings-dialog');
    if (dialog) {
      dialog.close();
    }
    await window.electron.showMessage('Success', 'Performance settings saved successfully');
  } catch (error) {
    console.error('Error saving performance settings:', error);
    await window.electron.showMessage('Error', error.message);
  }
}

// Define the collect usage change handler as a named function so we can remove it
async function collectUsageChangeHandler(e) {
  const newValue = e.target.checked ? '1' : '0';
  console.log('About dialog - Saving CollectUsage value:', newValue);

  // Save the setting
  await window.electron.saveSetting('CollectUsage', newValue);

  // Verify the setting was saved correctly
  const verifiedValue = await window.electron.checkCollectUsage();
  console.log('Verified CollectUsage value from database:', verifiedValue);

  // Update the checkbox state to match the database value
  e.target.checked = verifiedValue === '1';

  // Toggle analytics based on the verified value
  toggleAnalytics(verifiedValue === '1');
}
