async function generateThumbnailsForModels(models) {
  const BATCH_SIZE = 1; // Process one at a time
  const progressDialog = document.getElementById('thumbnail-progress-dialog');
  const progressBar = document.getElementById('thumbnail-progress-bar');
  const progressText = document.getElementById('thumbnail-progress-text');

  // Check if progress elements exist before proceeding
  const hasProgressUI = progressDialog && progressBar && progressText;

  totalThumbnailsToGenerate = models.length;
  generatedThumbnailsCount = 0;

  try {
    // Show progress dialog if it exists
    if (hasProgressUI) {
      progressDialog.showModal();
    }

    for (let i = 0; i < models.length; i++) {
      const model = models[i];

      try {
        // Update progress before starting each model
        generatedThumbnailsCount = i;

        // Only update UI elements if they exist
        if (hasProgressUI) {
          const progress = Math.floor((i / totalThumbnailsToGenerate) * 100);
          progressBar.style.width = `${progress}%`;
          progressText.textContent = `Processing ${i + 1}/${totalThumbnailsToGenerate} (${progress}%)`;
        }

        // Check for embedded thumbnail first (for 3MF files)
        if (model.filePath.toLowerCase().endsWith('.3mf')) {
          try {
            const embeddedImage = await extract3MFThumbnail(model.filePath);

            // Validate that embeddedImage is a proper string containing image data
            if (embeddedImage && typeof embeddedImage === 'string' && embeddedImage.startsWith('data:image')) {
              await window.electron.saveThumbnail(model.filePath, embeddedImage);
              continue; // Skip 3D rendering if we have an embedded image
            } else if (embeddedImage && Array.isArray(embeddedImage) && embeddedImage.length > 0) {
              // Handle case where it returns an array of images
              const firstImage = embeddedImage[0];
              if (typeof firstImage === 'string' && firstImage.startsWith('data:image')) {
                await window.electron.saveThumbnail(model.filePath, firstImage);
                continue;
              }
            }

            // If we get here, the embedded image wasn't valid
            debugLog(`No valid embedded image found in 3MF file: ${model.filePath}`);
          } catch (embeddedError) {
            console.error(`Error extracting embedded image from 3MF: ${model.filePath}`, embeddedError);
            // Continue to regular thumbnail generation
          }
        }

        // Generate thumbnail
        try {
          const thumbnail = await generateThumbnail(model.filePath);

          // Validate thumbnail before saving
          if (thumbnail && typeof thumbnail === 'string' &&
            (thumbnail.startsWith('data:image') || thumbnail === '3d.png')) {
            await window.electron.saveThumbnail(model.filePath, thumbnail);
          } else {
            console.error(`Invalid thumbnail generated for ${model.filePath}:`, thumbnail);
            // Save default thumbnail
            await window.electron.saveThumbnail(model.filePath, '3d.png');
          }
        } catch (thumbnailError) {
          console.error(`Error generating thumbnail for ${model.filePath}:`, thumbnailError);
          // Save default thumbnail
          await window.electron.saveThumbnail(model.filePath, '3d.png');
        }

        // Force cleanup after each model
        if (typeof deepCleanThreeResources === 'function') {
          deepCleanThreeResources();
        }

        // Add delay between models
        await new Promise(resolve => setTimeout(resolve, 50)); // Use a reasonable default if THUMBNAIL_GENERATION_DELAY is not defined

      } catch (error) {
        console.error(`Failed to generate thumbnail for ${model.filePath}:`, error);
        // Try to save a default thumbnail to prevent future attempts
        try {
          await window.electron.saveThumbnail(model.filePath, '3d.png');
        } catch (saveError) {
          console.error(`Failed to save default thumbnail for ${model.filePath}:`, saveError);
        }
        // Continue with next model even if one fails
      }
    }

    // Update final progress
    if (hasProgressUI) {
      progressBar.style.width = '100%';
      progressText.textContent = `Completed ${totalThumbnailsToGenerate}/${totalThumbnailsToGenerate} (100%)`;
    }

  } catch (error) {
    console.error('Error in thumbnail generation:', error);
  } finally {
    // Close the dialog if it exists and was opened
    if (hasProgressUI && progressDialog.open) {
      progressDialog.close();
    }
  }
}
