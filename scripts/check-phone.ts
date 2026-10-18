/** Phone-sized checks against the real local game: the town picker's found
 * button is on screen, and the folded HUD opens and closes. Start pnpm dev
 * first. BROWSER_EXECUTABLE_PATH selects an installed browser, as in
 * check-browser.ts. Screenshots go to output/inkline-3d/phone-check.
 */
import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import { mkdir } from "node:fs/promises"
import { chromium } from "playwright"

const executable=process.env.BROWSER_EXECUTABLE_PATH??["/Applications/Brave Browser.app/Contents/MacOS/Brave Browser","/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].find(existsSync)
const browser=await chromium.launch({headless:true,...(executable?{executablePath:executable}:{})})
const output="output/inkline-3d/phone-check"
await mkdir(output,{recursive:true})
const errors:Array<string>=[]
try {
  for (const [name,width,height] of [["portrait",390,720],["narrow",360,640],["landscape",762,330]] as const) {
    const page=await browser.newPage({viewport:{width,height},deviceScaleFactor:2,isMobile:true,hasTouch:true})
    page.on("pageerror",e=>errors.push(`${name}: ${e.message}`))
    await page.addInitScript(() => {
  // The development monitor overlays the game; exercise the production UI.
  document.addEventListener("DOMContentLoaded", () => {
    const style = document.createElement("style")
    style.textContent = ".btm { display: none !important }"
    document.head.append(style)
  }, { once: true })
})
    await page.goto(process.env.GAME_BASE_URL??"http://127.0.0.1:5232")
    await page.waitForFunction(()=>"town" in window)
    // The found button sits inside the screen without scrolling: it is pinned to the bottom.
    const found=page.getByRole("button",{name:"新建城镇",exact:true})
    const box=(await found.boundingBox())!
    assert.ok(box.y>=0&&box.y+box.height<=height,`${name}: the found button is off screen`)
    await page.screenshot({path:`${output}/${name}-picker.png`})
    await page.getByRole("button",{name:"小型",exact:true}).click()
    await found.click()
    await page.waitForTimeout(1500)
    // Folded: no goods row, no system bar, no overlay list.
    for (const hidden of [".hud .stock",".system",".views"]) assert.equal(await page.locator(hidden).isVisible(),false,`${name}: ${hidden} is out`)
    await page.screenshot({path:`${output}/${name}-game.png`})
    for (const [button,shows] of [[".goods-chip",".hud .stock"],[".toolbar .more",".system"],[".fold-buttons button:last-child",".views"]] as const) {
      await page.locator(button).click()
      assert.ok(await page.locator(shows).isVisible(),`${name}: ${button} opens ${shows}`)
      await page.locator(button).click()
      assert.equal(await page.locator(shows).isVisible(),false,`${name}: ${button} folds ${shows}`)
    }
    if (name === "portrait") {
      await page.locator(".toolbar .pause").click()
      await page.locator(".toolbar button").filter({hasText:/^道路/}).click()
      const hall = await page.evaluate(() => window.town.runtime.snapshot().entities.find(e => e.components["Town/TownHall"])!.components["Town/Tile"])
      const cdp = await page.context().newCDPSession(page)
      const drag = async (dy: number) => {
        const [a,b] = await page.evaluate(([x,y,dy]) => [window.town.view.project(x!+3.5,y!+dy!,0),window.town.view.project(x!+6.5,y!+dy!,0)], [hall.x,hall.y,dy])
        await cdp.send("Input.dispatchTouchEvent", {type:"touchStart",touchPoints:[{x:a!.x,y:a!.y}]})
        for (let i=1;i<=8;i++) {
          await cdp.send("Input.dispatchTouchEvent", {type:"touchMove",touchPoints:[{x:a!.x+(b!.x-a!.x)*i/8,y:a!.y+(b!.y-a!.y)*i/8}]})
          await page.waitForTimeout(30)
        }
        await cdp.send("Input.dispatchTouchEvent", {type:"touchEnd",touchPoints:[]})
      }
      const roads = await page.evaluate(() => window.town.runtime.snapshot().entities.filter(e=>e.components["Town/Road"]).length)
      await drag(1.5)
      await page.waitForFunction(() => window.town.ui.stroke === "held", null, {timeout:3000})
      await drag(-1.5)
      await page.waitForFunction(() => window.town.ui.stroke === "held", null, {timeout:3000})
      assert.equal(await page.evaluate(() => window.town.runtime.snapshot().entities.filter(e=>e.components["Town/Road"]).length), roads)
      await page.locator(".stroke-bar").getByRole("button",{name:"建造",exact:true}).click()
      await page.waitForFunction(n => window.town.ui.dragFrom===null && window.town.runtime.snapshot().entities.filter(e=>e.components["Town/Road"]).length>n, roads)
      await cdp.detach()
      // Once flow data exists the chip opens the minute table, and panning keeps it open.
      await page.evaluate(() => window.town.advance(35))
      await page.waitForFunction(() => window.town.ui.stats?.flow !== null)
      await page.locator(".goods-chip").click()
      await page.locator(".flow-grid").waitFor({state:"visible"})
      assert.match(await page.locator(".flow-grid").innerText(), /生产[\s\S]*消耗[\s\S]*仓储/)
      await page.locator(".goods-chip").click()
      // The pause button resumes at the previous speed, then pauses again.
      await page.locator(".toolbar .pause").click()
      await page.waitForFunction(() => window.town.ui.speed > 0)
      await page.locator(".toolbar .pause").click()
      await page.waitForFunction(() => window.town.ui.speed === 0)
    }
    // Everything fits the width: nothing scrolls sideways.
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),`${name}: the page scrolls sideways`)
    await page.close()
  }
  assert.deepEqual(errors,[])
  console.log("phone checks passed")
} finally {
  await browser.close()
}
