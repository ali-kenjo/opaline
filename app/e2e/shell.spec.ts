// Settings and Onboarding windows on a fake core (e2e/stub/fakeShell.ts), updated for
// Phase 5 (Looks, Widget defaults, Settings search deep-links, shortcut conflict detection,
// and 7-step Onboarding with "Pick a look").
import { expect, test } from "@playwright/test";
import { openShellPage, shellCalls, shellSettings, shellState } from "./stub/shellFixture";

const SECTIONS = [
  "Looks",
  "Appearance",
  "Layout",
  "Profiles & automation",
  "Plugins & Gallery",
  "Widget defaults",
  "Data sources",
  "Accounts & integrations",
  "Alerts",
  "Performance",
  "Privacy",
  "Desktop integration",
  "Shortcuts",
  "Backup",
  "Diagnostics",
  "About",
];

test("Settings: every section opens without errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await openShellPage(page, "/settings.html");
  const nav = page.getByRole("complementary", { name: "Settings sections" });
  await expect(nav.getByRole("button")).toHaveCount(SECTIONS.length);
  for (const name of SECTIONS) {
    const button = nav.getByRole("button", { name: new RegExp(`^${name}`) });
    await button.click();
    await expect(button).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("heading", { level: 1 })).toContainText(name);
  }
  expect(errors).toEqual([]);
});

test("Settings: search deep-links jump directly to the matching section", async ({ page }) => {
  await openShellPage(page, "/settings.html");
  await page.getByRole("searchbox", { name: "Search settings" }).fill("conflict");
  await page
    .getByRole("button", { name: /Shortcuts/ })
    .first()
    .click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Shortcuts");
});

test("Settings: Looks section switches the active theme and saves to core", async ({ page }) => {
  await openShellPage(page, "/settings.html");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Looks");
  await page.getByRole("button", { name: "Use look" }).first().click();
  await expect
    .poll(async () => (await shellCalls(page)).map((c) => c.cmd))
    .toContain("shell_update_settings");
});

test("Settings: a change is sent to core and reloaded", async ({ page }) => {
  await openShellPage(page, "/settings.html");
  const nav = page.getByRole("complementary", { name: "Settings sections" });
  await nav.getByRole("button", { name: /^Privacy/ }).click();
  const updates = page.getByRole("switch", { name: /update/i }).first();
  await expect(updates).toBeVisible();
  const before = (await shellSettings(page)).privacy as { updateChecks: boolean };
  await updates.click();
  await expect
    .poll(
      async () => ((await shellSettings(page)).privacy as { updateChecks: boolean }).updateChecks,
    )
    .toBe(!before.updateChecks);
  const cmds = (await shellCalls(page)).map((c) => c.cmd);
  expect(cmds).toContain("shell_update_settings");
  // After saving, Settings reads the state back from core.
  expect(cmds.filter((c) => c === "shell_get_state").length).toBeGreaterThan(1);
});

test("Settings: quick actions reach core", async ({ page }) => {
  await openShellPage(page, "/settings.html");
  await page.getByRole("button", { name: "Peek" }).click();
  await expect
    .poll(async () => (await shellCalls(page)).filter((c) => c.cmd === "shell_trigger_action"))
    .toEqual([{ cmd: "shell_trigger_action", args: { action: "peek" } }]);
});

test("Onboarding: walks all 7 steps including Pick a look and saves choices", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await openShellPage(page, "/onboarding.html", shellState({ onboardingDone: false }));
  await page.getByRole("button", { name: "Get started" }).click();
  await expect(page.getByRole("heading", { name: "Pick a look" })).toBeVisible();
  await page.getByRole("button", { name: /Crystal/ }).click();

  const steps = page.getByLabel(/^Step \d+ of \d+$/);
  const total = Number(/of (\d+)/.exec((await steps.getAttribute("aria-label")) ?? "")?.[1]);
  expect(total).toBe(7);

  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByRole("heading", { name: "Pick a starter layout" })).toBeVisible();

  for (let i = 3; i < total; i++) {
    await page.getByRole("button", { name: "Next" }).click();
    await expect(steps).toHaveAttribute("aria-label", `Step ${String(i + 1)} of ${String(total)}`);
  }
  await page.getByRole("button", { name: "Finish", exact: true }).click();
  await expect.poll(async () => (await shellSettings(page)).onboardingDone).toBe(true);
  await expect.poll(async () => (await shellSettings(page)).theme).toBe("crystal");
  const cmds = (await shellCalls(page)).map((c) => c.cmd);
  expect(cmds).toEqual(
    expect.arrayContaining(["shell_update_layouts", "shell_set_autostart", "shell_close"]),
  );
  expect(errors).toEqual([]);
});

test("Onboarding: Back returns to the previous step", async ({ page }) => {
  await openShellPage(page, "/onboarding.html", shellState({ onboardingDone: false }));
  await page.getByRole("button", { name: "Get started" }).click();
  await expect(page.getByRole("heading", { name: "Pick a look" })).toBeVisible();
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByRole("heading", { name: "Pick a starter layout" })).toBeVisible();
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByRole("heading", { name: "Pick a look" })).toBeVisible();
});
