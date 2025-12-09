from playwright.sync_api import sync_playwright, expect
import os

# Create verification directory
os.makedirs("/home/jules/verification", exist_ok=True)

def run_test():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Load the index.html file directly
        # We need to use a file:// URL.
        # Assuming the repo root is the current working directory.
        cwd = os.getcwd()
        page.goto(f"file://{cwd}/index.html")

        # Inject mock window.electron and other dependencies
        # This is critical because renderer.js expects these to be present.
        page.add_init_script("""
            window.electron = {
                getSetting: async (key) => {
                    if (key === 'modelBackgroundColor') return '#070147';
                    if (key === 'currentVersion') return '1.0.0';
                    if (key === 'betaOptIn') return 'false';
                    if (key === 'CollectUsage') return '0';
                    return null;
                },
                getAllModels: async () => {
                    return [
                        {
                            id: 1,
                            filePath: 'C:\\\\Users\\\\User\\\\3D Objects\\\\Project1\\\\model1.stl',
                            fileName: 'model1.stl',
                            designer: 'Designer One',
                            size: 1024 * 1024 * 2.5, // 2.5 MB
                            printed: false,
                            thumbnail: null,
                            tags: []
                        },
                        {
                            id: 2,
                            filePath: 'C:\\\\Users\\\\User\\\\3D Objects\\\\Project2\\\\subdir\\\\cool_thing.3mf',
                            fileName: 'cool_thing.3mf',
                            designer: 'MakerPro',
                            size: 1024 * 500, // 500 KB
                            printed: true,
                            thumbnail: null,
                            tags: []
                        }
                    ];
                },
                getDesigners: async () => [],
                getLicenses: async () => [],
                getParentModels: async () => [],
                getAllTags: async () => [],
                checkCollectUsage: async () => '0',
                onOpenAbout: () => {},
                onOpenSettings: () => {},
                onOpenPerformanceSettings: () => {},
                onOpenThemeSettings: () => {},
                onOpenBackupRestore: () => {},
                onOpenDeDup: () => {},
                onOpenTagManager: () => {},
                onOpenPurgeModels: () => {},
                onGenerateMissingThumbnails: () => {},
                onRefreshGrid: () => {},
                onStartPrintRoulette: () => {},
                onScanProgress: () => {},
                onDbProgress: () => {},
                onDbCleanup: () => {},
                onOpenSlicerSettings: () => {},
                showMessage: async () => 'No',
                checkForUpdates: async () => null,
                loadDirectory: async () => 'C:\\\\Users\\\\User\\\\3D Objects',
                getModelsWithoutThumbnails: async () => [],
                saveThumbnail: async () => {},
                getModelsWithDefaultThumbnails: async () => [],
                on: () => {}, // generic event listener
                getModelTags: async () => [],
                getModelsByDirectory: async () => []
            };

            // Mock path module which is used in renderer.js
            window.path = {
                basename: (p) => p.split(/[\\\\/]/).pop(),
                join: (...args) => args.join('/')
            };

            // Mock fs if needed, though mostly handled via IPC
            window.fs = { promises: {} };

            // Mock window.performCombinedSearch (from search.js) since we might not load it properly without modules
            window.performCombinedSearch = async () => {
                const models = await window.electron.getAllModels();
                window.renderFiles(models);
            };

            // Mock getCombinedFilteredModels
            window.getCombinedFilteredModels = async () => {
                 return await window.electron.getAllModels();
            };

        """)

        # Wait for the grid to render
        # We might need to manually trigger renderFiles if DOMContentLoaded fired before our script
        # But Playwright init script runs before page load, so listener should be there.
        # However, renderer.js is loaded via <script src="renderer.js">.
        # We need to make sure renderer.js runs AFTER our mock is injected.
        # Since we use page.add_init_script, it runs before any script in the page.

        # Reload to ensure mocks are present when scripts run
        page.reload()

        # Wait for file items to appear
        try:
            page.wait_for_selector(".file-item", timeout=5000)
        except:
             # If it fails, maybe manually trigger rendering
             page.evaluate("window.electron.getAllModels().then(models => window.renderFiles(models))")
             page.wait_for_selector(".file-item", timeout=5000)

        # Take screenshot
        page.screenshot(path="/home/jules/verification/verification.png")

        # Verify content
        # Check for directory label
        expect(page.locator(".parent-directory")).to_contain_text("Directory:")

        # Check for directory link text (Project1)
        expect(page.locator(".directory-link").first).to_contain_text("Project1")

        # Check for file size
        expect(page.locator(".file-details").first).to_contain_text("2.5 MB")

        browser.close()

if __name__ == "__main__":
    run_test()
