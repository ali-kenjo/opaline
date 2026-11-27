import { expect, test } from "@playwright/test";

// Every Clock face keeps following the clock in WebKit (regression: compositions that read
// now() armed no timer, so a Clock froze at the time it was first drawn). The Lab's Round 1 stage
// runs on a controlled clock with its mock data frozen (moving mocks re-render every widget and
// would hide the bug): seconds faces must move within seconds, every face within ten minutes,
// and the big date when midnight passes (the faces show Europe/Berlin time).
test.use({ viewport: { width: 1180, height: 1100 } });

test("all Clock faces follow the clock", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // 23:57:10 in Berlin.
  await page.clock.install({ time: new Date("2026-11-23T22:57:10.300Z") });
  await page.goto("/lab.html?only=round1&frozen");
  await page.evaluate(() => document.fonts.ready);
  await page.clock.runFor(500);

  // What each face shows: its text and its accessible labels (analog hands have no text).
  const faces = () =>
    page.getByTestId("round1-clocks").evaluate((stage) =>
      [...stage.children].map((card) => {
        const labels = [...card.querySelectorAll("[aria-label]")].map((e) =>
          e.getAttribute("aria-label"),
        );
        return `${(card as HTMLElement).innerText}|${labels.join("|")}`;
      }),
    );
  const start = await faces();
  expect(start).toHaveLength(12);

  // Seconds: railway and chronograph dials and the flip clock show seconds.
  await page.clock.runFor(2_000);
  const later = await faces();
  for (const i of [2, 3, 4]) expect(later[i], `face ${String(i)}`).not.toBe(start[i]);

  // Ten minutes, across midnight: every face has moved, the big date included.
  await page.clock.runFor(10 * 60_000);
  const next = await faces();
  next.forEach((face, i) => {
    expect(face, `face ${String(i)}`).not.toBe(start[i]);
  });
  expect(errors).toEqual([]);
});
