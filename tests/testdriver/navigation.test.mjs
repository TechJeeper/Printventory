import { describe, expect, it } from "vitest";
import { TestDriver } from "testdriverai/vitest/hooks";

// Navigation smoke tests for the production Printventory marketing site.
// No credentials are required — Printventory is a free/open-source app with no
// login, so these exercise the public site's top-nav routing.
describe("Printventory production site — navigation", () => {
  it("navigates from the homepage to the FAQ page", async (context) => {
    const testdriver = TestDriver(context);

    await testdriver.provision.chrome({ url: "https://printventory.com/" });
    await testdriver.wait(2000);

    await testdriver.find("FAQ link in the top navigation bar").click();
    await testdriver.wait(2500);

    const faqVisible = await testdriver.assert(
      'The FAQ page is displayed, showing a "Frequently Asked Questions" heading and FAQ content such as a table of contents or questions',
    );
    expect(faqVisible).toBeTruthy();
  });

  it("navigates from the homepage to the Download page", async (context) => {
    const testdriver = TestDriver(context);

    await testdriver.provision.chrome({ url: "https://printventory.com/" });
    await testdriver.wait(2000);

    await testdriver.find("Download link in the top navigation bar").click();
    await testdriver.wait(2500);

    const downloadVisible = await testdriver.assert(
      'The Download page is displayed with a "Download Printventory" heading and download buttons for Windows, macOS, and Linux',
    );
    expect(downloadVisible).toBeTruthy();
  });
});
