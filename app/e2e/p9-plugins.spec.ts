// Phase 9 E2E (PLAN-2 9.1–9.4): Sandboxed plugins permission approval/revocation,
// on-demand Community Gallery fetch (zero background calls), verified install, and install from file.
import { expect, test } from "@playwright/test";
import { openShellPage, shellCalls } from "./stub/shellFixture";

test("Settings Plugins & Gallery: approve/revoke plugin, on-demand gallery browse & install, install from file", async ({
  page,
}) => {
  await openShellPage(page, "/settings.html");
  await page.getByRole("navigation").getByRole("button", { name: "Plugins & Gallery" }).click();

  // 1. Gallery must NOT fetch in the background on open.
  const callsBefore = (await shellCalls(page)).map((c) => c.cmd);
  expect(callsBefore).not.toContain("shell_gallery_fetch_index");

  // 2. Installed plugin starts as needs-approval; Approve -> approved, Revoke -> needs-approval.
  await expect(page.getByText("Demo Gauge v1.0.0 (needs-approval)")).toBeVisible();
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText("Demo Gauge v1.0.0 (approved)")).toBeVisible();
  await page.getByRole("button", { name: "Revoke" }).click();
  await expect(page.getByText("Demo Gauge v1.0.0 (needs-approval)")).toBeVisible();

  // 3. Explicit Browse gallery fetches index and installs verified package as needs-approval.
  await page.getByRole("button", { name: "Browse gallery" }).click();
  await expect(page.getByText("Solar Ring v1.2.0")).toBeVisible();
  await page.getByRole("button", { name: "Install", exact: true }).click();
  await expect(page.getByText("Solar Ring v1.2.0 (needs-approval)")).toBeVisible();

  // 4. Install from local file works and stays needs-approval.
  await page
    .getByRole("textbox", { name: "Local plugin archive path" })
    .fill("/tmp/local-pkg-0.1.0.opaline-plugin");
  await page.getByRole("button", { name: "Install from file" }).click();
  await expect(page.getByText("Local Pack Widget v0.1.0 (needs-approval)")).toBeVisible();

  const calls = (await shellCalls(page)).map((c) => c.cmd);
  expect(calls).toContain("shell_approve_plugin");
  expect(calls).toContain("shell_revoke_plugin");
  expect(calls).toContain("shell_gallery_fetch_index");
  expect(calls).toContain("shell_gallery_install");
  expect(calls).toContain("shell_install_plugin_file");
});
