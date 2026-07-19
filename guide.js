/* guide.js
 *
 * This module handles the quick‐start guide pages.
 * The guide is automatically shown after the welcome dialog is dismissed
 * and when the Help > Guide menu item is clicked.
 *
 * It uses the dialog element (<dialog id="quickstart-guide">) defined in index.html.
 *
 * The guide consists of five pages:
 *   • Page 1: Scanning for models (image: guide/guide-scan.png)
 *   • Page 2: Editing model details (image: guide/guide-edit.png)
 *   • Page 3: Filtering and searching (image: guide/guide-filter.png)
 *   • Page 4: Settings (no image)
 *   • Page 5: Advanced tools and a thank you message (no image)
 */

const guidePages = [
  {
    title: "Scanning for Models",
    content: `🚀 Ready to dive into your 3D model collection? Click the <strong>Scan Directory</strong> button to effortlessly scan for your 3D models! 🌟 
    You can also set up a <strong>STL Home</strong> in <strong>Settings</strong> to automatically scan a folder every time you launch Printventory. 
    <p><strong style="color: Green;">Pro Tip:</strong><br> 
    <span style="color: Green;">Scan multiple directories to build your ultimate library of 3D models!</span>`,
    image: "guide/guide-scan.png"
  },
  {
    title: "Editing Model Details",
    content: `✨ Click on any model to unlock its details! Here, you can edit essential information like the:<br>
    <ul>
      <li><strong>Designer</strong></li>
      <li><strong>Parent Model</strong></li>
      <li><strong>License</strong></li>
      <li><strong>Tags</strong></li>
    </ul>
    Use the add (+) button to enrich your dropdowns with new entries. 
    <p><strong style="color: Green;">Pro Tip:</strong><br> 
    <span style="color: Green;">Activate <strong>Multi-Edit Mode</strong> to modify multiple models at once and streamline your workflow!</span></p>`,
    image: "guide/guide-edit.png"
  },
  {
    title: "Filtering and Searching",
    content: `🔍 Searching for that perfect model? Use the filtering options at the top to quickly find models by:<br>
    <ul>
      <li><strong>Designer</strong></li>
      <li><strong>Parent Model</strong></li>
      <li><strong>License</strong></li>
      <li><strong>File Type</strong></li>
      <li><strong>Tags</strong></li>
    </ul>
    You can also type in the search box for instant results! Plus, right-click on any model to access powerful options like move, delete, open, or slice it. 
    Your 3D printing journey just got easier!`,
    image: "guide/guide-filter.png"
  },
  {
    title: "Settings",
    content: `⚙️ Customize your Printventory experience! From the <strong>Settings</strong> menu, you can:<br>
    <ul>
      <li>Change the <strong>Theme</strong> to match your style! 🎨</li>
      <li>Adjust <strong>Performance</strong> settings to optimize your workflow! 🚀</li>
      <li>Set your <strong>STL Home</strong> directory for automatic scans on startup! 🏠</li>
      <li>Specify the <strong>Slicer Path</strong> to open models directly in your favorite slicer! 🖨️</li>
    </ul>`,
    image: ""
  },
  {
    title: "Advanced Tools",
    content: `🌟 Explore powerful features under the <strong>Tools</strong> menu!<br>
    <ul>
      <li><strong>Tag Manager</strong> – Organize your models with tags for easy access! 🏷️</li>
      <li><strong>Print Roulette</strong> – Feeling indecisive? Let Printventory randomly select your next model to print! 🎲</li>
      <li><strong>Backup/Restore</strong> – Safeguard your data with easy backup and restore options! 💾</li>
      <li><strong>De-Dup</strong> – Say goodbye to clutter! Easily clean up duplicate files in your library, ensuring your collection stays organized and efficient! 🧹</li>
      <li><strong>AI Tagging</strong> – Configure your AI services in <strong>Settings > AI Config</strong> to enable powerful AI-assisted tagging! Right-click on one or multiple models to "Generate Tags using AI" and automatically categorize your models. 🤖</li>
      <li><strong>Slicer Integration</strong> – Configure slicers in <strong>Settings</strong> for right-click <strong>Open in Slicer</strong> and the preview dialog <strong>Send to Slicer</strong> button. Sending again while a slicer is open starts a new instance with your model loaded. 🖨️</li>
      <li><strong>Folder &amp; ZIP bundles</strong> – Multi-part folders and ZIP archives group into one row. Click to expand; right-click <strong>Preview</strong> for an all-parts 3D view; double-click for bundle details. 📦</li>
    </ul>
    Thank you for choosing Printventory! Visit <strong>Help > Support Printventory</strong> to learn how you can support this amazing project!`,
    image: ""
  }
];

// Update the guide dialog with the current page's content and image.
function updateGuide() {
  const guideText = document.getElementById("guide-text");
  const guideImage = document.getElementById("guide-image");
  const backButton = document.getElementById("guide-back-button");
  const nextButton = document.getElementById("guide-next-button");
  const progressFill = document.getElementById("guide-progress-fill");
  const progressText = document.getElementById("guide-progress-text");

  const page = guidePages[currentPage];

  // Update progress indicator
  const progress = ((currentPage + 1) / guidePages.length) * 100;
  if (progressFill) {
    progressFill.style.width = `${progress}%`;
  }
  if (progressText) {
    progressText.textContent = `Page ${currentPage + 1} of ${guidePages.length}`;
  }

  // Fade out the current content
  guideText.style.opacity = 0;
  guideImage.style.opacity = 0;

  // Set a timeout to allow the fade-out to complete before changing content
  setTimeout(() => {
    // Clear existing contents before adding new content
    guideText.innerHTML = '';

    // For pages 2 and 3 (indexes 1 and 2) show a two-column layout (image on left, text on right)
    if (currentPage === 1 || currentPage === 2) {
      // Create a two-column container
      const twoColumnContainer = document.createElement("div");
      twoColumnContainer.className = "guide-two-column";

      // Create the image element
      const imgElement = document.createElement("img");
      imgElement.src = page.image;
      imgElement.alt = page.title;

      // Create a text container for the title and content
      const textContainer = document.createElement("div");
      textContainer.className = "guide-text-content";
      textContainer.innerHTML = `<h3>${page.title}</h3><p>${page.content}</p>`;

      // Append to two-column container
      twoColumnContainer.appendChild(imgElement);
      twoColumnContainer.appendChild(textContainer);
      guideText.appendChild(twoColumnContainer);

      // Hide the standalone guideImage element (not used in this layout)
      guideImage.style.display = "none";
    } else {
      // Default layout: show title and content in guideText, and if an image exists, display it.
      guideText.innerHTML = `<h3>${page.title}</h3><p>${page.content}</p>`;
      if (page.image) {
        guideImage.src = page.image;
        guideImage.alt = page.title;
        guideImage.style.display = "block";
      } else {
        guideImage.style.display = "none";
      }
    }

    // Fade in the new content
    guideText.style.opacity = 1;
    guideImage.style.opacity = 1;

    // Disable the Back button on the first page.
    backButton.disabled = currentPage === 0;

    // Update Next button text and icon
    const nextButtonSpans = nextButton.querySelectorAll('span');
    if (currentPage === guidePages.length - 1) {
      // Last page: show "Finish" without arrow
      nextButton.innerHTML = '<span>Finish</span>';
    } else {
      // Other pages: show "Next" with arrow
      nextButton.innerHTML = '<span>Next</span><span class="guide-nav-icon">→</span>';
    }
  }, 400); // Smooth transition timing
}

// Increment the current page or close the guide if on the last page.
function nextGuide() {
  if (currentPage < guidePages.length - 1) {
    currentPage++;
    updateGuide();
  } else {
    closeGuide();
  }
}

// Decrement the current page if possible.
function prevGuide() {
  if (currentPage > 0) {
    currentPage--;
    updateGuide();
  }
}

// Opens the guide dialog starting at the first page.
function showGuide() {
  currentPage = 0;
  updateGuide();
  const guideDialog = document.getElementById("quickstart-guide");
  if (guideDialog) {
    guideDialog.showModal();
    // Add styles to ensure dialog has no black background
    guideDialog.style.backgroundColor = 'transparent';
    guideDialog.style.background = 'none';
    // Focus the dialog for keyboard navigation
    guideDialog.focus();
  } else {
    console.error('Guide dialog not found');
  }
}

// Closes the guide dialog.
function closeGuide() {
  const guideDialog = document.getElementById("quickstart-guide");
  if (guideDialog) {
    guideDialog.close();
  }
}

// Set up event listeners when the DOM content is fully loaded.
document.addEventListener("DOMContentLoaded", () => {
  const nextButton = document.getElementById("guide-next-button");
  const backButton = document.getElementById("guide-back-button");
  const closeButton = document.getElementById("guide-close-button");
  const guideDialog = document.getElementById("quickstart-guide");

  if (nextButton) {
    nextButton.addEventListener("click", nextGuide);
  }
  if (backButton) {
    backButton.addEventListener("click", prevGuide);
  }
  if (closeButton) {
    closeButton.addEventListener("click", closeGuide);
  }

  // Keyboard navigation support
  if (guideDialog) {
    guideDialog.addEventListener("keydown", (e) => {
      // Only handle keyboard events when the dialog is open
      if (!guideDialog.open) return;

      // Prevent default behavior for arrow keys
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
      }

      // Navigate with arrow keys
      if (e.key === "ArrowLeft" && currentPage > 0) {
        prevGuide();
      } else if (e.key === "ArrowRight" && currentPage < guidePages.length - 1) {
        nextGuide();
      } else if (e.key === "Escape") {
        closeGuide();
      }
    });

    // Focus management: focus the dialog when it opens
    guideDialog.addEventListener("close", () => {
      // Reset to first page when closing
      currentPage = 0;
    });
  }
  
  // After the welcome dialog is dismissed, automatically show the guide.
  const dismissWelcomeButton = document.getElementById("dismiss-welcome");
  if (dismissWelcomeButton) {
    dismissWelcomeButton.addEventListener("click", async () => {
      try {
        const hasSeenQuickStartGuide = await window.electron.getSetting("hasSeenQuickStartGuide");
        if (hasSeenQuickStartGuide) {
          return;
        }
        await window.electron.saveSetting("hasSeenQuickStartGuide", "true");
      } catch (error) {
        console.warn("Unable to read/save hasSeenQuickStartGuide setting:", error);
      }

      // Give a small delay so the welcome dialog can close.
      setTimeout(() => {
        showGuide();
      }, 500);
    });
  }
});

// Export the showGuide function so it can be called from other files
window.showGuide = showGuide; 