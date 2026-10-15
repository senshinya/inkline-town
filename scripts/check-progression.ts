/** UI coverage for v7 saves, service upgrades, and continuing into a new term. */
import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import { mkdir } from "node:fs/promises"
import { chromium } from "playwright"
import { kinds } from "../src/content.ts"
import { resolveRules } from "../src/rules/config.ts"
import { guideSteps } from "../src/rules/guide.ts"
import { SAVE_FORMAT, SAVE_VERSION } from "../src/save.ts"
import { district } from "../tools/balance/scenario.ts"
import { fixture } from "../tools/balance/verify/fixture.ts"
import type { Snapshot } from "../src/sim/headless.ts"

const rules = resolveRules(), base = district("upgrade-course", [1, 1], ["market", "chapel"], false, rules)
const town = fixture({ ...base, homes: base.homes.map((h, i) => ({ ...h, tile: { ...h.tile, x: 45 + i } })) }, rules)
town.change(s => {
  s.resources["Town/Fate"] = { ...s.resources["Town/Fate"], rank: 2 }
  s.resources["Town/Guide"] = { done: guideSteps.filter(g => g.id !== "markethall").map(g => g.id), off: false }
  s.resources["Town/Treasury"].coins = 5000
  const hall = s.entities.find(e => e.components["Town/TownHall"])!.components["Town/Inventory"]
  hall.stock.planks = 80; hall.stock.stone = 80; hall.stock.tools = 20
})
town.run(0.5)
const legacy = town.snapshot()
const { term, began, rank, ...oldFate } = legacy.resources["Town/Fate"]
legacy.resources["Town/Fate"] = { ...oldFate, state: "won", governing: false, won: 0 }
const executablePath = process.env.BROWSER_EXECUTABLE_PATH ?? ["/Applications/Brave Browser.app/Contents/MacOS/Brave Browser", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].find(existsSync)
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) })
const errors: string[] = [], output = "output/inkline-3d/progression-check"
await mkdir(output, { recursive: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
page.on("pageerror", error => errors.push(error.message))
const snap = () => page.evaluate(() => window.town.runtime.snapshot())
const load = async (world: Snapshot, version = SAVE_VERSION) => {
  await page.evaluate(file => {
    localStorage.removeItem("inkline-town/save/auto")
    localStorage.setItem("inkline-town/save/manual", JSON.stringify(file))
  }, { format: SAVE_FORMAT, version, slot: "manual", savedAt: Date.now(), title: "晋升与续任验证", world })
  await page.reload()
  await page.waitForFunction(() => window.town)
  await page.getByRole("button", { name: "继续存档", exact: true }).click()
  await page.waitForFunction(() => !window.town.ui.founding)
  if (world.resources["Town/Fate"].state !== "over") {
    await page.locator(".toolbar .pause").click()
    await page.waitForFunction(() => window.town.ui.speed === 0)
  }
}
try {
  await page.goto(process.env.GAME_BASE_URL ?? "http://127.0.0.1:5232")
  await page.waitForFunction(() => window.town)
  await load(legacy, 7)
  assert.equal((await snap()).resources["Town/Fate"].rank, 2)
  assert.equal((await snap()).resources["Town/Fate"].state, "playing")
  await page.waitForFunction(() => window.town.ui.stats?.guide.step?.key === "markethall", null, { timeout: 3000 })
  assert.match(await page.locator(".ticker .guide .text").innerText(), /市场大厅/)
  for (const kind of ["market", "chapel"] as const) {
    const entity = (await snap()).entities.find(e => e.components["Town/Building"]?.kind === kind)!
    await page.evaluate(id => { window.town.ui.selected = id; window.town.ui.menu = null }, entity.id)
    const title = kinds[kind].upgrade!.title
    await page.getByRole("button", { name: `升级为${title}`, exact: true }).click()
    await page.waitForFunction(id => !!window.town.runtime.snapshot().entities.find(e => e.id === id)?.components["Town/Upgraded"], entity.id)
    await page.waitForFunction(t => document.querySelector(".panel h2")?.textContent === t, title)
    const picture = page.locator(".panel header img")
    await picture.waitFor({ state: "visible" })
    assert(await picture.evaluate(async (img: HTMLImageElement) => { await img.decode(); return img.naturalWidth > 20 }))
    await page.screenshot({ path: `${output}/${kind}.png` })
  }
  const upgraded = await snap()
  await load(upgraded)
  assert.equal((await snap()).entities.filter(e => e.components["Town/Upgraded"]).length, 2)
  const ended = await snap()
  ended.resources["Town/Fate"] = { ...ended.resources["Town/Fate"], state: "over", reason: "第 1 届任期结束。", at: 1 }
  await load(ended)
  await page.getByRole("button", { name: "下一任期", exact: true }).click()
  await page.waitForFunction(() => window.town.ui.stats?.fate.term === 2 && window.town.ui.stats.fate.state === "playing")
  const next = await snap()
  assert.equal(next.resources["Town/Fate"].rank, 2)
  assert.equal(next.entities.filter(e => e.components["Town/Upgraded"]).length, 2)
  assert(next.resources["Town/Chronicle"].lines.some((line: { text: string }) => line.text.includes("第 2 届任期")))
  await page.screenshot({ path: `${output}/next-term.png` })
  assert.deepEqual(errors, [])
  console.log("Legacy v7 save, market upgrade guide, both upgrade portraits, save/load and next-term checks passed")
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png` })
  console.error({ errors, guide: await page.evaluate(() => window.town.ui.stats?.guide) })
  throw error
} finally { await browser.close() }
