/**
 * The page around the town: the 3D scene, camera and pointer gestures, and the
 * top bar, toolbar, build menu, panel, tooltip, and toasts; the dialog a new
 * town is founded from, and the reckoning at the end of its term.
 */
import { Application, Graphics } from "pixi.js"

import { drawBuilding, drawHouse, drawParkPiece, homeVariant, plate, plateHalf } from "./art.ts"
import {
  categoryColor,
  categoryOrder,
  costText,
  defaultCharter,
  goodIds,
  goods,
  groundIds,
  grounds,
  home,
  kindOrder,
  park as parkRules,
  propIds,
  props,
  PAVE_COST,
  PAVED_PACE,
  tierHome,
  winters,
  kinds,
  landIds,
  lands,
  mood as moodRules,
  needTitle,
  RESERVES,
  ROAD_COST,
  sizeIds,
  sizes,
  TAX_STEPS,
  TERMS,
  type Category,
  type CharterValue,
  type GoodId,
  type GroundId,
  type Kind,
  type KindId,
  type ParkPiece,
  type PropId,
  type Tier
} from "./content.ts"
import { GRID } from "./iso.ts"
import { goodIcon, icon, iconEl, type IconName } from "./icons.ts"
import { generate } from "./mapgen.ts"
import { askOf, priceOf } from "./sim/index.ts"
import type { Line, Stats, Tool, TradeMode, UiValue, View } from "./ui.ts"
import { emptyPreview } from "./ui.ts"
import { GameScene } from "./render3d/scene.ts"
import { MapInput } from "./render3d/input.ts"

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = "") => {
  const node = document.createElement(tag)
  node.className = className
  node.textContent = text
  return node
}

const hex = (color: number) => `#${color.toString(16).padStart(6, "0")}`
/** Seconds as m:ss. */
const clockText = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`
const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n)}`

export interface Persistence {
  readonly save: () => string | null
  readonly load: () => string | null
}

export const createHost = async (mount: HTMLElement, persistence: () => Persistence) => {
  const app = new Application()
  // Pixi remains an offscreen thumbnail renderer for the unchanged menus.
  await app.init({ width: 64, height: 64, antialias: true, resolution: 2, autoStart: false, backgroundAlpha: 0 })
  app.stop()
  const stage = new GameScene(mount)

  // ── DOM ──
  // Top left: the term's clock and the treasury, the goods in stock below, then the crown's request and any alarm.
  // Top right: the people and their mood, which opens the town's panel.
  const hud = el("div", "hud left")
  const bar = el("div", "card bar")
  const clock = el("div", "cell clock")
  const coins = el("div", "cell coins")
  bar.append(clock, coins)
  const stock = el("div", "card stock")
  /** What each good is for, for the stock bar's tooltips: who makes it, who takes it. */
  const goodHelp: Readonly<Record<GoodId, string>> = {
    wood: "伐木场砍伐树木；锯木厂将原木加工成木板",
    planks: "住宅和建筑的建材：锯木厂将原木加工成木板",
    stone: "用于建筑和铺路：采石场从有限的岩石中开采",
    ore: "矿场开采矿石；铁匠铺将其锻造成工具",
    tools: "用于建筑；工坊每工作50或60次消耗一件，可由铁匠铺生产或购买",
    fish: "移民的食物：渔场在水边捕鱼；储存期间会逐渐腐坏",
    smoked: "能储存一整个冬季的鱼：由熏鱼坊制作",
    wheat: "农场种植小麦；磨坊将其磨成面粉（冬季停止种植）",
    flour: "由磨坊生产；面包坊将其烤成面包",
    bread: "市民所需的食物；供应面包的移民小屋税收增加50%；会逐渐腐坏，但比鲜鱼耐储存",
    wool: "牧羊场剪取羊毛；织布坊将其织成布料",
    cloth: "市民需要布料；仅向宜居度达到5的街区配送"
  }
  const groups: ReadonlyArray<ReadonlyArray<GoodId>> = [
    ["wood", "planks", "stone", "ore", "tools"],
    ["fish", "smoked", "wheat", "flour", "bread"],
    ["wool", "cloth"]
  ]
  stock.title = "城镇库存 · 将鼠标悬停在物资上查看用途"
  const goodCells = new Map<GoodId, HTMLElement>()
  for (const group of groups) {
    const cell = el("div", "group")
    for (const g of group) {
      const item = el("span", "good")
      item.title = `${goods[g].title}：${goodHelp[g]}`
      item.setAttribute("aria-label", goods[g].title)
      const glyph = el("span", "glyph")
      glyph.innerHTML = goodIcon(g, 18)
      const count = el("span", "count", "0")
      item.append(glyph, count)
      cell.append(item)
      goodCells.set(g, count)
    }
    stock.append(cell)
  }
  // The crown's request, when there is one, and what threatens (or is about to complete) the term.
  const request = el("div", "card request")
  const requestText = el("div", "cell")
  const send = el("button", "send", "交付")
  send.onclick = (event) => {
    event.stopPropagation()
    ui.edits.push({ type: "deliver" })
  }
  request.append(requestText, send)
  const alarm = el("div", "card alarm")
  // The town ticker: what needs looking at now, and the latest news.
  const ticker = el("div", "card ticker")
  hud.append(bar, stock, request, alarm, ticker)
  const people = el("div", "hud right")
  const folk = el("div", "card bar")
  const approval = el("div", "cell")
  const settlerCell = el("div", "cell")
  const citizenCell = el("div", "cell")
  const jobs = el("div", "cell jobs")
  folk.append(approval, settlerCell, citizenCell, jobs)
  people.append(folk)
  people.title = "打开城镇统计、目标和政策面板（T）"
  people.onclick = () => toggleMenu("town")
  /** Points the page at a place: the camera goes there, it is outlined for a moment, and (when it is a thing) it is selected. */
  const goTo = (at: { readonly x: number; readonly y: number }, size: number, id: number | null) => {
    stage.focus(at.x + size / 2, at.y + size / 2)
    ui.flash = { cell: { x: at.x, y: at.y }, size, until: Date.now() + 4000 }
    if (id !== null) {
      ui.selected = id
      ui.menu = null
      refreshTools()
    }
  }
  let shortCursor = 0
  jobs.onclick = (event) => {
    event.stopPropagation()
    const short = ui.stats?.shortStaffed ?? []
    if (short.length === 0) return toggleMenu("town")
    const next = short[shortCursor % short.length]!
    shortCursor += 1
    goTo(next.cell, next.size, next.id)
  }
  const tooltip = el("div", "tooltip")
  const toastBox = el("div", "toast")
  const toolbar = el("div", "toolbar")
  const system = el("div", "system")
  const panel = el("aside", "panel")
  const dialog = el("div", "dialog")
  const confirmBox = el("div", "dialog")
  const reckoning = el("div", "dialog")
  const result = el("button", "result", "")
  result.onclick = () => showReckoning(true)
  // Map views, and the legend of the one shown.
  const views = el("div", "views")
  const legend = el("div", "card legend")
  document.body.append(hud, people, tooltip, toastBox, toolbar, system, panel, result, dialog, confirmBox, reckoning, views, legend)

  let toastTimer = 0
  const ui: UiValue = {
    tool: "select",
    placing: null,
    ground: "lawn",
    prop: "lamp",
    menu: null,
    pointer: null,
    dragFrom: null,
    selected: null,
    gestures: [],
    // A town is founded behind the dialog, so there is land to look at while choosing.
    edits: [{ type: "newTown", charter: defaultCharter((Date.now() & 0x7fffffff) >>> 0) }],
    preview: emptyPreview(),
    hits: [],
    panel: null,
    centres: new Map(),
    stats: null,
    speed: 1,
    founding: true,
    view: "none",
    overlay: { key: "", cells: [] },
    tints: new Map(),
    legend: null,
    flash: null,
    toast: (message) => {
      toastBox.textContent = message
      toastBox.classList.add("show")
      window.clearTimeout(toastTimer)
      toastTimer = window.setTimeout(() => toastBox.classList.remove("show"), 1800)
    }
  }

  const tools: ReadonlyArray<{
    readonly tool: Tool | "build"
    readonly label: string
    readonly key: string
    readonly icon: IconName
    readonly tip: string
  }> = [
    {
      tool: "select",
      label: "选择",
      key: "S",
      icon: "select",
      tip: "点击建筑或住宅查看详情 · 拖动平移 · 滚轮缩放"
    },
    { tool: "road", label: "道路", key: "R", icon: "road", tip: `拖动铺设道路 · 每格 ${ROAD_COST} 金币` },
    {
      tool: "pave",
      label: "铺石",
      key: "P",
      icon: "pave",
      tip: `沿道路拖动铺石：运输员和服务人员的速度提升至 ${PAVED_PACE} 倍，并提高沿街宜居度 · 每格 ${PAVE_COST.coins} 金币和 ${PAVE_COST.stone} 石料`
    },
    { tool: "home", label: "住宅", key: "H", icon: "homes", tip: `拖动沿道路建造住宅 · 每栋 ${costText(home.cost)}` },
    { tool: "build", label: "建造", key: "B", icon: "build", tip: "选择建筑，再点击放置 · Esc 取消" },
    { tool: "bulldoze", label: "拆除", key: "X", icon: "bulldoze", tip: "点击拆除建筑、住宅、道路、树木或农田" }
  ]
  // The town's panel is opened most: it has a button of its own, first and larger.
  const townButton = el("button", "town-button")
  townButton.title = "城镇目标、统计、税率和贸易（T）"
  townButton.append(iconEl("town", 22), el("span", "", "城镇"), el("kbd", "", "T"))
  townButton.onclick = () => toggleMenu("town")
  const toolGroup = el("div", "group")
  toolbar.append(townButton, toolGroup)
  const buttons = tools.map((tool) => {
    const button = el("button", "")
    button.title = tool.tip
    button.append(iconEl(tool.icon), document.createTextNode(tool.label), el("kbd", "", tool.key))
    button.onclick = () => (tool.tool === "build" ? toggleMenu("build") : choose(tool.tool))
    toolGroup.append(button)
    return { tool, button }
  })
  const speedGroup = el("div", "group")
  toolbar.append(speedGroup)
  const speeds = [
    { speed: 0, label: "", key: "space" },
    { speed: 1, label: "1×", key: "1" },
    { speed: 2, label: "2×", key: "2" },
    { speed: 4, label: "4×", key: "3" }
  ].map(({ speed, label, key }) => {
    const button = el("button", speed === 0 ? "pause" : "", label)
    if (speed === 0) button.append(iconEl("pause", 14))
    button.title = speed === 0 ? "暂停游戏（空格）" : `以 ${label} 速度运行（${key}）`
    button.onclick = () => setSpeed(speed)
    speedGroup.append(button)
    return { speed, button }
  })
  let lastSpeed = 1
  const setSpeed = (speed: number) => {
    if (speed > 0) lastSpeed = speed
    ui.speed = speed
    for (const s of speeds) s.button.classList.toggle("on", s.speed === speed)
  }
  setSpeed(1)

  // ── Map views ──
  const viewButtons: ReadonlyArray<{ readonly view: Exclude<View, "none">; readonly label: string; readonly key: string; readonly icon: IconName }> = [
    { view: "appeal", label: "宜居度", key: "D", icon: "appeal" },
    { view: "workers", label: "劳动力", key: "W", icon: "workers" },
    { view: "fire", label: "火灾", key: "F", icon: "fire" },
    { view: "health", label: "健康", key: "A", icon: "health" },
    { view: "order", label: "治安", key: "O", icon: "order" },
    { view: "condition", label: "建筑状况", key: "C", icon: "condition" }
  ]
  views.append(iconEl("view", 16))
  const viewEls = viewButtons.map((v) => {
    const button = el("button", "")
    button.title = `在地图上显示${v.label}（${v.key}）；再次点击隐藏`
    button.append(iconEl(v.icon, 15), document.createTextNode(v.label), el("kbd", "", v.key))
    button.onclick = () => setView(ui.view === v.view ? "none" : v.view)
    views.append(button)
    return { ...v, button }
  })
  const setView = (view: View) => {
    ui.view = view
    for (const v of viewEls) v.button.classList.toggle("on", v.view === view)
  }
  // New town, save, and load, out of the way in the bottom right. Founding or
  // loading replaces the town, so each asks first.
  const action = (name: IconName, label: string, tip: string, run: () => void) => {
    const button = el("button", "")
    button.title = tip
    button.append(iconEl(name), document.createTextNode(label))
    button.onclick = run
    system.append(button)
  }
  action("save", "保存", "将城镇保存到此浏览器（每两分钟自动保存）", () =>
    ui.toast(persistence().save() ?? "已保存")
  )
  action("load", "读取", "读取最新的手动或自动存档", () =>
    confirmLeave("读取最新存档？", "当前城镇将被最新的手动或自动存档替换。", "读取", () =>
      ui.toast(persistence().load() ?? "已读取")
    )
  )
  action("newTown", "新城镇", "在新地图上建立城镇", () =>
    confirmLeave("建立新城镇？", "除非先保存，否则当前城镇将永久丢失。", "选择新地图", () =>
      openCharter(true)
    )
  )

  /** Asks before something that replaces the town: save first, go ahead, or stay. */
  const confirmLeave = (title: string, text: string, go: string, run: () => void) => {
    const wasSpeed = ui.speed
    setSpeed(0)
    confirmBox.replaceChildren()
    const card = el("div", "sheet narrow")
    card.append(el("h2", "", title), el("p", "sub", text))
    const actions = el("div", "actions")
    const close = (resume: boolean) => {
      confirmBox.classList.remove("open")
      if (resume) setSpeed(wasSpeed)
    }
    const stay = el("button", "frame primary", "继续游戏")
    stay.onclick = () => close(true)
    const saveFirst = el("button", "frame", `保存后${go.toLowerCase()}`)
    saveFirst.onclick = () => {
      const failed = persistence().save()
      if (failed) return ui.toast(failed)
      close(true)
      run()
    }
    const leave = el("button", "frame danger", `不保存，直接${go}`)
    leave.onclick = () => {
      close(true)
      run()
    }
    actions.append(stay, saveFirst, leave)
    card.append(actions)
    confirmBox.append(card)
    confirmBox.classList.add("open")
    stay.focus()
  }

  const refreshTools = () => {
    for (const { tool, button } of buttons) {
      const on = tool.tool === "build" ? ui.menu === "build" || ui.tool === "place" || ui.tool === "ground" || ui.tool === "prop" : tool.tool === ui.tool
      button.classList.toggle("on", on)
    }
    townButton.classList.toggle("on", ui.menu === "town")
  }
  const choose = (tool: Tool) => {
    ui.tool = tool
    ui.dragFrom = null
    if (tool !== "place") ui.placing = null
    if (tool !== "select") ui.selected = null
    refreshTools()
  }
  const toggleMenu = (menu: "build" | "town") => {
    ui.menu = ui.menu === menu ? null : menu
    if (ui.menu) ui.selected = null
    refreshTools()
  }
  const place = (kind: KindId) => {
    ui.placing = kind
    ui.menu = null
    choose("place")
    ui.toast(`点击放置${kinds[kind].title.toLowerCase()} · Esc 取消`)
  }
  const layGround = (ground: GroundId) => {
    ui.ground = ground
    ui.menu = null
    choose("ground")
    ui.toast(`拖出矩形铺设${grounds[ground].title.toLowerCase()} · Esc 取消`)
  }
  const furnish = (prop: PropId) => {
    ui.prop = prop
    ui.menu = null
    choose("prop")
    ui.toast(`点击公园格子摆放${props[prop].title.toLowerCase()} · Esc 取消`)
  }
  choose("select")

  window.addEventListener("keydown", (event) => {
    if (event.target instanceof HTMLElement && event.target.closest("input,select,textarea,[contenteditable=true]")) return
    if (event.key === " " && event.target instanceof HTMLButtonElement) return
    if (confirmBox.classList.contains("open") && event.key === "Escape") confirmBox.querySelector<HTMLButtonElement>(".primary")?.click()
    if (ui.founding || reckoning.classList.contains("open") || confirmBox.classList.contains("open")) return
    if (event.key === " ") {
      event.preventDefault()
      setSpeed(ui.speed === 0 ? lastSpeed : 0)
    }
    if (event.key === "1") setSpeed(1)
    if (event.key === "2") setSpeed(2)
    if (event.key === "3") setSpeed(4)
    if (event.key === "Escape") {
      if (ui.tool !== "select") choose("select")
      else if (ui.menu) ui.menu = null
      else ui.selected = null
      refreshTools()
    }
    const key = event.key.toLowerCase()
    if (key === "s") choose("select")
    if (key === "r") choose("road")
    if (key === "p") choose("pave")
    const viewKey = viewButtons.find((v) => v.key.toLowerCase() === key)
    if (viewKey) setView(ui.view === viewKey.view ? "none" : viewKey.view)
    if (key === "h") choose("home")
    if (key === "x") choose("bulldoze")
    if (key === "b") toggleMenu("build")
    if (key === "t") toggleMenu("town")
  })

  // ── History, for the town panel's lines ──
  interface Sample {
    readonly coins: number
    readonly residents: number
    readonly stock: Readonly<Record<GoodId, number>>
  }
  /** One sample every `SAMPLE_SECONDS`, the last ten minutes of them. */
  const history: Array<Sample> = []
  const SAMPLE_SECONDS = 4
  const HISTORY = 150
  window.setInterval(() => {
    const s = ui.stats
    if (!s) return
    history.push({ coins: s.coins, residents: s.settlers + s.citizens, stock: s.stock })
    if (history.length > HISTORY) history.shift()
  }, SAMPLE_SECONDS * 1000)

  /** A thin ink line of `values`, scaled to its own range. */
  const sparkline = (values: ReadonlyArray<number>): string => {
    if (values.length < 2) return ""
    const w = 300
    const h = 36
    const lo = Math.min(...values)
    const hi = Math.max(...values)
    const span = hi - lo || 1
    const points = values
      .map((v, i) => `${((i / (values.length - 1)) * w).toFixed(1)},${(h - 2 - ((v - lo) / span) * (h - 4)).toFixed(1)}`)
      .join(" ")
    return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><polyline points="${points}" fill="none" stroke="#3d4943" stroke-width="1.5" vector-effect="non-scaling-stroke"/></svg>`
  }

  // ── Pictures of buildings, for the build menu and the panel ──
  const pictures = new Map<string, Promise<string>>()
  /** A building (or a home of a tier) drawn as the town draws it, as an image. */
  const picture = (what: KindId | Tier | `park:${GroundId | PropId}`): HTMLImageElement => {
    const img = document.createElement("img")
    img.className = "thumb"
    img.alt = ""
    const id = String(what)
    let url = pictures.get(id)
    if (!url) {
      const g = new Graphics()
      if (typeof what === "string" && what.startsWith("park:")) drawParkPiece(g, what.slice(5) as GroundId | PropId)
      else if (what === 1 || what === 2 || what === 3) {
        plate(g, plateHalf(1))
        drawHouse(g, what, 1, { right: true, left: false }, homeVariant(0.1))
      } else {
        const kind = kinds[what as KindId]
        plate(g, plateHalf(kind.size))
        drawBuilding(g, kind, 1, 0, 0.6, { right: true, left: true })
      }
      url = app.renderer.extract.base64({ target: g, resolution: 2 })
      void url.finally(() => g.destroy())
      pictures.set(id, url)
    }
    void url.then((src) => (img.src = src))
    return img
  }

  // ── Panel ──
  /** Volatile parts of the panel, updated in place without rebuilding it. */
  let live: Array<() => void> = []
  let shape = ""

  /** A section of the panel, its heading with an icon; `help` is kept behind an ⓘ rather than spelled out. */
  const section = (heading: string, glyph?: IconName, help?: string) => {
    const box = el("section", "")
    const h3 = el("h3", "")
    if (glyph) h3.append(iconEl(glyph))
    h3.append(document.createTextNode(heading))
    if (help) {
      const info = iconEl("info", 15)
      info.classList.add("help")
      info.title = help
      h3.append(info)
    }
    box.append(h3)
    return box
  }
  const header = (title: string, lead: HTMLElement, below?: HTMLElement) => {
    const head = el("header", "")
    const text = el("div", "title")
    text.append(el("h2", "", title))
    if (below) text.append(below)
    const closeButton = el("button", "close")
    closeButton.title = "关闭（Esc）"
    closeButton.append(iconEl("close", 18))
    closeButton.onclick = () => {
      ui.selected = null
      ui.menu = null
      refreshTools()
    }
    head.append(lead, text, closeButton)
    return head
  }

  const lockText = (kind: Pick<Kind, "unlock"> | ParkPiece): string | null => {
    const s = ui.stats
    if (!s) return null
    const residents = s.settlers + s.citizens
    if (residents < kind.unlock.residents) return `需要 ${kind.unlock.residents} 位居民`
    if (s.citizens < kind.unlock.citizens) return `需要 ${kind.unlock.citizens} 位市民`
    return null
  }

  /** A cost as icon chips, each marked when the town is short of it. */
  const costChips = (cost: Kind["cost"]) => {
    const box = el("span", "chips")
    const chips: Array<{ chip: HTMLElement; short: () => boolean }> = []
    if (cost.coins > 0) {
      const chip = el("span", "chip")
      chip.innerHTML = `${icon("coins", 14)}${cost.coins}`
      chips.push({ chip, short: () => (ui.stats?.coins ?? 0) < cost.coins })
    }
    for (const [g, n] of Object.entries(cost.materials) as Array<[GoodId, number]>) {
      const chip = el("span", "chip")
      chip.title = goods[g].title
      chip.innerHTML = `${goodIcon(g, 14)}${n}`
      chips.push({ chip, short: () => (ui.stats?.stock[g] ?? 0) < n })
    }
    box.append(...chips.map((c) => c.chip))
    const refresh = () => {
      let short = false
      for (const c of chips) {
        const now = c.short()
        c.chip.classList.toggle("short", now)
        short ||= now
      }
      return short
    }
    return { box, refresh }
  }

  const categoryIcon: Readonly<Record<Category, IconName>> = {
    storage: "jobs",
    gathering: "wood",
    crafts: "tools",
    food: "bread",
    services: "faith"
  }

  const buildMenu = () => {
    panel.append(header("建造", iconEl("build", 30), el("p", "sub", "选择项目，再点击地图 · Esc 取消")))
    for (const category of categoryOrder) {
      const options = kindOrder.filter((id) => kinds[id].category === category && kinds[id].buildable)
      if (options.length === 0) continue
      const box = section({ storage: "仓储", gathering: "采集", crafts: "制造", food: "食品", services: "公共服务" }[category], categoryIcon[category])
      box.style.borderTop = `3px solid ${hex(categoryColor[category])}`
      for (const id of options) {
        const kind = kinds[id]
        const option = el("button", "option")
        const cost = costChips(kind.cost)
        cost.box.prepend(el("span", "cap", "费用"))
        const terms = el("span", "chips")
        const r = kind.recipe
        const does = [
          r ? `<span class="chip" title="${r.input ? `将 ${r.inputs} ${goods[r.input].title} 加工成 ${r.batch} ${goods[r.output].title}` : `生产 ${r.batch} ${goods[r.output].title}`}，每 ${r.seconds} 秒一次">${r.input ? `${goodIcon(r.input, 14)}<i>→</i>` : ""}${goodIcon(r.output, 14)}${r.batch > 1 ? r.batch : ""}</span>` : "",
          kind.service ? `<span class="chip" title="服务人员为距入口 ${kind.service.range} 格道路内的住宅提供服务">${icon(kind.service.service === "goods" ? "trade" : kind.service.service === "faith" ? "faith" : kind.service.service === "repair" ? "repair" : kind.service.service, 14)}${kind.service.range}</span>` : "",
          kind.holds && !kind.recipe && !kind.service ? `<span class="chip" title="每种物资最多储存 ${kind.holds.cap} 件${kind.keeps ? `，鲜鱼和面包的腐坏速度降至原来的 1/${kind.keeps}` : ""}">${icon("jobs", 14)}${kind.holds.cap}</span>` : "",
          kind.workers > 0 ? `<span class="chip dim" title="需要 ${kind.workers} 位${kind.crew === "citizens" ? "市民" : "移民"}，来自15格道路内的住宅">${icon(kind.crew === "citizens" ? "citizens" : "settlers", 14)}${kind.workers}</span>` : "",
          kind.appeal ? `<span class="chip ${kind.appeal.value < 0 ? "bad" : "good"}" title="周围宜居度 ${kind.appeal.value > 0 ? "+" : ""}${kind.appeal.value}，影响 ${kind.appeal.reach} 格${kind.appeal.value < 0 ? "：住宅应远离" : "：适合住宅"}">${icon("appeal", 14)}${kind.appeal.value > 0 ? "+" : ""}${kind.appeal.value}</span>` : "",
          `<span class="chip dim" title="维护费：每分钟的金币支出（暂停时为四分之一）">${icon("upkeep", 14)}${kind.upkeep}/分钟</span>`
        ].join("")
        terms.innerHTML = `<span class="cap">效果</span>${does}`
        const blurb = el("span", "blurb", kind.blurb)
        option.append(picture(id), el("span", "name", kind.title.toLowerCase()), cost.box, terms, blurb)
        option.title = `${kind.title}：${kind.blurb}${kind.workers > 0 ? ` · ${kind.workers} ${kind.crew === "citizens" ? "市民" : "移民"}工人，来自15格道路以内` : ""}${kind.service ? ` · 服务范围 ${kind.service.range} 格道路` : ""}${kind.appeal ? ` · 宜居度 ${kind.appeal.value > 0 ? "+" : ""}${kind.appeal.value}，影响 ${kind.appeal.reach} 格` : ""} · ${kind.upkeep} 金币/分钟`
        option.onclick = () => place(id)
        live.push(() => {
          const lock = lockText(kind)
          const short = cost.refresh()
          option.disabled = lock !== null
          option.classList.toggle("short", lock === null && short)
          blurb.textContent = lock ?? kind.blurb
        })
        box.append(option)
      }
      panel.append(box)
    }
    // Parks are laid out piece by piece: ground first, then what stands on it.
    const parks = section(
      "公园",
      "decor",
      `先铺地面，再摆放设施。相邻地面组成一座公园：设施越丰富，附近宜居度越高（市民住宅需要5，市民宅邸需要15）。每 ${parkRules.cellsPerProp} 格地面可计入一件设施。`
    )
    parks.style.borderTop = "3px solid #4f9a6a"
    const pieces: ReadonlyArray<{ readonly id: GroundId | PropId; readonly piece: ParkPiece; readonly pick: () => void; readonly ground: boolean }> = [
      ...groundIds.map((id) => ({ id, piece: grounds[id], pick: () => layGround(id), ground: true })),
      ...propIds.map((id) => ({ id, piece: props[id], pick: () => furnish(id), ground: false }))
    ]
    for (const { id, piece, pick, ground } of pieces) {
      if (ground && id === "lawn") parks.append(el("p", "empty", "地面 · 拖出矩形铺设"))
      if (!ground && id === "lamp") parks.append(el("p", "empty", "设施 · 点击公园格子摆放"))
      const option = el("button", "option")
      const cost = costChips(piece.cost)
      cost.box.prepend(el("span", "cap", "费用"))
      const terms = el("span", "chips")
      terms.innerHTML = `<span class="cap">效果</span><span class="chip good" title="为公园增加的美观值">${icon("appeal", 14)}+${piece.beauty}</span><span class="chip dim" title="维护费，金币/分钟">${icon("upkeep", 14)}${piece.upkeep}/分钟</span>`
      const blurb = el("span", "blurb", piece.blurb)
      option.append(picture(`park:${id}`), el("span", "name", piece.title.toLowerCase()), cost.box, terms, blurb)
      option.title = `${piece.title}：${piece.blurb} · 美观值 +${piece.beauty}${ground ? " /格" : ""} · ${piece.upkeep} 金币/分钟`
      option.onclick = pick
      live.push(() => {
        const lock = lockText(piece)
        const short = cost.refresh()
        option.disabled = lock !== null
        option.classList.toggle("short", lock === null && short)
        option.classList.toggle("on", (ground ? ui.tool === "ground" && ui.ground === id : ui.tool === "prop" && ui.prop === id))
        blurb.textContent = lock ?? piece.blurb
      })
      parks.append(option)
    }
    panel.append(parks)
  }

  const row = (box: HTMLElement, label: string, glyph?: IconName | GoodId) => {
    const line = el("div", "row")
    const value = el("span", "count")
    const name = el("span", "label")
    if (glyph) name.innerHTML = icon(glyph, 16)
    name.append(document.createTextNode(label))
    line.append(name, value)
    box.append(line)
    return value
  }
  /** Sets a number with its sign, coloured by it. */
  const money = (node: HTMLElement, n: number, suffix = "") => {
    node.textContent = `${signed(n)}${suffix}`
    node.classList.toggle("up", n > 0)
    node.classList.toggle("down", n < 0)
  }

  const townPanel = () => {
    const sub = el("p", "sub")
    panel.append(header("城镇", iconEl("town", 30), sub))

    // The goals that complete the town, and how near each one is.
    const goals = section("目标", "goal", "同时达成所有目标并维持两分钟，即可完成城镇建设。")
    const goalRows: Array<{ line: HTMLElement; mark: HTMLElement; text: HTMLElement; value: HTMLElement }> = []
    const goalNote = el("p", "empty")
    panel.append(goals)

    const mood = section(
      "支持度",
      "approval",
      `支持度越高，住宅容纳的居民越多。支持度持续两分钟低于或等于−50，居民就会赶走市长。`
    )
    const moodLine = el("div", "row")
    const moodValue = el("span", "count total")
    moodLine.append(el("span", "label", "当前 → 目标"), moodValue)
    const moodTrack = el("div", "meter")
    const moodFill = el("span", "fill")
    moodTrack.append(moodFill)
    const moodParts = el("div", "")
    mood.append(moodLine, moodTrack, moodParts)
    panel.append(mood)

    const treasury = section(
      "财政",
      "treasury",
      "单位为金币/分钟。只有获得食物的住宅才纳税，税额与需求满足程度成正比。行政开支会随城镇扩张加速增长。连续负债三分钟将导致破产。"
    )
    const taxes = row(treasury, "税收", "taxes")
    const supplied = row(treasury, "需求全部满足时", "homes")
    supplied.classList.add("dim")
    const suppliedNote = el("p", "empty")
    treasury.append(suppliedNote)
    const traded = row(treasury, "贸易", "trade")
    const upkeep = row(treasury, "维护费", "upkeep")
    const admin = row(treasury, "行政开支", "town")
    const net = row(treasury, "每分钟", "coins")
    net.classList.add("total")
    const coinLine = el("div", "spark")
    treasury.append(coinLine)
    panel.append(treasury)

    const levers = section(
      "税率",
      "taxes",
      `降低税率提高支持度，加税降低支持度，影响按各阶层人数加权。税率超过 ${moodRules.grudge.above}% 会积累怨恨，降税后仍缓慢消退；临近任期结束才降税无法抵消长期压榨。`
    )
    for (const tier of ["settlers", "citizens"] as const) {
      const line = el("div", "row lever")
      const minus = el("button", "frame step", "−")
      const value = el("span", "rate")
      const plus = el("button", "frame step", "+")
      const controls = el("span", "controls")
      controls.append(minus, value, plus)
      const name = el("span", "label")
      name.innerHTML = icon(tier, 16)
      name.append(document.createTextNode(tier === "settlers" ? "移民" : "市民"))
      line.append(name, controls)
      const effect = el("p", "effect")
      levers.append(line, effect)
      const move = (by: number) => {
        const now = ui.stats?.policy[tier] ?? 100
        const i = TAX_STEPS.indexOf(now as (typeof TAX_STEPS)[number])
        const next = TAX_STEPS[Math.min(TAX_STEPS.length - 1, Math.max(0, (i < 0 ? 2 : i) + by))]!
        ui.edits.push({ type: "tax", tier, rate: next })
      }
      minus.onclick = () => move(-1)
      plus.onclick = () => move(1)
      live.push(() => {
        const rate = ui.stats?.policy[tier] ?? 100
        value.textContent = `${rate}%`
        const sway = Math.round((100 - rate) * moodRules.perTaxPoint)
        const grudge = rate > moodRules.grudge.above ? " · 持续高税率会积累怨恨，且消退缓慢" : ""
        effect.textContent = (sway === 0 ? "标准税率" : `支持度 ${signed(sway)}`) + grudge
        effect.className = `effect ${sway > 0 ? "up" : sway < 0 ? "down" : ""}`
      })
    }
    panel.append(levers)

    const town = section("人口", "people")
    const settlers = row(town, "移民", "settlers")
    const citizens = row(town, "市民", "citizens")
    const burghers = row(town, "其中富裕市民", "burghers")
    const homes = row(town, "住宅", "homes")
    const work = row(town, "已就业", "jobs")
    const workNote = el("p", "empty")
    town.append(workNote)
    const peopleLine = el("div", "spark")
    town.append(peopleLine)
    panel.append(town)

    const needs = section(
      "需求满足情况",
      "homes",
      "挨饿的住宅不纳税。移民需要市场供应食物（鲜鱼、熏鱼或面包），小屋获得面包供应后，税收增加50%；市民和富裕市民需要面包、布料及信仰。布料只配送至宜居度达到5的街区。鲜鱼和面包会逐渐腐坏，鲜鱼更快；粮仓可将腐坏速度降至五分之一。"
    )
    const needIcons: Readonly<Record<"food" | "bread" | "cloth" | "faith", IconName>> = {
      food: "fish",
      bread: "bread",
      cloth: "cloth",
      faith: "faith"
    }
    const bars = (["food", "bread", "cloth", "faith"] as const).map((n) => {
      const line = el("div", "need")
      const label = el("span", "label")
      label.innerHTML = icon(needIcons[n], 16)
      label.append(document.createTextNode(needTitle[n]))
      const track = el("span", "track")
      const fill = el("span", "fill")
      track.append(fill)
      const value = el("span", "count")
      line.append(label, track, value)
      needs.append(line)
      return { n, fill, value }
    })
    const larderLine = row(needs, "食物库存", "flour")
    const eatenLine = row(needs, "上分钟食用 · 腐坏", "fish")
    const troubleLine = row(needs, "患病住户 · 着火建筑", "health")
    panel.append(needs)

    const crown = section(
      "王室",
      "crown",
      `交付王室要求的物资可获得金币。逾期会受罚，并暂时降低支持度；连续多次未交付，王室将撤换市长。`
    )
    const crownLine = row(crown, "已交付 · 未交付", "goal")
    const crownNext = el("p", "empty")
    crown.append(crownNext)
    panel.append(crown)

    const store = section(
      "物资与贸易",
      "trade",
      "出售超过保留量的物资，或以售价的1.5倍买入物资直至保留量。卖出会压低价格，买入会抬高价格。点击“出售 / 买入 / —”切换贸易模式。"
    )
    const reserveLine = el("div", "row lever")
    const reserveControls = el("span", "controls")
    const fewer = el("button", "frame step", "−")
    const reserveValue = el("span", "rate")
    const more = el("button", "frame step", "+")
    reserveControls.append(fewer, reserveValue, more)
    reserveLine.append(el("span", "label", "保留量"), reserveControls)
    store.append(reserveLine)
    const stepReserve = (by: number) => {
      const now = ui.stats?.policy.reserve ?? 25
      const i = RESERVES.indexOf(now as (typeof RESERVES)[number])
      ui.edits.push({ type: "reserve", amount: RESERVES[Math.min(RESERVES.length - 1, Math.max(0, (i < 0 ? 1 : i) + by))]! })
    }
    fewer.onclick = () => stepReserve(-1)
    more.onclick = () => stepReserve(1)
    const modes: ReadonlyArray<TradeMode> = ["none", "sell", "buy"]
    const goodRows = goodIds.map((g) => {
      const line = el("div", "row good-row")
      const mode = el("button", "frame mode", "")
      mode.title = "点击切换出售、买入或不交易"
      mode.onclick = () => {
        const s = ui.stats
        if (!s) return
        const now: TradeMode = s.policy.sells.includes(g) ? "sell" : s.policy.buys.includes(g) ? "buy" : "none"
        ui.edits.push({ type: "trade", good: g, mode: modes[(modes.indexOf(now) + 1) % modes.length]! })
      }
      const name = el("span", "label")
      name.innerHTML = goodIcon(g, 16)
      name.append(document.createTextNode(goods[g].title))
      const price = el("span", "price")
      name.append(price)
      const value = el("span", "count")
      const right = el("span", "label")
      right.append(value, mode)
      line.append(name, right)
      store.append(line)
      return { g, value, mode, price }
    })
    panel.append(store)

    const chronicle = section("大事记", "chronicle")
    const lines = el("div", "chronicle")
    chronicle.append(lines)
    panel.append(chronicle)

    live.push(() => {
      const s = ui.stats
      if (!s) return
      sub.textContent = `${sizes[s.charter.size].title}地图，资源${lands[s.charter.land].title} · 任期 ${s.charter.term} 分钟`
      sub.title = `地图种子 ${s.charter.seed}`
      // Goals.
      while (goalRows.length < s.goals.length) {
        const line = el("div", "row goal")
        const mark = el("span", "mark", "✓")
        const text = el("span", "")
        const value = el("span", "count")
        const left = el("span", "label")
        left.append(mark, text)
        line.append(left, value)
        goals.append(line)
        goalRows.push({ line, mark, text, value })
      }
      goals.append(goalNote)
      s.goals.forEach((g, i) => {
        const r = goalRows[i]!
        r.line.classList.toggle("met", g.met)
        r.text.textContent = g.text
        r.value.textContent = g.value
      })
      goalNote.textContent = s.fate.governing
        ? "建设完成：市长将继续执政至任期结束。"
        : s.fate.complete !== null
          ? `所有目标已达成：还需维持 ${clockText(s.fate.complete)}。`
          : ""
      goalNote.style.display = goalNote.textContent ? "" : "none"
      // Approval.
      moodValue.textContent = `${signed(s.mood.approval)} → ${signed(s.mood.target)}`
      moodValue.classList.toggle("down", s.mood.approval < 0)
      moodFill.style.left = `${Math.min(50, 50 + s.mood.approval / 2)}%`
      moodFill.style.width = `${Math.abs(s.mood.approval) / 2}%`
      moodFill.classList.toggle("low", s.mood.approval < 0)
      const parts = s.mood.parts
        .map(
          (p) =>
            `<div class="row"><span class="label">${p.label}</span><span class="count ${p.value > 0 ? "up" : p.value < 0 ? "down" : ""}">${signed(p.value)}</span></div>`
        )
        .join("")
      if (moodParts.dataset.html !== parts) {
        moodParts.dataset.html = parts
        moodParts.innerHTML = parts
      }
      money(taxes, s.taxes)
      supplied.textContent = `+${s.suppliedTaxes}`
      const gap = s.suppliedTaxes - s.taxes
      suppliedNote.textContent = gap > Math.max(10, s.taxes * 0.1) ? `每分钟少收 ${gap} 金币：挨饿的住宅不纳税，供应面包的小屋多缴50%，优质街区最多多缴25%` : ""
      suppliedNote.style.display = suppliedNote.textContent ? "" : "none"
      money(traded, s.trade)
      money(upkeep, -s.upkeep)
      money(admin, -s.admin)
      money(net, s.net, " 金币")
      settlers.textContent = String(s.settlers)
      citizens.textContent = String(s.citizens)
      burghers.textContent = String(s.burghers)
      homes.textContent = String(s.homes)
      work.textContent = `${s.employed} / ${s.jobs}`
      workNote.textContent = s.shortStaffed.length === 0
        ? "所有工作场所人手充足"
        : `${s.shortStaffed.length} 处缺少工人：${s.shortStaffed.slice(0, 4).map((w) => `${w.title} ${w.assigned}/${w.needed}${w.nobodyNear ? "（范围内无人）" : ""}`).join("、")}${s.shortStaffed.length > 4 ? "、…" : ""} · 点击就业人数逐一定位`
      for (const b of bars) {
        const share = s.homes > 0 ? s.needs[b.n] / s.homes : 0
        b.fill.style.width = `${Math.round(share * 100)}%`
        b.fill.className = `fill ${share < 0.34 ? "none" : share < 0.67 ? "low" : ""}`
        b.value.textContent = `${s.needs[b.n]}/${s.homes}`
      }
      larderLine.textContent = `${s.larder}`
      eatenLine.textContent = `${s.eaten} · ${s.rotted}`
      troubleLine.textContent = `${s.sick} · ${s.burning}`
      crownLine.textContent = `${s.crown.met} · ${s.crown.missed}`
      crownNext.innerHTML = s.crown.open
        ? `需要 <b>${s.crown.amount} ${goods[s.crown.good].title}</b> · 剩余 ${clockText(s.crown.left)} · +${s.crown.reward} 金币`
        : `下次要求还有 ${clockText(s.crown.next)} · 连续 ${s.crown.patience} 次未交付将结束任期`
      // Goods' change over the last minute of samples.
      const ago = history[Math.max(0, history.length - 1 - Math.round(60 / SAMPLE_SECONDS))]
      reserveValue.textContent = String(s.policy.reserve)
      for (const r of goodRows) {
        const change = ago ? s.stock[r.g] - ago.stock[r.g] : 0
        r.value.innerHTML = `${s.stock[r.g]}${change !== 0 ? ` <small class="${change > 0 ? "up" : "down"}">${change > 0 ? "+" : ""}${change}/分钟</small>` : ""}`
        const now: TradeMode = s.policy.sells.includes(r.g) ? "sell" : s.policy.buys.includes(r.g) ? "buy" : "none"
        r.mode.textContent = now === "none" ? "—" : now === "sell" ? "出售" : "买入"
        r.mode.className = `frame mode ${now === "none" ? "" : now}`
        const price = now === "buy" ? askOf(r.g, s.prices[r.g]) : Math.round(priceOf(r.g, s.prices[r.g]) * 10) / 10
        r.price.textContent = `${price}金币${s.prices[r.g] !== 100 ? ` (${s.prices[r.g]}%)` : ""}`
      }
      const samples = s.history
      const coinsSvg = sparkline(samples.map((h) => h.coins))
      if (coinLine.dataset.svg !== coinsSvg) {
        coinLine.dataset.svg = coinsSvg
        coinLine.innerHTML = coinsSvg
      }
      const peopleSvg = sparkline(samples.map((h) => h.residents))
      if (peopleLine.dataset.svg !== peopleSvg) {
        peopleLine.dataset.svg = peopleSvg
        peopleLine.innerHTML = peopleSvg
      }
      const recent = s.chronicle
        .slice(-10)
        .reverse()
        .map((l) => `<p><b>${clockText(Math.round(l.tick / 60))}</b> ${l.text}</p>`)
        .join("")
      if (lines.dataset.html !== recent) {
        lines.dataset.html = recent
        lines.innerHTML = recent
      }
    })
  }

  /** A line of a description as a row: its icon and what it is about, its value, any goods as chips, and a note underneath saying why. */
  const renderLine = (row: HTMLElement, l: Line) => {
    row.className = `line ${l.tone ?? ""}`
    const chips = l.goods ? `<span class="chips">${l.goods.map((g) => `<span class="chip" title="${goods[g.good].title}">${goodIcon(g.good, 14)}${g.count}</span>`).join("")}</span>` : ""
    row.innerHTML = `<span class="label">${icon(l.icon, 16)}<span class="what"></span></span><span class="count"></span>${chips}${l.note ? `<small class="note"></small>` : ""}`
    row.querySelector<HTMLElement>(".what")!.textContent = l.label
    row.querySelector<HTMLElement>(".count")!.textContent = l.value ?? ""
    if (l.note) row.querySelector<HTMLElement>(".note")!.textContent = l.note
  }
  /** Keeps a box of rows in step with its lines, touching only the rows that changed. */
  const syncLines = (box: HTMLElement, rows: Array<HTMLElement>, lines: ReadonlyArray<Line>) => {
    while (rows.length < lines.length) {
      const line = el("div", "line")
      rows.push(line)
      box.append(line)
    }
    rows.forEach((row, i) => {
      const l = lines[i]
      const text = l ? JSON.stringify(l) : ""
      if (row.dataset.text === text) return
      row.dataset.text = text
      row.style.display = l ? "" : "none"
      if (l) renderLine(row, l)
    })
  }

  const buildPanel = () => {
    const p = ui.panel
    live = []
    panel.replaceChildren()
    if (!p) return
    if (p.type === "build") return buildMenu()
    if (p.type === "town") return townPanel()

    const title = p.type === "building" ? kinds[p.kind].title.toLowerCase() : p.type === "house" ? tierHome[p.tier] : p.type === "park" ? "公园" : "废墟"
    const status = el("span", "pill")
    const about = el(
      "p",
      "sub",
      p.type === "building"
        ? kinds[p.kind].blurb
        : p.type === "ruin"
          ? "拆除废墟以清理地块"
          : p.type === "park"
            ? "所有相连地块组成这座公园；扩建地面或摆放设施，提高附近街区的宜居度"
          : p.tier === 1
            ? "移民：需要市场供应鲜鱼或面包；负责基础劳动"
            : p.tier === 2
              ? "市民：需要面包、布料、信仰，以及宜居度达到5的街区；负责技术工作"
              : "富裕市民：居住在宜居度达到15、所有服务均覆盖的优质街区"
    )
    const below = el("div", "")
    below.append(status, about)
    panel.append(header(title, p.type === "ruin" ? iconEl("condition", 30) : p.type === "park" ? iconEl("decor", 30) : picture(p.type === "building" ? p.kind : p.tier), below))
    const box = section(p.type === "building" ? "运行情况" : p.type === "ruin" ? "残留情况" : p.type === "park" ? "公园构成" : "住户", p.type === "building" ? "jobs" : p.type === "park" ? "appeal" : "homes")
    box.classList.add("lines")
    const rows: Array<HTMLElement> = []
    panel.append(box)
    // A home: what keeps it from the next tier, in its own box, so the cause is never a word in a longer line.
    const nextBox = p.type === "house" && p.tier < 3 ? section(`升级为${tierHome[(p.tier + 1) as Tier]}`, "citizens", "满足以下全部条件后住宅才能升级。需求由服务人员满足，宜居度由周围环境决定。") : null
    const nextRows: Array<HTMLElement> = []
    const nextNote = el("p", "empty")
    if (nextBox) {
      nextBox.classList.add("lines")
      nextBox.append(nextNote)
      panel.append(nextBox)
    }
    live.push(() => {
      const now = ui.panel
      if (!now || now.type === "build" || now.type === "town" || now.type !== p.type) return
      if (now.type === "building") {
        status.textContent = now.problem ?? { working: "工作中", idle: "空闲", blocked: "库存已满", unconnected: "未连接道路", unstaffed: "缺少工人", starved: "缺少原料", building: "施工中", paused: "已暂停" }[now.status]
        status.className = `pill ${now.problem !== null ? "problem" : now.status === "working" ? "working" : ""}`
      } else if (now.type === "house") {
        status.textContent = `最多 ${home.tiers[now.tier].residents} 人`
        status.className = "pill working"
      } else if (now.type === "park") {
        status.textContent = `${now.value > 0 ? "+" : ""}${now.value}，影响 ${now.reach} 格`
        status.className = "pill working"
      } else {
        status.textContent = { burnt: "烧毁", collapsed: "坍塌", derelict: "荒废" }[now.cause]
        status.className = "pill problem"
      }
      syncLines(box, rows, now.lines)
      if (nextBox && now.type === "house") {
        syncLines(nextBox, nextRows, now.blockers)
        nextNote.textContent = now.blockers.length === 0 ? "升级条件已满足：下一位居民入住时升级" : ""
        nextNote.style.display = now.blockers.length === 0 ? "" : "none"
        nextBox.append(nextNote)
      }
    })
    if (!(p.type === "building" && p.kind === "townhall")) {
      const actions = el("div", "actions")
      if (p.type === "building") {
        const pause = el("button", "frame", "暂停工作")
        pause.title = "暂停的建筑不雇佣工人，维护费降至四分之一"
        pause.onclick = () => {
          const now = ui.panel
          if (now?.type === "building") ui.edits.push({ type: "pause", cell: now.cell, on: !now.paused })
        }
        live.push(() => {
          const now = ui.panel
          if (now?.type !== "building") return
          pause.textContent = now.paused ? "恢复工作" : "暂停工作"
          pause.style.display = now.pausable ? "" : "none"
        })
        actions.append(pause)
      }
      const remove = el("button", "frame danger", "拆除")
      remove.onclick = () => ui.edits.push({ type: "remove", cell: p.cell })
      actions.append(remove)
      panel.append(actions)
    }
  }

  /** Rebuilds the panel when what it shows changes, and refreshes its numbers every frame. */
  const syncPanel = () => {
    const p = ui.panel
    const next =
      p === null ? "" : p.type === "build" || p.type === "town" ? p.type : `${p.type}|${p.id}|${p.type === "house" ? p.tier : ""}`
    if (next !== shape) {
      shape = next
      // Keep the old contents while the closed panel slides away.
      if (p !== null) buildPanel()
      panel.classList.toggle("open", p !== null)
      document.body.classList.toggle("panel-open", p !== null)
      refreshTools()
    }
    for (const update of live) update()
  }

  // ── Founding a town ──
  const choice: { -readonly [K in keyof CharterValue]: CharterValue[K] } = defaultCharter((Date.now() & 0x7fffffff) >>> 0)
  /** The land a charter would found, drawn small: a dot a cell. */
  const drawLand = (canvas: HTMLCanvasElement) => {
    const land = generate(choice)
    const water = new Set(land.water.map((c) => c.y * GRID + c.x))
    const trees = new Set(land.trees.map((t) => t.cell.y * GRID + t.cell.x))
    const rocks = new Map(land.rocks.map((r) => [r.cell.y * GRID + r.cell.x, r.ore]))
    const scale = 3
    canvas.width = GRID * scale
    canvas.height = GRID * scale
    const g = canvas.getContext("2d")!
    g.clearRect(0, 0, canvas.width, canvas.height)
    for (let y = 0; y < GRID; y++) {
      for (let x = 0; x < GRID; x++) {
        const k = y * GRID + x
        if (land.mask[k] !== "1") continue
        g.fillStyle = water.has(k)
          ? "#b9cfcb"
          : trees.has(k)
            ? "#9bb08a"
            : rocks.has(k)
              ? rocks.get(k)
                ? "#5a6479"
                : "#8f9891"
              : "#f7f8f4"
        g.fillRect(x * scale, y * scale, scale, scale)
      }
    }
    return land
  }
  const openCharter = (cancellable: boolean) => {
    ui.founding = true
    dialog.replaceChildren()
    const card = el("div", "sheet")
    card.append(
      el("h2", "", "建立城镇"),
      el(
        "p",
        "sub",
        "选择地图与任期长度。发展城镇，完成所有目标，或坚持到任期结束，避免破产、叛乱与衰败。"
      )
    )
    const body = el("div", "charter")
    const options = el("div", "")
    const preview = el("div", "preview")
    const map = document.createElement("canvas")
    const facts = el("p", "sub")
    preview.append(map, facts)
    body.append(options, preview)
    const group = <T extends string | number>(
      title: string,
      values: ReadonlyArray<T>,
      label: (v: T) => string,
      blurb: (v: T) => string,
      get: () => T,
      set: (v: T) => void
    ) => {
      const box = section(title)
      const row = el("div", "choices")
      const note = el("p", "empty")
      const buttons = values.map((v) => {
        const b = el("button", "frame choice", label(v))
        b.onclick = () => {
          set(v)
          refresh()
        }
        row.append(b)
        return { v, b }
      })
      box.append(row, note)
      options.append(box)
      return () => {
        for (const { v, b } of buttons) b.classList.toggle("on", v === get())
        note.textContent = blurb(get())
      }
    }
    const refreshers = [
      group(
        "地图大小",
        sizeIds,
        (v) => sizes[v].title,
        (v) => `达到 ${sizes[v].goal.residents} 位居民和 ${sizes[v].goal.coins} 金币，完成城镇建设`,
        () => choice.size,
        (v) => (choice.size = v)
      ),
      group(
        "任期",
        TERMS,
        (v) => `${v} 分钟`,
        (v) => `正常速度下任期为 ${v} 分钟，共六年；从第二年起，每年末进入冬季`,
        () => choice.term,
        (v) => (choice.term = v)
      ),
      group(
        "资源丰度",
        landIds,
        (v) => lands[v].title,
        (v) => lands[v].blurb,
        () => choice.land,
        (v) => (choice.land = v)
      )
    ]
    const seedLine = el("div", "row")
    const seedText = el("span", "")
    const reroll = el("button", "frame", "换一张地图")
    reroll.onclick = () => {
      choice.seed = (Math.random() * 0x7fffffff) >>> 0
      refresh()
    }
    seedLine.append(seedText, reroll)
    preview.append(seedLine)
    const refresh = () => {
      for (const r of refreshers) r()
      const land = drawLand(map)
      seedText.textContent = `地图种子 ${choice.seed}`
      facts.textContent = `陆地 ${land.cells} 格 · 树木 ${land.trees.length} 棵 · 岩石 ${land.rocks.filter((r) => !r.ore).length} 处 · 矿床 ${land.rocks.filter((r) => r.ore).length} 处 · 初始资金 ${lands[choice.land].coins} 金币`
    }
    refresh()
    const actions = el("div", "actions")
    const found = el("button", "frame primary", "建立城镇")
    found.onclick = () => {
      ui.edits.push({ type: "newTown", charter: { ...choice } })
      history.length = 0
      ui.selected = null
      ui.menu = null
      closeCharter()
      showReckoning(false)
      choose("select")
      setSpeed(1)
    }
    actions.append(found)
    if (cancellable) {
      const cancel = el("button", "frame", "取消")
      cancel.onclick = () => closeCharter()
      actions.append(cancel)
    }
    card.append(body, actions)
    dialog.append(card)
    dialog.classList.add("open")
  }
  const closeCharter = () => {
    ui.founding = false
    dialog.classList.remove("open")
  }
  openCharter(false)

  // ── The end of the term ──
  /** Lines of residents, coins, and approval over the term, on the term's own time axis. */
  const chart = (s: Stats): string => {
    const w = 520
    const h = 150
    const end = Math.max(s.charter.term * 3600, ...s.history.map((p) => p.tick))
    const line = (values: ReadonlyArray<number>, lo: number, hi: number, color: string, dash = "") => {
      if (values.length < 2) return ""
      const span = hi - lo || 1
      const points = s.history
        .map((p, i) => `${((p.tick / end) * w).toFixed(1)},${(h - 4 - ((values[i]! - lo) / span) * (h - 8)).toFixed(1)}`)
        .join(" ")
      return `<polyline points="${points}" fill="none" stroke="${color}" stroke-width="1.5" stroke-dasharray="${dash}" vector-effect="non-scaling-stroke"/>`
    }
    const residents = s.history.map((p) => p.residents)
    const coinsLine = s.history.map((p) => p.coins)
    const approvalLine = s.history.map((p) => p.approval)
    const top = Math.max(1, ...residents, sizes[s.charter.size].goal.residents)
    const goal = h - 4 - (sizes[s.charter.size].goal.residents / top) * (h - 8)
    const winters = Array.from({ length: 5 }, (_, i) => {
      const y = i + 1
      const from = ((y + 0.7) / 6) * w
      return `<rect x="${from.toFixed(1)}" y="0" width="${((w * 0.3) / 6).toFixed(1)}" height="${h}" fill="#3d6db5" opacity="0.06"/>`
    }).join("")
    return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">${winters}<line x1="0" x2="${w}" y1="${goal}" y2="${goal}" stroke="#77817a" stroke-dasharray="3 3" vector-effect="non-scaling-stroke"/>${line(coinsLine, Math.min(0, ...coinsLine), Math.max(1, ...coinsLine), "#d6ae2e")}${line(approvalLine, -100, 100, "#3d6db5", "4 3")}${line(residents, 0, top, "#3d4943")}</svg>`
  }
  /** What became of a town whose term ran out. */
  const verdictOf = (s: Stats): string => {
    if (s.fate.governing) return "建设完成"
    const residents = s.settlers + s.citizens
    if (s.fate.peak < 40) return "城镇未能站稳脚跟"
    if (residents >= sizes[s.charter.size].goal.residents * 0.75) return "欣欣向荣"
    if (residents >= s.fate.peak * 0.7) return "勉强维持"
    return "走向衰败"
  }
  let reckoned = ""
  let reckoningOpen = false
  const showReckoning = (open: boolean) => {
    reckoningOpen = open
    reckoning.classList.toggle("open", open && ui.stats !== null && ui.stats.fate.state !== "playing")
  }
  const syncReckoning = (s: Stats) => {
    const over = s.fate.state !== "playing"
    result.classList.toggle("show", over && !reckoningOpen && !ui.founding)
    if (!over) {
      reckoned = ""
      reckoning.classList.remove("open")
      return
    }
    const id = `${s.charter.seed}|${s.fate.state}|${s.fate.at}`
    result.textContent =
      s.fate.state === "won"
        ? "城镇建设完成 · 查看结算"
        : s.fate.state === "lost"
          ? "任期失败 · 查看结算"
          : "任期结束 · 查看结算"
    if (id === reckoned) return
    reckoned = id
    const title =
      s.fate.state === "won"
        ? "城镇建设完成"
        : s.fate.state === "lost"
          ? s.fate.reason.split(/[:：]/)[0]!.toLowerCase()
          : `任期结束：${verdictOf(s)}`
    reckoning.replaceChildren()
    const card = el("div", "sheet wide")
    card.append(el("h2", "", title), el("p", "sub", s.fate.reason))
    const facts = el("div", "facts")
    const fact = (label: string, value: string) => {
      const f = el("div", "fact")
      f.append(el("b", "", value), el("span", "", label))
      facts.append(f)
    }
    fact("执政分钟数", `${Math.round(s.fate.at)}`)
    fact("居民", `${s.settlers + s.citizens}`)
    fact("市民", `${s.citizens}`)
    fact("金币", `${s.coins}`)
    fact("支持度", signed(s.mood.approval))
    fact("王室交付 · 逾期", `${s.crown.met} · ${s.crown.missed}`)
    fact("得分", `${s.fate.score}`)
    card.append(facts)
    const graph = el("div", "chart")
    graph.innerHTML = chart(s)
    card.append(graph, el("p", "legend", "— 居民（虚线为目标） · 金币 · - - 支持度 · 阴影为冬季"))
    const story = el("div", "chronicle")
    story.innerHTML = s.chronicle.map((l) => `<p><b>${clockText(Math.round(l.tick / 60))}</b> ${l.text}</p>`).join("")
    card.append(story)
    const actions = el("div", "actions")
    if (s.fate.state === "won") {
      const govern = el("button", "frame primary", "继续执政")
      govern.title = "城镇建设已完成，继续执政至任期结束"
      govern.onclick = () => {
        ui.edits.push({ type: "govern" })
        showReckoning(false)
      }
      actions.append(govern)
    }
    const again = el("button", "frame" + (s.fate.state === "won" ? "" : " primary"), "建立新城镇")
    again.onclick = () => {
      showReckoning(false)
      openCharter(true)
    }
    const look = el("button", "frame", "查看城镇")
    look.onclick = () => showReckoning(false)
    actions.append(again, look)
    card.append(actions)
    reckoning.append(card)
    showReckoning(true)
  }

  const input = new MapInput(stage, ui)
  const resetPage = () => {
    choose("select")
    ui.menu = null
    ui.selected = null
    input.reset()
  }

  /** The last chronicle line announced. */
  let lastNews = ""
  /** Copies the town's numbers and preview into the page, once a frame. */
  const syncPage = () => {
    syncPanel()
    const s = ui.stats
    if (s) {
      coins.innerHTML = `${icon("coins", 20)}<span class="stack"><b>${s.coins}</b><small class="${s.net >= 0 ? "up" : "down"}">${s.net >= 0 ? "+" : ""}${s.net}/分钟</small></span>`
      coins.title = "当前财政资金，以及每分钟的盈亏"
      coins.classList.toggle("debt", s.coins < 0)
      const left = Math.max(0, s.charter.term * 60 - Math.floor(s.minute * 60))
      const severity = (w: typeof s.season.coming) => (w === null ? "" : ` (${winters[w].title})`)
      const until = s.season.winter
        ? `${winters[s.season.severity ?? "normal"].title} · 距离春季 ${clockText(s.season.left)}`
        : s.season.coming === null
          ? "本任期不再有冬季"
          : `距离冬季 ${clockText(s.season.left)}${severity(s.season.coming)}`
      clock.innerHTML = `${icon(s.season.winter ? "winter" : "clock", 20)}<span class="stack"><b>${clockText(left)}</b><small class="${s.season.winter ? "winter" : s.season.coming === "hard" ? "down" : ""}">第 ${s.season.year} 年 · ${until}</small></span>`
      clock.title = `${s.season.winter ? "冬季：农田停产，捕鱼减少，食物消耗加快" : "任期剩余时间"}\n年历：下个冬季为${s.season.coming === null ? "任期之外" : winters[s.season.coming].title}，再下个为${s.season.after === null ? "任期之外" : winters[s.season.after].title}。\n暖冬：捕鱼量 ${Math.round(winters.mild.fishing * 100)}%。普通冬季：${Math.round(winters.normal.fishing * 100)}%。严冬：时长增加50%，捕鱼量 ${Math.round(winters.hard.fishing * 100)}%，住宅取暖增加火灾风险。`
      const trend = s.mood.target > s.mood.approval ? "↑" : s.mood.target < s.mood.approval ? "↓" : ""
      approval.innerHTML = `${icon("approval", 18)}<span class="stack"><b class="${s.mood.approval < 0 ? "down" : ""}">${signed(s.mood.approval)} <span class="${s.mood.target >= s.mood.approval ? "up" : "down"}">${trend}</span></b><small>支持度</small></span>`
      settlerCell.innerHTML = `${icon("settlers", 18)}<span class="stack"><b>${s.settlers}</b><small>移民</small></span>`
      citizenCell.innerHTML = `${icon("citizens", 18)}<span class="stack"><b>${s.citizens}</b><small>市民${s.burghers > 0 ? ` · ${s.burghers} 富裕市民` : ""}</small></span>`
      const short = s.shortStaffed.length
      jobs.innerHTML = `${icon("jobs", 18)}<span class="stack"><b>${s.employed}<span class="of">/${s.jobs}</span></b><small class="${short > 0 ? "down" : ""}">${short > 0 ? `${short} 处缺人 · 点击定位` : "已就业"}</small></span>`
      jobs.title = short > 0
        ? `已就业人数 / 所需人数。${short} 处工作场所缺人：${s.shortStaffed.slice(0, 5).map((w) => `${w.title} ${w.assigned}/${w.needed}${w.nobodyNear ? "（15格道路内无住宅）" : ""}`).join("、")}。点击逐一定位。`
        : "已就业人数 / 所需人数：所有工作场所人手充足。居民最多步行15格道路上班。"
      for (const [g, count] of goodCells) {
        count.textContent = String(s.stock[g])
        count.parentElement!.classList.toggle("empty", s.stock[g] === 0)
      }
      // The crown's request.
      request.classList.toggle("show", s.crown.open && s.fate.state === "playing")
      if (s.crown.open) {
        const have = s.stock[s.crown.good]
        requestText.innerHTML = `${icon("crown", 18)}<span>王室要求 <b>${s.crown.amount}</b> ${goodIcon(s.crown.good, 14)} <b>${goods[s.crown.good].title}</b> <span class="muted">（库存 ${have}）</span> · <b>${clockText(s.crown.left)}</b> · +${s.crown.reward} 金币</span>`
        send.disabled = have < s.crown.amount
      }
      // What threatens the term, or is about to complete it.
      const warnings: Array<string> = []
      if (s.fate.state === "playing") {
        if (s.fate.bankrupt !== null)
          warnings.push(`<b>负债：</b>若财政未改善，将在 ${clockText(s.fate.bankrupt)} 后破产`)
        else if (s.coins < 0) warnings.push("<b>负债：</b>工资无法支付")
        if (s.fate.revolt !== null) warnings.push(`<b>骚乱：</b>居民将在 ${clockText(s.fate.revolt)} 后驱逐市长`)
        else if (s.mood.approval < -30) warnings.push("<b>不满：</b>支持度偏低，有骚乱风险")
        if (s.fate.peak >= 40 && s.settlers + s.citizens < s.fate.peak * 0.4) warnings.push("<b>人口流失：</b>居民正在离开城镇")
        if (s.crown.streak > 0 && s.crown.streak >= s.crown.patience - 1) {
          warnings.push(`<b>王室耐心：</b>已连续 ${s.crown.streak} 次未交付；再有一次市长就会被撤换`)
        }
        if (s.fate.complete !== null) warnings.push(`<b>所有目标已达成：</b>还有 ${clockText(s.fate.complete)} 即可完成建设`)
      }
      const html = warnings
        .map((w) => `<div class="cell">${icon(w.startsWith("<b>所有目标") ? "goal" : "warning", 16)}<span>${w}</span></div>`)
        .join("")
      if (alarm.dataset.html !== html) {
        alarm.dataset.html = html
        alarm.innerHTML = html
      }
      alarm.classList.toggle("show", warnings.length > 0)
      alarm.classList.toggle("good", warnings.length === 1 && s.fate.complete !== null)
      // The ticker: what needs looking at now, then the news of the last minute and a half; click a line to go there.
      const minute = Math.round(s.minute * 3600)
      const news = s.chronicle.filter((l) => l.alarm && minute - l.tick < 90 * 60).slice(-3).reverse()
      const ago = (tick: number) => {
        const sec = Math.max(0, Math.round((minute - tick) / 60))
        return sec < 5 ? "刚刚" : sec < 60 ? `${sec} 秒前` : `${Math.round(sec / 60)} 分钟前`
      }
      const tickerHtml = [
        ...(s.alerts.length > 0 ? [`<div class="head">当前提醒</div>`] : []),
        ...s.alerts.map((a, i) => `<button class="cell${a.at ? " place" : ""}" data-alert="${i}" title="${a.at ? "点击定位" : ""}">${icon("warning", 14)}<span>${a.text}</span>${a.at ? `<kbd>定位</kbd>` : ""}</button>`),
        ...(news.length > 0 ? [`<div class="head">最近动态</div>`] : []),
        ...news.map((l, i) => `<button class="cell news${l.at ? " place" : ""}" data-news="${i}" title="${l.at ? "点击定位" : ""}">${icon("chronicle", 14)}<span>${l.text} <em>${ago(l.tick)}</em></span>${l.at ? `<kbd>定位</kbd>` : ""}</button>`)
      ].join("")
      if (ticker.dataset.html !== tickerHtml) {
        ticker.dataset.html = tickerHtml
        ticker.innerHTML = tickerHtml
        for (const b of ticker.querySelectorAll<HTMLButtonElement>("button.place")) {
          b.onclick = (event) => {
            event.stopPropagation()
            const alertIndex = b.dataset.alert
            const target = alertIndex !== undefined ? s.alerts[Number(alertIndex)] : null
            if (target?.at) return goTo(target.at, target.size, target.id)
            const line = news[Number(b.dataset.news)]
            if (line?.at) goTo(line.at, 1, null)
          }
        }
      }
      ticker.classList.toggle("show", tickerHtml !== "" && s.fate.state === "playing")
      // News as it happens: a toast for each new alarm line.
      const latest = s.chronicle.at(-1)
      const seen = `${s.charter.seed}|${latest?.tick ?? -1}|${s.chronicle.length}`
      if (seen !== lastNews) {
        if (lastNews !== "" && latest?.alarm && minute - latest.tick < 120) ui.toast(latest.text)
        lastNews = seen
      }
      // The map view's legend.
      const l = ui.legend
      const legendHtml = l
        ? `<b>${l.title}</b>${l.keys.map((k) => `<span class="key"><i style="background:${hex(k.color)}"></i>${k.label}</span>`).join("")}<small>${l.note}</small>`
        : ""
      if (legend.dataset.html !== legendHtml) {
        legend.dataset.html = legendHtml
        legend.innerHTML = legendHtml
      }
      legend.classList.toggle("show", l !== null)
      syncReckoning(s)
    }
    input.sync()
    const screenPointer = input.pointer
    const text = ui.preview.tooltip
    if (text && screenPointer) {
      tooltip.textContent = text
      tooltip.style.display = "block"
      tooltip.style.left = `${Math.min(screenPointer.x, window.innerWidth - tooltip.offsetWidth - 20)}px`
      tooltip.style.top = `${screenPointer.y}px`
    } else tooltip.style.display = "none"
  }

  return { app, stage, ui, syncPage, resetPage, input }
}
