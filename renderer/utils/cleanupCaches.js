
function cleanupCaches() {
  // Limit the thumbnail cache size to, for example, 1000 items.
  if (thumbnailCache.size > 1000) {
    const keys = Array.from(thumbnailCache.keys()).slice(0, 500);
    keys.forEach(key => thumbnailCache.delete(key));
  }

  // If you have a modelCache that is only used for temporary lookups,
  // clear it after a certain period or when a page change occurs.
  modelCache.clear(); // or selectively remove entries
}

// Run cleanupCaches() every minute.
setInterval(cleanupCaches, 60000);
