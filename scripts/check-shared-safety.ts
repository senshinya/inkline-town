/** A shared save's chronicle is untrusted text in both the reckoning and town panels. */
import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import { gzipSync } from "node:zlib"
import { chromium } from "playwright"
import { SAVE_FORMAT, SAVE_VERSION } from "../src/save.ts"
import { headless } from "../src/sim/headless.ts"

const base = process.env.GAME_BASE_URL ?? "http://127.0.0.1:5232"
const town = headless({ size: "small", term: 45, land: "fair", seed: 7 })
const world = town.snapshot()
const payload = '<img src=x onerror="window.__chronicleInjected=1"> [constructor] [__proto__] [toString]'
world.resources["Town/Fate"] = { ...world.resources["Town/Fate"], state: "over", reason: "任期结束。", at: 1 }
world.resources["Town/Chronicle"].lines.push({ tick: 0, text: payload, alarm: true, at: null })
const file = { format: SAVE_FORMAT, version: SAVE_VERSION, slot: "manual", savedAt: Date.now(), title: "文本安全验证", world }
const form = new FormData()
form.append("town", new Blob([gzipSync(JSON.stringify(file))]), "town.json.gz")
form.append("picture", new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 2, 3])]), "picture.jpg")
form.append("meta", JSON.stringify({ title: "文本安全验证", description: "年表文本必须按原样显示" }))
const response = await fetch(`${base}/api/towns`, { method: "POST", body: form })
assert.equal(response.status, 201, response.ok ? undefined : await response.text())
const { url } = await response.json() as { url: string }
const executablePath = process.env.BROWSER_EXECUTABLE_PATH ?? ["/Applications/Brave Browser.app/Contents/MacOS/Brave Browser", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].find(existsSync)
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) })
try {
  const page = await browser.newPage()
  const errors: string[] = []
  page.on("pageerror", error => errors.push(error.message))
  await page.goto(url)
  await page.waitForFunction(() => document.body.classList.contains("visiting"), null, { timeout: 10000 })
  assert.deepEqual(errors, [], "Unknown tool markers must remain harmless text")
  await page.locator(".dialog .chronicle").waitFor({ state: "visible" })
  assert.equal(await page.evaluate(() => (window as unknown as { __chronicleInjected?: number }).__chronicleInjected), undefined, "A shared chronicle must never execute markup")
  assert.ok((await page.locator(".dialog .chronicle").textContent())?.includes(`0:00 ${payload}`))
  assert.equal(await page.locator(".dialog .chronicle img").count(), 0)
  await page.getByRole("button", { name: "查看城镇", exact: true }).click()
  await page.getByRole("button", { name: "接手游玩", exact: true }).click()
  await page.keyboard.press("t")
  const recent = page.locator(".panel .chronicle")
  await recent.waitFor({ state: "visible" })
  assert.ok((await recent.textContent())?.includes(payload))
  assert.equal(await recent.locator("img").count(), 0)
  assert.equal(await page.evaluate(() => (window as unknown as { __chronicleInjected?: number }).__chronicleInjected), undefined)
  console.log("Shared chronicle renders as text in both panels; no script executes and unknown tool markers are harmless")
} finally {
  await browser.close()
}
