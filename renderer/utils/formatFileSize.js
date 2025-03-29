function formatFileSize(bytes) {
  if (bytes >= 1_000_000) return (bytes / 1_000_000).toFixed(2) + ' MB';
  if (bytes >= 1_000) return (bytes / 1_000).toFixed(1) + ' KB';
  return bytes + ' bytes';
}