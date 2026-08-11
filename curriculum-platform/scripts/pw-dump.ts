import { chromium } from "playwright";

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.on("console", (m) => console.log("CONSOLE", m.type(), m.text()));
  page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  page.on("requestfailed", (r) =>
    console.log("REQFAIL", r.url(), r.failure()?.errorText)
  );

  await page.goto("http://localhost:3000/map", {
    waitUntil: "networkidle",
    timeout: 60000,
  });
  await page.waitForTimeout(3000);
  console.log("title", await page.title());
  console.log("url", page.url());
  const body = await page.locator("body").innerText();
  console.log("body snippet:\n", body.slice(0, 1000));
  console.log("react-flow count", await page.locator(".react-flow").count());
  console.log("nodes", await page.locator(".react-flow__node").count());
  await page.screenshot({ path: "/tmp/pw-map.png", fullPage: true });

  await page.goto("http://localhost:3000/schedule", {
    waitUntil: "networkidle",
    timeout: 60000,
  });
  await page.waitForTimeout(3000);
  console.log(
    "sched snippet:\n",
    (await page.locator("body").innerText()).slice(0, 1000)
  );
  console.log(
    "buttons",
    await page.locator("button").evaluateAll((els) => els.map((e) => e.textContent))
  );
  await page.screenshot({ path: "/tmp/pw-sched.png", fullPage: true });
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
