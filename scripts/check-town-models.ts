/** Review gallery and portable export checks, using the same isolated browser
 * workflow as check-browser.ts. The dev server must already be running. */
import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import { mkdir, writeFile } from "node:fs/promises"
import { chromium } from "playwright"
import { kindIds } from "../src/content.ts"

const executablePath = process.env.BROWSER_EXECUTABLE_PATH ?? ["/Applications/Brave Browser.app/Contents/MacOS/Brave Browser", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].find(existsSync)
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) })
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1 })
const errors: string[] = []
page.on("pageerror", e => errors.push(e.message))
page.on("console", e => { if (e.type() === "error") errors.push(e.text()) })
page.on("response", r => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`) })
const output = "output/inkline-3d/town-review"
await mkdir(output, { recursive: true })
const groups = ["市政建筑阶段", "共用施工模型", "PR #20 · 新模型", "全部建筑", "细节修订", "贸易与生产建筑", "工坊组", "修订模型", "建筑", "公园", "住宅与街区", "冬季", "废墟", "人物与货物", "建筑状况", "建筑升级与采空矿面"]
const captureSheet = async () => {
  const previous = await page.locator("#sheet-link").getAttribute("href")
  await page.getByRole("button", { name: "保存模型总览图", exact: true }).click()
  await page.waitForFunction(previous => {
    const link = document.querySelector<HTMLAnchorElement>("#sheet-link")!
    return !link.hidden && link.getAttribute("href") !== previous
  }, previous)
  return page.evaluate(async () => {
    const blob = await fetch(document.querySelector<HTMLAnchorElement>("#sheet-link")!.href).then(r => r.blob())
    return new Promise<string>(resolve => {
      const reader = new FileReader(); reader.onload = () => resolve(reader.result as string); reader.readAsDataURL(blob)
    })
  })
}
try {
  await page.goto(`${process.env.GAME_BASE_URL ?? "http://127.0.0.1:5232"}/model-review.html`)
  await page.locator(".model-view").first().waitFor()
  for (const group of groups) {
    await page.getByRole("button", { name: group, exact: true }).click()
    const collection = new URL(page.url()).searchParams.get("collection")!
    const image = await captureSheet()
    assert.ok(image?.startsWith("data:image/png;base64,"))
    await writeFile(`${output}/${collection}.png`, Buffer.from(image.split(",")[1]!, "base64"))
    await page.evaluate(() => scrollTo(0, 350))
    await page.screenshot({ path: `${output}/${collection}-page.png` })
    await page.getByRole("button", { name: "查看背面", exact: true }).click()
    assert.equal(await page.locator("output").textContent(), "180°")
    if (["milestones", "works", "handoff", "town", "rural", "workshops", "trades"].includes(collection)) {
      const rear = await captureSheet()
      await writeFile(`${output}/${collection}-rear.png`, Buffer.from(rear.split(",")[1]!, "base64"))
    }
    await page.getByRole("button", { name: "重置视角", exact: true }).click()
    await page.getByLabel("视角仰角").selectOption("50")
    const rear = await captureSheet()
    assert.ok(rear && rear !== image, `${group}: the exported view must respond to the camera`)
    await page.getByRole("button", { name: "重置视角", exact: true }).click()
    console.log(`ok ${collection}: ${await page.locator(".model-view").count()} models, rotation, elevation, PNG export`)
  }
  await page.setViewportSize({ width: 390, height: 844 })
  for (const [group, count, name] of [["市政建筑阶段", 3, "milestones"], ["共用施工模型", 9, "works"], ["PR #20 · 新模型", 14, "handoff"], ["全部建筑", kindIds.length + 2, "town"], ["细节修订", 9, "rural"]] as const) {
    await page.getByRole("button", { name: group, exact: true }).click()
    assert.equal(await page.locator(".model-view").count(), count)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${group}: phone preview must fit`)
    await page.screenshot({ path: `${output}/${name}-phone.png` })
  }
  await page.getByRole("button", { name: "贸易与生产建筑", exact: true }).click()
  assert.equal(await page.locator(".model-view").count(), 6)
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "Trade building phone preview must fit the viewport")
  await page.screenshot({ path: `${output}/trades-phone.png` })
  await page.getByRole("button", { name: "工坊组", exact: true }).click()
  assert.equal(await page.locator(".model-view").count(), 4)
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "Workshop phone preview must fit the viewport")
  await page.screenshot({ path: `${output}/workshops-phone.png` })
  await page.getByRole("button", { name: "公园", exact: true }).click()
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "Phone preview must fit the viewport")
  await page.screenshot({ path: `${output}/phone.png` })
  assert.deepEqual(errors, [])
  console.log("ok phone layout; no browser errors")
} finally {
  await browser.close()
}
