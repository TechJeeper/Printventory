import { describe, expect, it } from "vitest";
import { TestDriver } from "testdriverai/vitest/hooks";

// Printventory is a free/open-source desktop app (Electron) with no login.
// Its production, publicly-reachable surface is the marketing site at
// https://printventory.com/. There are no user accounts or credentials, so
// these tests exercise the production website rather than an authenticated app.
describe("Printventory production site — homepage", () => {
  it("loads the homepage with the hero and primary navigation", async (context) => {
    const testdriver = TestDriver(context);

    await testdriver.provision.chrome({ url: "https://printventory.com/" });

    // Give the intro/hero a moment to settle.
    await testdriver.wait(2000);

    const homeLoaded = await testdriver.assert(
      "The Printventory homepage is loaded, showing the PRINTVENTORY logo/hero and a top navigation bar containing Home, Download, Beta, FAQ, and Support links",
    );
    expect(homeLoaded).toBeTruthy();
  });
});
