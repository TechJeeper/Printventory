// dialogs/tagManager.js

function setupTagManagerDialog() {

  const selectedTags = new Set();

  window.electron.onOpenTagManager(() => {
    tagManagerDialog?.showModal();
    searchInput.value = '';
    refreshTagManagerList();
  });


  if (searchInput) {
    searchInput.addEventListener('input', debounce(async (e) => {
      await refreshTagManagerList(e.target.value.trim());
    }, 300));
  }

  clearSearchBtn?.addEventListener('click', async () => {
    searchInput.value = '';
    await refreshTagManagerList();
  });

  addTagButton?.addEventListener('click', async () => {
    const tagName = newTagInput.value.trim();
    if (tagName) {
      try {
        await window.electron.saveTag(tagName);
        newTagInput.value = '';
        allTags = [];
        const searchTerm = searchInput.value.trim();
        await refreshTagManagerList(searchTerm);
        await populateTagSelect?.();
        await populateTagFilter?.();
      } catch (error) {
        console.error('Error saving tag:', error);
        await window.electron.showMessage('Error', 'Failed to create tag');
      }
    }
  });
}

async function refreshTagManagerList(searchTerm = '') {
  tagList.innerHTML = '';

  try {
    if (allTags.length === 0 || !searchTerm) {
      allTags = await window.electron.getAllTags();
    }

    const filtered = searchTerm
      ? allTags.filter(tag => tag.name.toLowerCase().includes(searchTerm.toLowerCase()))
      : allTags;

    // Sort tags alphabetically by name
    const sortedTags = filtered.sort((a, b) => a.name.localeCompare(b.name));

    sortedTags.forEach(tag => {
      const el = document.createElement('div');
      el.className = 'tag';
      el.innerHTML = `
          ${tag.name}
          <span class="tag-count">${tag.model_count}</span>
          <span class="tag-remove">×</span>
        `;

      el.querySelector('.tag-remove')?.addEventListener('click', async () => {
        if (tag.model_count > 0) {
          const response = await window.electron.showMessage(
            'Delete Tag',
            `This tag is used by ${tag.model_count} model(s). Are you sure you want to delete it?`,
            ['Yes', 'No']
          );
          if (response !== 'Yes') return;
        }

        try {
          await window.electron.deleteTag(tag.id);
          allTags = [];
          await refreshTagManagerList(searchTerm);
          await populateTagSelect?.();
          await populateTagFilter?.();
        } catch (error) {
          console.error('Error deleting tag:', error);
          await window.electron.showMessage('Error', 'Failed to delete tag');
        }
      });

      tagList.appendChild(el);
    });
  } catch (error) {
    console.error('Error loading tags:', error);
  }
}
