import { chromium } from "playwright";

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  await page.goto("http://localhost:3000/map", { waitUntil: "networkidle" });
  await page.waitForSelector(".react-flow__node", { timeout: 15000 });

  const skill = page
    .locator(".react-flow__node")
    .filter({ hasText: "click for objectives" })
    .first();
  await skill.click({ force: true });

  const drawer = page.locator('[role="dialog"][aria-label="Skill details"]');
  await drawer.waitFor({ state: "visible", timeout: 5000 });
  await drawer.getByText("Learning objectives").waitFor({ timeout: 5000 });
  await drawer.getByRole("button", { name: "DAILY QUIZ" }).click();
  await drawer.getByText("Quick check:", { exact: false }).waitFor({ timeout: 5000 });
  await drawer.getByText("Answer ·", { exact: false }).first().waitFor({ timeout: 5000 });
  console.log("MAP PASS — drawer + daily quiz preview");

  await page.goto("http://localhost:3000/schedule", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Generate AI lesson plans/i }).click();
  await page.locator("#generated-plans").waitFor({ state: "visible", timeout: 8000 });
  console.log("SCHEDULE PASS — generated plans visible");

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
