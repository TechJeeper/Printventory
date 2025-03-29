// filters/filterHandlers.js

function handleFilterChange() {
  // Collect all filter values
  const designer = document.getElementById('designer-select')?.value || '';
  const license = document.getElementById('license-select')?.value || '';
  const parentModel = document.getElementById('parent-select')?.value || '';
  const printed = document.getElementById('printed-select')?.value || '';
  const tag = document.getElementById('tag-filter')?.value || '';
  const sort = document.getElementById('sort-select')?.value || '';

  // For now, log it for confirmation
  console.log('Filters changed:', { designer, license, parentModel, printed, tag, sort });

  // Reapply the filters
  refreshModelDisplay();
}

function setupFilterListeners() {
  const filterIds = [
    'designer-select',
    'license-select',
    'parent-select',
    'printed-select',
    'tag-filter',
    'sort-select',
    'filetype-select'
  ];

  filterIds.forEach(id => {
    const element = document.getElementById(id);
    if (element) {
      element.addEventListener('change', handleFilterChange);
    }
  });
}
