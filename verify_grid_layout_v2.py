from playwright.sync_api import sync_playwright, expect
import os

# Create verification directory
os.makedirs("/home/jules/verification", exist_ok=True)

def run_test():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        # Set viewport to be large enough to see the grid
        page = browser.new_page(viewport={"width": 1280, "height": 800})

        cwd = os.getcwd()
        page.goto(f"file://{cwd}/index.html")

        # Inject mock window.electron and other dependencies
        page.add_init_script("""
            window.electron = {
                getSetting: async (key) => {
                    if (key === 'tosAcceptedDate') return '2023-01-01T00:00:00.000Z'; // Bypass TOS
                    if (key === 'hasRunBefore') return 'true'; // Bypass Welcome
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
                on: () => {},
                getModelTags: async () => [],
                getModelsByDirectory: async () => []
            };

            window.path = {
                basename: (p) => p.split(/[\\\\/]/).pop(),
                join: (...args) => args.join('/')
            };

            window.fs = { promises: {} };

            window.performCombinedSearch = async () => {
                const models = await window.electron.getAllModels();
                window.renderFiles(models);
            };
             window.getCombinedFilteredModels = async () => {
                 return await window.electron.getAllModels();
            };
        """)

        page.reload()

        # Wait for file items to appear
        try:
            page.wait_for_selector(".file-item", timeout=5000)
        except:
             # Manually trigger if auto-load fails
             page.evaluate("window.electron.getAllModels().then(models => window.renderFiles(models))")
             page.wait_for_selector(".file-item", timeout=5000)

        # Assertions
        # Check that we have 2 items
        expect(page.locator(".file-item")).to_have_count(2)

        # Target the first item to verify details
        first_item = page.locator(".file-item").first

        # Check Directory
        expect(first_item.locator(".parent-directory")).to_contain_text("Directory:")
        expect(first_item.locator(".directory-link")).to_contain_text("Project1")

        # Check Size
        expect(first_item.locator(".file-details")).to_contain_text("Size:")
        expect(first_item.locator(".file-details")).to_contain_text("2.5 MB")

        # Check Designer
        expect(first_item.locator(".designer-info")).to_contain_text("Designer: Designer One")

        # Take screenshot of just the grid area if possible, or full page
        page.screenshot(path="/home/jules/verification/verification_fixed.png")
        print("Verification successful!")

        browser.close()

if __name__ == "__main__":
    run_test()
