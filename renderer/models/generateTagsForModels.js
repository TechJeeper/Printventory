async function generateTagsForModels(models) {
  const progressContainer = document.getElementById('tag-generation-progress-container');
  const progressBar = document.getElementById('tag-generation-progress-bar');
  const progressText = document.getElementById('tag-generation-progress-text');

  progressContainer.classList.remove('hidden');
  progressText.textContent = 'Generating Tags';

  try {
    for (let i = 0; i < models.length; i++) {
      const model = models[i];
      try {
        // Assume generateTagsForImage is a function that generates tags for a model
        await generateTagsForImage(model.imageData, model.model);
      } catch (error) {
        console.error(`Error generating tags for model ${model.id}:`, error);
        // Optionally, you can update the UI to indicate an error for this specific model
      }

      // Update progress bar
      const progress = ((i + 1) / models.length) * 100;
      progressBar.style.width = `${progress}%`;
    }
  } finally {
    // Hide the progress bar after completion
    progressContainer.classList.add('hidden');
  }
}
