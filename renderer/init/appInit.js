// Add event listeners for all filter changes
document.addEventListener('DOMContentLoaded', async () => {
  const filterElements = [
    'designer-select',
    'license-select',
    'parent-select',
    'printed-select',
    'tag-filter',
    'sort-select',
    'filetype-select'  // Add this line
  ];

  filterElements.forEach(elementId => {
    const element = document.getElementById(elementId);
    if (element) {
      element.addEventListener('change', handleFilterChange);
    }
  });


  try {
    // Initialize the application
    await initializeApp();

    // Set up multi-edit button handler
    const multiEditBtn = document.getElementById('multi-edit-btn');
    if (multiEditBtn) {
      multiEditBtn.addEventListener('click', async () => {
        await showMultiEditPanel();
      });
    }

    // Set up multi-edit close button
    const closeMultiEditBtn = document.getElementById('close-multi-edit');
    if (closeMultiEditBtn) {
      closeMultiEditBtn.addEventListener('click', () => {
        exitMultiEditMode();
      });
    }

    // Initialize multi-edit tag handling
    const addMultiEditTagBtn = document.getElementById('add-multi-edit-tag');
    if (addMultiEditTagBtn) {
      addMultiEditTagBtn.addEventListener('click', async () => {
        const tagSelect = document.getElementById('multi-edit-tag-select');
        if (tagSelect && tagSelect.value) {
          await autoSaveMultipleModels('tags', tagSelect.value);
          tagSelect.value = ''; // Reset selection
        }
      });
    }

    // Debug log for initialization
    debugLog('Multi-edit panel initialization complete');

  } catch (error) {
    console.error('Error during application initialization:', error);
  }


  // ... existing code ...

  // Initialize analytics checkbox
  const collectUsageCheckbox = document.getElementById('collect-usage');
  if (collectUsageCheckbox) {
    // Get initial value
    const collectUsage = await window.electron.getSetting('CollectUsage');
    console.log('Initial CollectUsage value:', collectUsage);

    // Set checkbox state based on the actual value
    collectUsageCheckbox.checked = collectUsage === '1';

    // Handle changes using the same handler as in the about dialog
    collectUsageCheckbox.addEventListener('change', collectUsageChangeHandler);

    // Initialize analytics state with current setting
    toggleAnalytics(collectUsage === '1');
  }

  // Add visibility change handler
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      // Force a refresh of the UI
      requestAnimationFrame(() => {
        // Refresh any dynamic content that might be stale
        refreshUIContent();
      });
    }
  });

  // Assuming this is where the menu item is defined
  document.getElementById("guide-button")?.addEventListener("click", function() {
    // Call the new guide function
    window.electron.send('open-guide'); // Ensure this sends the correct event to show the new guide
  });


  // Initialize settings
  await initializeSettings();

  // Add performance settings dialog handlers
  window.electron.onOpenPerformanceSettings(() => {
    const dialog = document.getElementById('performance-settings-dialog');
    if (dialog) {
      initializePerformanceSettings();
      dialog.showModal();
    }
  });

  // Remove the form submit handler and only use the save button
  const saveButton = document.getElementById('save-performance-settings');
  if (saveButton) {
    saveButton.addEventListener('click', async () => {
      await savePerformanceSettings();
    });
  }

  const cancelButton = document.getElementById('cancel-performance-settings');
  if (cancelButton) {
    cancelButton.addEventListener('click', () => {
      const dialog = document.getElementById('performance-settings-dialog');
      if (dialog) {
        dialog.close();
      }
    });
  }

  try {
    // Initialize all settings first
    await initializeSettings();

    // Initialize dialog handlers
    initializeDialogHandlers();

    // Initialize performance settings handlers
    await initializePerformanceSettings();

    // Check for updates on startup (silent)
    await checkForUpdates(true);

  } catch (error) {
    console.error('Error during initialization:', error);
  }

  // Enable paste on source inputs
  ['model-source', 'multi-source'].forEach(id => {
    const input = document.getElementById(id);
    if (input) {
      input.addEventListener('paste', (e) => {
        e.stopPropagation();
      });
    }
  });
  // Add click handlers to all tag dropdowns
  document.querySelectorAll('.tags-input-container select').forEach(dropdown => {
    dropdown.addEventListener('mousedown', async (event) => {
      // Prevent the default dropdown from showing immediately
      event.preventDefault();

      // Refresh the dropdown content
      await refreshTagDropdown(dropdown);

      // Show the dropdown
      dropdown.click();
    });
  });

  // Also add the handler for dynamically created dropdowns
  document.body.addEventListener('mousedown', async (event) => {
    if (event.target.matches('.tags-input-container select')) {
      event.preventDefault();
      await refreshTagDropdown(event.target);
      event.target.click();
    }
  });
  await initializeSettings();


  // Add these functions at an appropriate location
  async function checkForUpdates(silent = false) {
    try {
      const currentVersion = await window.electron.getSetting('currentVersion');
      const isBeta = (await window.electron.getSetting('betaOptIn')) === 'true';

      console.log('Checking for updates:', {
        currentVersion,
        isBeta,
        checkType: silent ? 'startup' : 'manual',
        endpoint: isBeta ? 'beta.version' : 'public.version'
      });

      // Get latest version from web
      const latestVersion = await window.electron.checkForUpdates(isBeta);
      if (!latestVersion) return;

      console.log('Version check result:', {
        currentVersion,
        latestVersion,
        isBeta,
        needsUpdate: latestVersion !== currentVersion
      });

      // Store the latest version
      await window.electron.saveSetting('latestVersion', latestVersion);
      await window.electron.saveSetting('lastUpdateCheck', new Date().toISOString());

      // Compare versions
      if (latestVersion !== currentVersion && latestVersion > currentVersion) {
        // Always show update prompt if there's an update, even on startup
        const shouldUpdate = await window.electron.showMessage(
          'Update Available',
          `Version ${latestVersion} is available. You are currently running version ${currentVersion}. Would you like to update?`,
          ['Yes', 'No']
        );

        if (shouldUpdate === 'Yes') {
          await window.electron.openUpdatePage(isBeta);
        } else {
          // Store the declined version
          console.log('User declined update, storing version:', latestVersion);
          await window.electron.saveSetting('lastDeclinedVersion', latestVersion);
        }
      } else if (!silent) {
        await window.electron.showMessage(
          'Up to Date',
          'You are running the latest version.'
        );
      }
    } catch (error) {
      console.error('Error checking for updates:', error);
      if (!silent) {
        await window.electron.showMessage(
          'Error',
          'Failed to check for updates. Please try again later.'
        );
      }
    }
  }


});
