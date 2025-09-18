window.electron.onScanProgress((progress) => {
  const percent = progress.total ? (progress.processed / progress.total) * 100 : 0;
  progressBar.style.width = ;
  progressText.textContent = ;
});