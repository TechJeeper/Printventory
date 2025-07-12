// dialogs/dedup.js

function setupDedupDialogHandler() {
  const dialog = document.getElementById('dedup-dialog');

  window.electron.onOpenDeDup(() => {
    loadDuplicateFiles();
    dialog?.showModal();
  });

  async function loadDuplicateFiles() {
    try {
      // First check if there are any models with missing hashes
      const missingHashesResult = await window.electron.calculateMissingHashes();
      
      if (missingHashesResult.total > 0) {
        // Show message about hash calculation
        const duplicateGroups = dialog.querySelector('.duplicate-groups');
        duplicateGroups.innerHTML = `
          <div style="text-align: center; padding: 20px; color: #ffa500; background: rgba(255, 165, 0, 0.1); border-radius: 8px; margin-bottom: 20px;">
            <strong>Calculating file hashes...</strong><br>
            De-duplication may be inconsistent while file hashes are being calculated.<br>
            Progress: ${missingHashesResult.calculated} / ${missingHashesResult.total} files
          </div>
        `;

        // Set up progress listener
        let progressHandler = null;
        progressHandler = (progress) => {
          const progressDiv = duplicateGroups.querySelector('div');
          if (progressDiv) {
            progressDiv.innerHTML = `
              <strong>Calculating file hashes...</strong><br>
              De-duplication may be inconsistent while file hashes are being calculated.<br>
              Progress: ${progress.calculated} / ${progress.total} files
            `;
          }
        };
        window.electron.onHashCalculationProgress(progressHandler);

        // Wait for hash calculation to complete
        await new Promise((resolve) => {
          const checkProgress = () => {
            if (missingHashesResult.calculated >= missingHashesResult.total) {
              resolve();
            } else {
              setTimeout(checkProgress, 100);
            }
          };
          checkProgress();
        });
      }

      const duplicates = await window.electron.getDuplicates();
      console.log('Loaded duplicates:', duplicates);

      const duplicateGroups = dialog.querySelector('.duplicate-groups');
      duplicateGroups.innerHTML = '';

      if (!duplicates || Object.keys(duplicates).length === 0) {
        duplicateGroups.innerHTML = `
          <div style="text-align: center; padding: 20px; color: #888;">
            No duplicate models found
          </div>
        `;
        dialog.querySelector('#delete-selected').style.display = 'none';
        return;
      }

      const deleteButton = dialog.querySelector('#delete-selected');
      deleteButton.style.display = '';
      deleteButton.replaceWith(deleteButton.cloneNode(true));
      const newDeleteButton = dialog.querySelector('#delete-selected');
      newDeleteButton.addEventListener('click', handleDeleteSelected);

      for (const [hash, files] of Object.entries(duplicates)) {
        const group = document.createElement('div');
        group.className = 'duplicate-group';

        const preview = document.createElement('div');
        preview.className = 'duplicate-preview';

        try {
          const thumbnail = await window.electron.getThumbnail(files[0].filePath);
          if (thumbnail) {
            const img = document.createElement('img');
            img.src = encodeURI(thumbnail);
            preview.appendChild(img);
          } else {
            preview.innerHTML = '<div class="error-message">No preview available</div>';
          }
        } catch (error) {
          console.error('Error getting thumbnail:', error);
          preview.innerHTML = '<div class="error-message">No preview available</div>';
        }

        const filesList = document.createElement('div');
        filesList.className = 'duplicate-files';

        const header = document.createElement('div');
        header.className = 'duplicate-header';
        header.textContent = `${files.length} duplicate files found`;
        filesList.appendChild(header);

        files.forEach(file => {
          const fileDiv = document.createElement('div');
          fileDiv.className = 'duplicate-file';

          const checkbox = document.createElement('input');
          checkbox.type = 'checkbox';
          checkbox.setAttribute('data-filepath', file.filePath);

          const filePath = document.createElement('span');
          filePath.className = 'duplicate-file-path';
          filePath.textContent = file.filePath;

          const fileSize = document.createElement('span');
          fileSize.className = 'duplicate-file-size';
          fileSize.textContent = formatFileSize(file.size);

          fileDiv.appendChild(checkbox);
          fileDiv.appendChild(filePath);
          fileDiv.appendChild(fileSize);
          filesList.appendChild(fileDiv);
        });

        group.appendChild(preview);
        group.appendChild(filesList);
        duplicateGroups.appendChild(group);
      }
    } catch (error) {
      console.error('Error loading duplicates:', error);
      await window.electron.showMessage('Error', 'Failed to load duplicate files');
    }
  }

  async function handleDeleteSelected() {
    const checkboxes = document.querySelectorAll('.duplicate-file input[type="checkbox"]:checked');
    const paths = Array.from(checkboxes).map(cb => cb.getAttribute('data-filepath'));

    if (paths.length === 0) {
      await window.electron.showMessage('Info', 'No files selected for deletion.');
      return;
    }

    const confirmed = await window.electron.showMessage(
      'Confirm Delete',
      `Are you sure you want to delete ${paths.length} file(s)?`,
      ['Yes', 'No']
    );

    if (confirmed === 'Yes') {
      for (const path of paths) {
        try {
          await window.electron.deleteFile(path);
        } catch (error) {
          console.error(`Error deleting file ${path}:`, error);
        }
      }

      await loadDuplicateFiles(); // Refresh view
    }
  }

} 