// filters/dropdownPopulators.js

async function populateDesignerDropdown() {
  const designerSelect = document.getElementById('designer-select');
  designerSelect.innerHTML = '<option value="">All Designers</option>';
  // Add an option to filter for models with no designer set
  designerSelect.innerHTML += '<option value="__none__">None</option>';
  try {
    const designers = await window.electron.getDesigners();
    designers.forEach(designer => {
      const option = document.createElement('option');
      option.value = designer;
      option.textContent = designer;
      designerSelect.appendChild(option);
    });
  } catch (error) {
    console.error('Error fetching designers:', error);
  }
}

// Add license filter population with null checks
async function populateLicenseFilter() {
  const licenseSelect = document.getElementById('license-select');
  licenseSelect.innerHTML = '<option value="">All Licenses</option>';
  // Add an option to filter for models with no license set
  licenseSelect.innerHTML += '<option value="__none__">None</option>';
  try {
    const rows = await window.electron.getLicenses();
    rows.forEach(license => {
      const option = document.createElement('option');
      option.value = license;
      option.textContent = license;
      licenseSelect.appendChild(option);
    });
  } catch (error) {
    console.error('Error fetching licenses:', error);
  }
}

// Add back the populateParentModelFilter function
async function populateParentModelFilter() {
  const parentSelect = document.getElementById('parent-select');
  parentSelect.innerHTML = '<option value="">All Parent Models</option>';
  // Add an option to filter for models with no parent model set
  parentSelect.innerHTML += '<option value="__none__">None</option>';
  try {
    const parents = await window.electron.getParentModels();
    parents.forEach(parent => {
      if (parent) { // Only add non-empty parent models
        const option = document.createElement('option');
        option.value = parent;
        option.textContent = parent;
        parentSelect.appendChild(option);
      }
    });
  } catch (error) {
    console.error('Error fetching parent models for filter:', error);
  }
}

async function populateTagFilter(selected = null) {
  const dropdown = document.getElementById('tag-filter');
  if (!dropdown) return;

  try {
    const tags = await window.electron.getAllTags();
    dropdown.innerHTML = `<option value="">All Tags</option>`;
    tags.forEach(tag => {
      const option = document.createElement('option');
      option.value = tag.name;
      option.textContent = tag.name;
      if (selected && selected === tag.name) option.selected = true;
      dropdown.appendChild(option);
    });
  } catch (error) {
    console.error('Failed to populate tag filter:', error);
  }
}
