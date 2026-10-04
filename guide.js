/* guide.js
 *
 * Quick-start guide shown after the welcome dialog and from Help > Quick Start Guide.
 * Dialog markup: <dialog id="quickstart-guide"> in index.html.
 *
 * Four steps, in the order a new library is actually used:
 *   1. Scan your library
 *   2. Find a model
 *   3. Add what you know
 *   4. When you need more (short menu map, not a feature list)
 *
 * Blocks wrapped in <!--desktop--> are removed in server mode (no local slicer).
 */

const guidePages = [
  {
    title: "Scan your library",
    layout: "image-top",
    content: `<p>Click <strong>Scan Directory</strong> and choose a folder of models. Printventory catalogs STL and 3MF files, plus any other types you turn on under <strong>Settings → File Type</strong>.</p>
    <p>Add the same folders in <strong>Settings → STL Home</strong> to scan them each time the app opens. You can list more than one.</p>
    <p>A folder or ZIP with several models shows up as one row. Click the row to see the parts inside.</p>
    <p class="guide-tip"><strong>Tip:</strong> Scan every folder you print from. You can add another later.</p>`,
    image: "guide/guide-scan.png"
  },
  {
    title: "Find a model",
    layout: "split",
    content: `<p>Switch the grid with <strong>Detailed</strong>, <strong>Preview</strong>, and <strong>List</strong>. <strong>Folders</strong> opens the tree of libraries you have scanned.</p>
    <p>The filters narrow that grid by designer, parent model, license, file type, tags, and print status. Search matches names as you type.</p>
    <p>Right-click a model to open it, move it, delete it, or preview it in 3D.</p>`,
    image: "guide/guide-filter.png"
  },
  {
    title: "Add what you know",
    layout: "split",
    content: `<p>Click a model to set designer, parent model, license, tags, filament, and notes. Use <strong>+</strong> when a name is not in the list yet.</p>
    <p>Set <strong>Print status</strong>, or <strong>Log a print</strong> to record when it ran and how it turned out. A successful log marks the model printed.</p>
    <p class="guide-tip"><strong>Tip:</strong> <strong>Multi-Edit Mode</strong> applies one change to every model you select.</p>`,
    image: "guide/guide-edit.png"
  },
  {
    title: "When you need more",
    layout: "text",
    content: `<p>Scanning, finding, and filling in details is the daily loop. Open these when the job comes up.</p>
    <div class="guide-later">
      <!--desktop-->
      <div class="guide-later-card">
        <h4>Send to a slicer</h4>
        <p><strong>Settings → Slicer</strong>, then right-click <strong>Open in Slicer</strong> or use <strong>Send to Slicer</strong> from the 3D preview.</p>
      </div>
      <!--/desktop-->
      <div class="guide-later-card">
        <h4>Run the workshop</h4>
        <p><strong>Filament Manager</strong>, <strong>Printer Manager</strong>, and <strong>Parts Manager</strong> live under <strong>Tools</strong>. Printer Manager is also the printer icon under the logo. It can find printers on your network, and logging a print draws down the filament and parts you pick.</p>
      </div>
      <div class="guide-later-card">
        <h4>Tidy the library</h4>
        <p><strong>De-Dup</strong> checks the whole library or just the current view. <strong>Organize Library</strong> copies models into folders you choose. <strong>Backup/Restore</strong> can run on a schedule.</p>
      </div>
      <div class="guide-later-card">
        <h4>Tags that write themselves</h4>
        <p>New scans can tag a model from its folder names. <strong>Settings → AI Config</strong> turns on suggestions, and right-click <strong>Tag from Folder</strong> copies those names with no AI. <strong>Tag Manager</strong> renames a tag everywhere.</p>
      </div>
    </div>
    <p class="guide-closer"><strong>Help → Keyboard Shortcuts</strong> and <strong>Help → FAQ</strong> cover the rest.</p>`,
    image: ""
  }
];

let guidePageIndex = 0;

function guideMarkup(page) {
  return `<h3>${page.title}</h3>${page.content}`;
}

// Paint the current page immediately. A delayed fade left the dialog blank if the timer never ran.
function updateGuide() {
  const guideText = document.getElementById("guide-text");
  const guideImage = document.getElementById("guide-image");
  const backButton = document.getElementById("guide-back-button");
  const nextButton = document.getElementById("guide-next-button");
  const progressFill = document.getElementById("guide-progress-fill");
  const progressText = document.getElementById("guide-progress-text");
  const page = guidePages[guidePageIndex];
  if (!page || !guideText) return;

  const progress = ((guidePageIndex + 1) / guidePages.length) * 100;
  if (progressFill) progressFill.style.width = `${progress}%`;
  if (progressText) progressText.textContent = `Step ${guidePageIndex + 1} of ${guidePages.length}`;

  guideText.innerHTML = "";
  guideText.style.opacity = "1";

  if (page.layout === "split" && page.image) {
    const twoColumnContainer = document.createElement("div");
    twoColumnContainer.className = "guide-two-column";

    const imgElement = document.createElement("img");
    imgElement.src = page.image;
    imgElement.alt = page.title;

    const textContainer = document.createElement("div");
    textContainer.className = "guide-text-content";
    textContainer.innerHTML = guideMarkup(page);

    twoColumnContainer.appendChild(imgElement);
    twoColumnContainer.appendChild(textContainer);
    guideText.appendChild(twoColumnContainer);
    if (guideImage) guideImage.style.display = "none";
  } else {
    guideText.innerHTML = guideMarkup(page);
    if (guideImage) {
      guideImage.style.opacity = "1";
      if (page.image) {
        guideImage.src = page.image;
        guideImage.alt = page.title;
        guideImage.style.display = "block";
      } else {
        guideImage.style.display = "none";
      }
    }
  }

  if (backButton) backButton.disabled = guidePageIndex === 0;
  if (nextButton) {
    nextButton.innerHTML = guidePageIndex === guidePages.length - 1
      ? "<span>Finish</span>"
      : '<span>Next</span><span class="guide-nav-icon">→</span>';
  }
}

function openGuideDialog(guideDialog) {
  const openModals = [...document.querySelectorAll("dialog[open]")].filter((dialog) => dialog !== guideDialog);
  const host = openModals.length ? openModals[openModals.length - 1] : document.body;
  if (guideDialog.parentElement !== host) host.appendChild(guideDialog);

  guideDialog.style.background = "";
  guideDialog.style.backgroundColor = "";

  if (guideDialog.open) {
    guideDialog.focus();
    return;
  }
  try {
    guideDialog.showModal();
  } catch (err) {
    console.error("Quick Start Guide could not open as a modal:", err);
    try {
      guideDialog.show();
    } catch (fallbackErr) {
      console.error("Quick Start Guide could not open:", fallbackErr);
    }
  }
  guideDialog.focus();
}

function nextGuide() {
  if (guidePageIndex < guidePages.length - 1) {
    guidePageIndex++;
    updateGuide();
  } else {
    closeGuide();
  }
}

function prevGuide() {
  if (guidePageIndex > 0) {
    guidePageIndex--;
    updateGuide();
  }
}

let serverGuideAdjusted = false;

async function omitSlicerGuideForServerMode() {
  if (serverGuideAdjusted) return false;
  let serverMode = false;
  try {
    serverMode = await window.electron?.isServerMode?.();
  } catch {
    serverMode = false;
  }
  serverGuideAdjusted = true;
  if (!serverMode) return false;
  let changed = false;
  for (const page of guidePages) {
    const next = page.content.replace(/<!--desktop-->[\s\S]*?<!--\/desktop-->/g, "");
    if (next !== page.content) {
      page.content = next;
      changed = true;
    }
  }
  return changed;
}

async function showGuide() {
  const guideDialog = document.getElementById("quickstart-guide");
  if (!guideDialog) {
    console.error("Guide dialog not found");
    return;
  }
  guidePageIndex = 0;
  updateGuide();
  openGuideDialog(guideDialog);
  try {
    const changed = await omitSlicerGuideForServerMode();
    if (changed && guideDialog.open) updateGuide();
  } catch (err) {
    console.warn("Quick Start Guide could not adjust for server mode:", err);
  }
}

function closeGuide() {
  const guideDialog = document.getElementById("quickstart-guide");
  if (guideDialog) {
    guideDialog.close();
  }
}

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

  if (guideDialog) {
    guideDialog.addEventListener("keydown", (e) => {
      if (!guideDialog.open) return;

      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
      }

      if (e.key === "ArrowLeft" && guidePageIndex > 0) {
        prevGuide();
      } else if (e.key === "ArrowRight" && guidePageIndex < guidePages.length - 1) {
        nextGuide();
      } else if (e.key === "Escape") {
        closeGuide();
      }
    });

    guideDialog.addEventListener("close", () => {
      guidePageIndex = 0;
    });
  }

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

      setTimeout(() => {
        showGuide();
      }, 500);
    });
  }
});

window.showGuide = showGuide;
