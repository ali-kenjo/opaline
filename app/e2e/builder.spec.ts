// Phase 6 E2E (PLAN-2 6.6–6.8): Visual Widget Builder (block tree, palette, live bindings &
// inline errors, fork first-party widget, save & place to Gallery "Your widgets") + Settings
// Data sources (CRUD, Run now, Trust approval for imported sources) + Accounts GNOME Keyring.
import { enterEdit, expect, openLayer, storedItems, test } from "./stub/layerFixture";
import { openShellPage } from "./stub/shellFixture";

test("Widget Builder: add block, live expression preview & error, save and place on desktop", async ({
  page,
}) => {
  await openLayer(page);
  await enterEdit(page);
  await page.getByRole("toolbar").getByRole("button", { name: "Add widget" }).click();
  const gallery = page.getByRole("dialog", { name: "Add widget" });
  await gallery.getByRole("button", { name: "Your widgets" }).click();
  await gallery.getByRole("button", { name: "Open Widget Builder" }).click();

  const builder = page.getByRole("dialog", { name: "Widget Builder" });
  await expect(builder).toBeVisible();

  // Rename widget and add a Text block from the palette.
  await builder.getByRole("textbox", { name: "Widget name" }).fill("Build Health");
  await builder.getByRole("textbox", { name: "Widget ID" }).fill("build-health");
  await builder.getByRole("button", { name: "Text", exact: true }).click();

  // Enter a valid live template -> evaluates immediately.
  const textInput = builder.getByRole("textbox", { name: "Text template" });
  await textInput.fill("CPU {cpu.load | round}%");
  await expect(builder.getByRole("status").filter({ hasText: /CPU \d+%/ })).toBeVisible();

  // Enter a broken template -> inline error shown immediately, no crash.
  await textInput.fill("CPU {cpu.load +}");
  await expect(builder.getByRole("alert")).toContainText("Error at");

  // Fix template, Save & place -> adds custom widget onto the desktop.
  await textInput.fill("CPU {cpu.load | round}%");
  await builder.getByRole("button", { name: "Save & place" }).click();
  await expect(builder).toBeHidden();

  await expect
    .poll(
      async () => (await storedItems(page)).filter((i) => i.kind === "custom.build-health").length,
    )
    .toBe(1);
});

test("Inspector Customize layout… forks any first-party widget into the Builder", async ({
  page,
}) => {
  await openLayer(page);
  await enterEdit(page);
  await page
    .locator('[data-item-id="w-cpu"]')
    .getByRole("button", { name: "Customize widget" })
    .click();
  const inspector = page.getByRole("dialog", { name: /inspector$/ });
  await expect(inspector).toBeVisible();

  await inspector.getByRole("button", { name: "Customize layout…" }).click();
  const builder = page.getByRole("dialog", { name: "Widget Builder" });
  await expect(builder).toBeVisible();
  await expect(builder.getByRole("textbox", { name: "Widget name" })).toHaveValue("CPU (Custom)");
});

test("Settings Data sources: imported trust approval, Run now, and new HTTP source", async ({
  page,
}) => {
  await openShellPage(page, "/settings.html");
  await page.getByRole("button", { name: /^Data sources/ }).click();

  // Imported source starts in needs-approval showing exact command.
  const approvalRegion = page.getByRole("region", { name: "Imported sources awaiting approval" });
  await expect(approvalRegion).toContainText("Runs command: uname -r");
  await approvalRegion.getByRole("button", { name: "Approve" }).click();
  await expect(approvalRegion).toBeHidden();

  // Run now executes and displays result.
  await page.getByRole("button", { name: "Run now" }).first().click();
  await expect(page.getByText('"imported-pack-cmd"')).toBeVisible();

  // Add a new local HTTP/JSON source (e.g. local n8n).
  await page.getByRole("button", { name: "Add data source" }).click();
  await page.getByRole("combobox", { name: "Source type" }).selectOption("http");
  await page.getByRole("textbox", { name: "Source ID" }).fill("local-n8n");
  await page.getByRole("textbox", { name: "Source display name" }).fill("Local n8n");
  await page
    .getByRole("textbox", { name: "HTTP URL" })
    .fill("http://localhost:5678/api/v1/workflows");
  await page.getByRole("switch", { name: "Allow local HTTP" }).click();
  await page.getByRole("button", { name: "Save source" }).click();
  await expect(page.getByText("source.local-n8n")).toBeVisible();
});

test("Settings Accounts: GNOME Keyring stores secrets without echoing values", async ({ page }) => {
  await openShellPage(page, "/settings.html");
  await page.getByRole("button", { name: /^Accounts & integrations/ }).click();

  const planted = "PLANTED_UI_SECRET_DO_NOT_SHOW_991";
  await page.getByRole("textbox", { name: "Secret name" }).fill("n8n_key");
  await page.getByLabel("Secret value").fill(planted);
  await page.getByRole("button", { name: "Save to GNOME Keyring" }).click();

  await expect(page.getByText("{{secret:n8n_key}}", { exact: true })).toBeVisible();
  // Secret value must NEVER appear anywhere in the rendered page text.
  await expect(page.locator("body")).not.toContainText(planted);
});
