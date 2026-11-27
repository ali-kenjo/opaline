// Phase 8 E2E (PLAN-2 8.1, 8.2, 8.6): Desktop profiles snapshot/activate, manual override
// + Resume automation, opaline-expr automation rules, and extended shortcuts.
import { expect, test } from "@playwright/test";
import { openShellPage, shellCalls } from "./stub/shellFixture";

test("Settings Profiles & automation: snapshot profile, activate with manual override, add rule, and resume", async ({
  page,
}) => {
  await openShellPage(page, "/settings.html");
  await page.getByRole("navigation").getByRole("button", { name: "Profiles & automation" }).click();

  // 1. Snapshot current desktop as a profile.
  await page.getByRole("textbox", { name: "New profile name" }).fill("Work Desk");
  await page.getByRole("button", { name: "Snapshot current" }).click();
  await expect(page.getByText("Work Desk", { exact: true })).toBeVisible();

  // 2. Activate profile -> engages manual override banner with Resume automation.
  await page.getByRole("button", { name: "Activate" }).click();
  await expect(page.getByText("Automation paused (manual override)")).toBeVisible();

  // 3. Add an opaline-expr automation rule with hysteresis & min duration.
  await page.getByRole("textbox", { name: "Rule name" }).fill("Night Dark");
  await page.getByRole("textbox", { name: "Rule expression condition" }).fill("time.isNight");
  await page.getByRole("button", { name: "Add rule" }).click();
  await expect(page.getByText("Night Dark", { exact: true })).toBeVisible();

  // 4. Click Resume automation -> clears manual override.
  await page.getByRole("button", { name: "Resume automation" }).click();
  await expect(page.getByText("Automation paused (manual override)")).toBeHidden();

  const calls = (await shellCalls(page)).map((c) => c.cmd);
  expect(calls).toContain("shell_snapshot_profile");
  expect(calls).toContain("shell_activate_profile");
  expect(calls).toContain("shell_save_automation_rule");
  expect(calls).toContain("shell_resume_automation");
});

test("Settings Shortcuts: extended Phase 8 shortcuts save cleanly", async ({ page }) => {
  await openShellPage(page, "/settings.html");
  await page.getByRole("navigation").getByRole("button", { name: "Shortcuts" }).click();

  await page.getByRole("textbox", { name: "Next profile shortcut" }).fill("<Super><Alt>p");
  await page.getByRole("textbox", { name: "Cycle desktop look shortcut" }).fill("<Super><Alt>l");
  await page.getByRole("textbox", { name: "Peek primary monitor shortcut" }).fill("<Super><Alt>1");
  await page.getByRole("button", { name: "Save shortcuts" }).click();

  const calls = (await shellCalls(page)).map((c) => c.cmd);
  expect(calls).toContain("shell_set_extended_shortcuts");
});
