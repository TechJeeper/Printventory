    if (filesNeedingThumbnails.length > 0) {
      let completedThumbnails = 0;
      const thumbnailProgressUpdate = (completed) => {
        if (!background) {
          const progress = (completed / filesNeedingThumbnails.length) * 100;
          renderProgressBar.style.width = `${progress}%`;
          renderProgressText.textContent = `${completed} / ${filesNeedingThumbnails.length} models`;
        }
      };

      // Improved thumbnail generation with concurrency control and cancellation
      const maxConcurrentThumbnails = 5; // Increased from 1 for better performance
      const thumbnailQueue = [...filesNeedingThumbnails];
      const activePromises = new Set();
      
      while (thumbnailQueue.length > 0 && !isCancelled) {
        // Fill up to max concurrent thumbnails
        while (activePromises.size < maxConcurrentThumbnails && thumbnailQueue.length > 0) {
          const file = thumbnailQueue.shift();
          
          const promise = (async () => {
            try {
              if (existingThumbnails.has(file.filePath)) {
                console.log(`Thumbnail found for ${file.filePath} in database. Skipping render.`);
                return;
              }
              
              // Render the thumbnail; using the dummy container if in background
              const fileElement = await renderFile(file, container);
              if (!background && fileElement) {
                container.appendChild(fileElement);
              }
            } catch (error) {
              console.error('Error caching thumbnail:', error);
            } finally {
              if (!existingThumbnails.has(file.filePath)) {
                completedThumbnails++;
                thumbnailProgressUpdate(completedThumbnails);
              }
              activePromises.delete(promise);
            }
          })();
          
          activePromises.add(promise);
        }
        
        // Wait for at least one promise to complete before continuing
        if (activePromises.size > 0) {
