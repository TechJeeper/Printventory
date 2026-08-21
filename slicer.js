// slicer.js
// This module handles the Slicer Settings panel in the renderer process

let slicerEntries = [];

function suggestSlicerNameFromPath(slicerPath) {
  const base = String(slicerPath || '').split(/[/\\]/).pop() || '';
  const withoutExt = base.replace(/\.(exe|app|appimage|dmg)$/i, '');
  const spaced = withoutExt.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!spaced) return '';
  return spaced.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

function applySlicerPathToEntry(entryEl, filePath) {
  if (!entryEl || !filePath) return;
  const pathInput = entryEl.querySelector('.slicer-path');
  const nameInput = entryEl.querySelector('.slicer-name');
  if (pathInput) pathInput.value = filePath;
  if (nameInput && !nameInput.value.trim()) {
    nameInput.value = suggestSlicerNameFromPath(filePath);
  }
}

async function createSlicerEntry(slicer = { name: '', path: '' }) {
  const template = document.getElementById('slicer-entry-template');
  if (!template) {
    console.error('Slicer entry template not found');
    return null;
  }

  const entry = template.content.cloneNode(true);
  const container = entry.querySelector('.slicer-entry');
  const nameInput = entry.querySelector('.slicer-name');
  const pathInput = entry.querySelector('.slicer-path');
  
  // Generate unique IDs for the inputs to avoid conflicts
  const uniqueId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
  nameInput.id = `slicer-name-${uniqueId}`;
  pathInput.id = `slicer-path-${uniqueId}`;
  
  // Set initial values and store them in data attributes
  nameInput.value = slicer.name || '';
  pathInput.value = slicer.path || '';
  nameInput.dataset.originalValue = slicer.name || '';
  pathInput.dataset.originalValue = slicer.path || '';
  
  // Always make both fields editable (never readonly) - users should be able to type name before path
  nameInput.removeAttribute('readonly');
  nameInput.disabled = false;
  pathInput.removeAttribute('readonly');
  pathInput.disabled = false;
  
  // Check if we're in server mode
  const serverMode = await window.electron.isServerMode().catch(() => false);
  
  // Update placeholder for path field in server mode
  if (serverMode) {
    pathInput.placeholder = 'Enter slicer path on your workstation';
  }

  // If user pastes/types a path first, fill an empty name from the executable
  pathInput.addEventListener('change', () => {
    if (!nameInput.value.trim() && pathInput.value.trim()) {
      nameInput.value = suggestSlicerNameFromPath(pathInput.value.trim());
    }
  });
  
  // Add browse button handler
  const browseButton = entry.querySelector('.browse-slicer-button');
  browseButton.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (serverMode) {
      // In server mode: try to use Electron's native dialog first (works if accessed via Electron)
      // This provides full paths, unlike HTML file input which only provides filenames
      try {
        // Check if Electron IPC is available
        if (window.electron && typeof window.electron.openSlicerDialog === 'function') {
          // Store current values before dialog
          const currentValues = Array.from(document.querySelectorAll('.slicer-entry')).map(entry => ({
            name: entry.querySelector('.slicer-name').value,
            path: entry.querySelector('.slicer-path').value
          }));
          
          // Add timeout to IPC call - if it takes too long, fall back to HTML input
          const dialogPromise = window.electron.openSlicerDialog('Select Slicer');
          const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('IPC timeout')), 2000)
          );
          
          const result = await Promise.race([dialogPromise, timeoutPromise]);
          
          // Restore all values after dialog
          document.querySelectorAll('.slicer-entry').forEach((entry, index) => {
            if (currentValues[index]) {
              entry.querySelector('.slicer-name').value = currentValues[index].name;
              entry.querySelector('.slicer-path').value = currentValues[index].path;
            }
          });
          
          // Update only this entry's path (and name if still empty)
          if (!result.canceled && result.filePaths && result.filePaths.length > 0) {
            const thisEntry = e.target.closest('.slicer-entry');
            applySlicerPathToEntry(thisEntry, result.filePaths[0]);
          }
          return; // Successfully used Electron dialog
        }
      } catch (error) {
        console.log('Electron dialog not available, falling back to HTML file input:', error);
      }
      
      // Fallback: use HTML5 file input (only provides filename, user must complete path manually)
      // IMPORTANT: Must be triggered directly from user click, not in setTimeout, to satisfy browser security
      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.style.display = 'none';
      
      // Set accept filter based on platform
      // On Windows, filter for .exe files
      // On macOS, we can't easily filter for .app (they're directories), so accept all
      // On Linux, accept all files (executables typically have no extension)
      if (navigator.platform.toLowerCase().includes('win')) {
        fileInput.accept = '.exe,application/x-msdownload';
      } else {
        // For macOS and Linux, accept all files
        fileInput.accept = '*/*';
      }
      
      let fileSelected = false;
      
      fileInput.addEventListener('change', (event) => {
        fileSelected = true;
        const file = event.target.files[0];
        if (file) {
          // Try to get the full path
          // In Electron (even in server mode via webview), file.path might be available
          // In pure browser, we only get file.name due to security restrictions
          const thisEntry = pathInput.closest('.slicer-entry');
          if (file.path) {
            // Electron provides the full path
            applySlicerPathToEntry(thisEntry, file.path);
          } else {
            // Pure browser - we only have the filename
            // Show the filename and let user know they may need to complete the path
            const fileName = file.name;
            applySlicerPathToEntry(thisEntry, fileName);
            
            // Show a helpful message
            const message = 'Browser security only provides the filename. ' +
              'If the path shown is incomplete, please manually enter the full path to the slicer executable.\n\n' +
              'Example: C:\\Program Files\\PrusaSlicer\\prusa-slicer.exe';
            setTimeout(() => {
              alert(message);
            }, 100);
          }
        }
        // Clean up
        setTimeout(() => {
          if (fileInput.parentNode) {
            fileInput.parentNode.removeChild(fileInput);
          }
        }, 100);
      });
      
      // Add to DOM immediately
      document.body.appendChild(fileInput);
      
      // Trigger click immediately (must be synchronous with user event handler)
      // Try direct click first, then fallback to requestAnimationFrame if needed
      try {
        // Direct click - this must happen synchronously in the user event handler
        fileInput.click();
      } catch (error) {
        console.error('Error triggering file input directly:', error);
        // Fallback: try with requestAnimationFrame (may not work due to browser security)
        requestAnimationFrame(() => {
          try {
            fileInput.click();
          } catch (error2) {
            console.error('Error triggering file input:', error2);
            // If click fails, show message to user
            alert('Unable to open file dialog. Please manually enter the slicer path in the input field.\n\n' +
              'Example: C:\\Program Files\\PrusaSlicer\\prusa-slicer.exe');
          }
        });
      }
      
      // Clean up if no file is selected after a reasonable time (user cancelled)
      setTimeout(() => {
        if (!fileSelected && fileInput.parentNode) {
          fileInput.parentNode.removeChild(fileInput);
        }
      }, 500);
    } else {
      // Normal mode: use file dialog
      // Store current values before dialog
      const currentValues = Array.from(document.querySelectorAll('.slicer-entry')).map(entry => ({
        name: entry.querySelector('.slicer-name').value,
        path: entry.querySelector('.slicer-path').value
      }));
      
      const result = await window.electron.openSlicerDialog('Select Slicer');
      
      // Restore all values after dialog
      document.querySelectorAll('.slicer-entry').forEach((entry, index) => {
        if (currentValues[index]) {
          entry.querySelector('.slicer-name').value = currentValues[index].name;
          entry.querySelector('.slicer-path').value = currentValues[index].path;
        }
      });
      
      // Update only this entry's path (and name if still empty)
      if (!result.canceled && result.filePaths && result.filePaths.length > 0) {
        const thisEntry = e.target.closest('.slicer-entry');
        applySlicerPathToEntry(thisEntry, result.filePaths[0]);
      }
    }
  });
  
  // Both fields are already made editable above, but ensure they remain editable
  // (This is a safety check in case something else tries to disable them)
  nameInput.removeAttribute('readonly');
  nameInput.disabled = false;
  pathInput.removeAttribute('readonly');
  pathInput.disabled = false;
  
  // Add remove button handler
  const removeButton = entry.querySelector('.remove-slicer-button');
  removeButton.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const thisEntry = e.target.closest('.slicer-entry');
    if (thisEntry) {
      thisEntry.remove();
    }
  });
  
  return container;
}

async function openSlicerSettings() {
  const dialog = document.getElementById('slicer-dialog');
  if (!dialog) return;
  
  const slicerList = dialog.querySelector('#slicer-list');
  if (!slicerList) return;
  
  // Prevent form submission
  const form = dialog.querySelector('form');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
  });
  
  slicerList.innerHTML = '';
  
  // Load existing slicers
  window.electron.getSlicers()
    .then(async (slicers) => {
      if (slicers && slicers.length > 0) {
        for (const slicer of slicers) {
          const entry = await createSlicerEntry(slicer);
          if (entry) {
            slicerList.appendChild(entry);
          }
        }
      }
    })
    .catch(err => {
      console.error('Error loading slicers:', err);
    });
  
  dialog.showModal();
}

function saveSlicerSettings() {
  const entries = document.querySelectorAll('.slicer-entry');
  const slicers = Array.from(entries).map(entry => ({
    name: entry.querySelector('.slicer-name').value.trim(),
    path: entry.querySelector('.slicer-path').value.trim()
  }));
  
  // Validate entries
  const invalidEntries = slicers.filter(s => !s.name || !s.path);
  if (invalidEntries.length > 0) {
    alert('Please fill in both name and path for all slicers.');
    return;
  }
  
  // Save all slicers - drop and recreate
  window.electron.clearAndSaveSlicers(slicers)
    .then(() => {
      alert('Slicer settings saved successfully.');
      document.getElementById('slicer-dialog').close();
    })
    .catch(err => {
      alert('Error saving slicer settings: ' + err.message);
      console.error('Error saving slicer settings:', err);
    });
}

document.addEventListener('DOMContentLoaded', () => {
  const dialog = document.getElementById('slicer-dialog');
  if (!dialog) return;

  // Prevent form submission
  const form = dialog.querySelector('form');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
  });
  
  // Add new slicer button handler
  document.getElementById('add-slicer-button')?.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const slicerList = document.getElementById('slicer-list');
    const entry = await createSlicerEntry();
    if (entry) {
      slicerList.appendChild(entry);
      // Name is editable immediately — focus it so users can type before picking a path
      const nameInput = entry.querySelector('.slicer-name');
      if (nameInput) {
        requestAnimationFrame(() => nameInput.focus());
      }
    }
  });
  
  // Add save button handler
  document.getElementById('save-slicer-settings')?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    saveSlicerSettings();
  });
  
  // Add cancel button handler
  document.getElementById('cancel-slicer-settings')?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    document.getElementById('slicer-dialog').close();
  });
  
  // Listen for the event from main process
  window.electron.onOpenSlicerSettings(() => {
    openSlicerSettings();
  });

  window.openSlicerSettings = openSlicerSettings;
});
