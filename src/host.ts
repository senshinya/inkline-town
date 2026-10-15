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
  LEDGER_TICKS,
  RESERVE_MAX,
  STEP_SECONDS,
  TRADE_LOAD,
  ROAD_COST,
  sizeIds,
  sizes,
  TAX_STEPS,
  TERMS,
  YEARS_PER_TERM,
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
import { GameScene, type CameraView } from "./render3d/scene.ts"
import { blobOf, cardFacts, drawCard, metaOf, scaled, verdictOf } from "./share/card.ts"
import { handheld, offerLink, offerPicture, upload } from "./share/client.ts"
import { PICTURE_HEIGHT, PICTURE_QUALITY, PICTURE_WIDTH } from "./share/format.ts"
import { MapInput } from "./render3d/input.ts"

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = "") => {
  const node = document.createElement(tag)
  node.className = className
  node.textContent = text
  return node
}
/**
 * Sets a node's markup only when it changed. Rewriting it every frame would
 * replace the element under the pointer between press and release, and the
 * browser then drops the click.
 */
const setHtml = (node: HTMLElement, html: string) => {
  if (node.dataset.html === html) return
  node.dataset.html = html
  node.innerHTML = html
}
const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

/** Words in the town's messages that name a building or a good, longest first, so "smoked fish" wins over "fish". */
const namedThings: ReadonlyArray<{ readonly word: string; readonly ref: { readonly kind: KindId } | { readonly good: GoodId } }> = [
  ...kindOrder.flatMap((id) => {
    const title = kinds[id].title.toLowerCase()
    return [{ word: title, ref: { kind: id } }]
  }),
  ...goodIds.map((id) => ({ word: goods[id].title, ref: { good: id } }))
].sort((a, b) => b.word.length - a.word.length)
const namedPattern = new RegExp(`(${namedThings.map((t) => t.word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})|[（(]([A-Z])[）)]`, "gi")

/**
 * A message as markup: each building it names becomes a chip to click (to
 * build one), each good a chip with its icon, and each key in brackets a key.
 */
/** `standing`: buildings the line is about, which stand already; their chips go to them rather than placing another. */
const callouts = (text: string, standing: ReadonlySet<KindId> = new Set()): string =>
  escapeHtml(text).replace(namedPattern, (match, word: string | undefined, key: string | undefined) => {
    if (key) return `<kbd class="key">${key}</kbd>`
    const thing = namedThings.find((t) => t.word === word!.toLowerCase())
    if (!thing) return match
    if ("good" in thing.ref) return `<span class="ref ware" title="${goods[thing.ref.good].title}">${goodIcon(thing.ref.good, 13)}${match}</span>`
    const kind = kinds[thing.ref.kind]
    if (standing.has(thing.ref.kind)) return `<button class="ref kind go" data-go="${thing.ref.kind}" title="定位${kind.title}">${icon("locate", 13)}${match}</button>`
    return kind.buildable
      ? `<button class="ref kind" data-kind="${thing.ref.kind}" title="建造${kind.title}：${escapeHtml(kind.blurb)}">${icon("build", 13)}${match}</button>`
      : `<span class="ref kind" title="${escapeHtml(kind.blurb)}">${icon("town", 13)}${match}</span>`
  })

const hex = (color: number) => `#${color.toString(16).padStart(6, "0")}`
/** Seconds as m:ss. */
const clockText = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`
const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n)}`

export interface Persistence {
  readonly save: () => string | null
  readonly load: () => string | null
  /** The town as a save file (as text), with where the camera stands, to share. */
  readonly shareFile: (camera: CameraView) => string
}

/**
 * `shared`: the page opened on a shared town's link, so it loads that rather than asking for a charter.
 * `saved`: the newest town saved in this browser, which the first charter offers to carry on with.
 */
export const createHost = async (
  mount: HTMLElement,
  persistence: () => Persistence,
  options: { readonly shared?: boolean; readonly saved?: { readonly title: string; readonly savedAt: number } | null } = {}
) => {
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
    ore: "仅用于制造工具：达到 10 位市民后，矿场从锈红色矿床开采矿石，铁匠铺将其锻造成工具",
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
  stock.title = "仓储物资及其变化趋势 · 点击查看生产与消耗"
  const goodCells = new Map<GoodId, HTMLElement>()
  const goodTrends = new Map<GoodId, HTMLElement>()
  for (const group of groups) {
    const cell = el("div", "group")
    for (const g of group) {
      const item = el("span", "good")
      item.title = `${goods[g].title}: ${goodHelp[g]}`
      item.setAttribute("aria-label", goods[g].title)
      const glyph = el("span", "glyph")
      glyph.innerHTML = goodIcon(g, 18)
      const count = el("span", "count", "0")
      const trend = el("span", "trend")
      item.append(glyph, count, trend)
      cell.append(item)
      goodCells.set(g, count)
      goodTrends.set(g, trend)
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
  // The top line: the clock and treasury (on a phone, the people and a chip of the building goods beside them).
  const topline = el("div", "topline")
  const goodsChip = el("button", "card goods-chip")
  goodsChip.title = "查看库存、生产与消耗"
  topline.append(bar, goodsChip)
  // Under the goods, on a click: each good's last minute, made against used, and where it is held.
  const flowCard = el("div", "card flow")
  stock.onclick = (event) => {
    event.stopPropagation()
    flowCard.classList.toggle("open")
  }
  flowCard.onclick = () => flowCard.classList.remove("open")
  hud.append(topline, stock, flowCard, request, alarm, ticker)
  const people = el("div", "hud right")
  const folk = el("div", "card bar folk")
  const approval = el("div", "cell")
  const settlerCell = el("div", "cell")
  const citizenCell = el("div", "cell")
  const jobs = el("div", "cell jobs")
  folk.append(approval, settlerCell, citizenCell, jobs)
  people.append(folk)
  folk.title = "打开城镇统计、目标和政策面板（T）"
  folk.onclick = () => toggleMenu("town")
  /** Points the page at a place: the camera goes there, it is outlined for a moment, and (when it is a thing) it is selected. */
  const goTo = (at: { readonly x: number; readonly y: number }, size: number, id: number | null) => {
    setFold(null)
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
  const shareBox = el("div", "dialog share")
  const visitBar = el("div", "card visit")
  const result = el("button", "result", "")
  result.onclick = () => showReckoning(true)
  // Map views, and the legend of the one shown.
  const views = el("div", "views")
  const legend = el("div", "card legend")
  // A phone's buttons for what stays folded away: the guide and the map views.
  const foldButtons = el("div", "fold-buttons")
  const guideBulb = el("button", "card")
  guideBulb.title = "新手引导与当前需要关注的问题"
  const guideBadge = el("span", "badge")
  guideBulb.append(iconEl("hint", 16), guideBadge)
  const layersButton = el("button", "card")
  layersButton.title = "地图图层"
  layersButton.append(iconEl("layers", 16))
  foldButtons.append(guideBulb, layersButton)
  document.body.append(hud, people, tooltip, toastBox, toolbar, system, panel, result, dialog, confirmBox, reckoning, shareBox, visitBar, views, legend, foldButtons)

  // ── Phones: the HUD folds away ──
  // On a small screen only the top line and the tool bar stay out; the goods,
  // the guide, the map views, and the system buttons each open on a tap, one
  // at a time, and a tap on the map folds them again.
  const phone = window.matchMedia("(max-width: 760px), (max-height: 500px)")
  type Fold = "goods" | "guide" | "views" | "more"
  let fold: Fold | null = null
  const setFold = (next: Fold | null) => {
    fold = next
    for (const f of ["goods", "guide", "views", "more"] as const) document.body.classList.toggle(`fold-${f}`, f === next)
    goodsChip.classList.toggle("on", next === "goods")
    guideBulb.classList.toggle("on", next === "guide")
    layersButton.classList.toggle("on", next === "views" || ui.view !== "none")
    moreButton.classList.toggle("on", next === "more")
    if (next !== null) {
      ticker.classList.remove("peek")
      // The panel and a fold would cover each other: the fold wins.
      if (ui.menu !== null || ui.selected !== null) {
        ui.menu = null
        ui.selected = null
        refreshTools()
      }
    }
  }
  const toggleFold = (f: Fold) => setFold(fold === f ? null : f)
  goodsChip.onclick = (event) => {
    event.stopPropagation()
    toggleFold("goods")
  }
  // The treasury opens the same minute the goods do.
  coins.onclick = (event) => {
    event.stopPropagation()
    if (phone.matches) toggleFold("goods")
    else flowCard.classList.toggle("open")
  }
  guideBulb.onclick = () => toggleFold("guide")
  layersButton.onclick = () => toggleFold("views")
  // A tap on the map folds them; a pan or a pinch, to look around with the goods or the guide open, does not.
  let mapPress: { id: number; x: number; y: number; moved: boolean } | null = null
  mount.addEventListener("pointerdown", (e) => {
    mapPress = mapPress === null && e.isPrimary ? { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false } : null
  })
  mount.addEventListener("pointermove", (e) => {
    if (mapPress?.id === e.pointerId && Math.hypot(e.clientX - mapPress.x, e.clientY - mapPress.y) > 8) mapPress.moved = true
  })
  mount.addEventListener("pointerup", (e) => {
    if (mapPress?.id === e.pointerId && !mapPress.moved && fold !== null) setFold(null)
    if (mapPress?.id === e.pointerId) mapPress = null
  })
  mount.addEventListener("pointercancel", () => (mapPress = null))
  // The people's card joins the top line on a phone, and goes back to the top right on a wider screen.
  const placeFolk = () => {
    if (phone.matches) topline.insertBefore(folk, goodsChip)
    else people.append(folk)
    if (!phone.matches) setFold(null)
  }

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
    guide: [],
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
  // Everything the bottom-right buttons do, folded into one menu on a phone.
  const moreButton = el("button", "more")
  moreButton.title = "更多操作：分享、引导、保存、读取、新城镇"
  moreButton.append(iconEl("more"))
  moreButton.onclick = () => toggleFold("more")
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
  const speedGroup = el("div", "group speed")
  toolbar.append(speedGroup)
  const speeds = [
    { speed: 0, label: "", key: "space" },
    { speed: 1, label: "1×", key: "1" },
    { speed: 2, label: "2×", key: "2" },
    { speed: 4, label: "4×", key: "3" }
  ].map(({ speed, label, key }) => {
    const button = el("button", speed === 0 ? "pause" : "", label)
    if (speed === 0) button.append(iconEl("pause", 14))
    button.title = speed === 0 ? "暂停或继续游戏（空格键）" : `以 ${label} 运行（${key}）`
    // Pause is a switch: pressed again it runs the town at its last speed.
    button.onclick = () => setSpeed(speed === 0 && ui.speed === 0 ? lastSpeed : speed)
    speedGroup.append(button)
    return { speed, button }
  })
  // A phone has room for one speed button: it runs a paused town, else goes on to the next speed.
  const cycle = el("button", "cycle")
  cycle.title = "切换速度：1×、2×、4×"
  cycle.onclick = () => setSpeed(ui.speed === 0 ? lastSpeed : ui.speed === 4 ? 1 : ui.speed * 2)
  speedGroup.append(cycle)
  toolbar.append(moreButton)
  let lastSpeed = 1
  const setSpeed = (speed: number) => {
    if (speed > 0) lastSpeed = speed
    ui.speed = speed
    for (const s of speeds) s.button.classList.toggle("on", s.speed === speed)
    // Paused, the pause button shows play.
    const pause = speeds[0]!.button
    pause.replaceChildren(iconEl(speed === 0 ? "play" : "pause", 14))
    pause.setAttribute("aria-label", speed === 0 ? "继续游戏" : "暂停游戏")
    cycle.textContent = `${speed === 0 ? lastSpeed : speed}×`
    cycle.title = speed === 0 ? `以 ${lastSpeed} 倍速运行` : "切换速度：1×、2×、4×"
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
  const viewsTitle = el("div", "views-title", "地图图层")
  viewsTitle.title = "按这些指标给地图着色，查看城镇各处的情况；再次按快捷键或点击即可隐藏。"
  views.append(viewsTitle)
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
    // On a phone the list folds away once one is chosen, so the map shows.
    if (fold === "views") setFold(null)
    layersButton.classList.toggle("on", view !== "none")
  }
  // Share, the guide, save, load, and new town: a row of icons in the bottom
  // right. Founding or loading replaces the town, so each asks first.
  const action = (name: IconName, label: string, tip: string, run: () => void) => {
    const button = el("button", name === "share" ? "labelled" : "")
    button.title = tip
    button.append(iconEl(name), document.createTextNode(label))
    button.onclick = run
    system.append(button)
  }
  action("share", "分享", "分享城镇图片，或生成链接，让他人查看城镇并继续游玩", () => void openShare())
  // The guide, on or off (it is on for a new mayor).
  const guideButton = el("button", "guide-toggle")
  guideButton.title = "开关新手引导：提示下一步做什么，以及原因"
  guideButton.append(iconEl("hint"), document.createTextNode("引导"))
  guideButton.onclick = () => ui.guide.push({ type: ui.stats?.guide.off ? "on" : "off" })
  system.append(guideButton)
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
  // A phone has no camera bar: this puts the camera back.
  action("view", "重置镜头", "恢复初始角度和中心", () => stage.resetCamera())
  system.lastElementChild!.classList.add("phone-only")
  // A choice from the menu folds it.
  system.addEventListener("click", () => {
    if (fold === "more") setFold(null)
  })
  placeFolk()
  phone.addEventListener("change", placeFolk)

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
    setFold(null)
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
    if (shareBox.classList.contains("open") && event.key === "Escape") closeShare()
    if (ui.founding || reckoning.classList.contains("open") || confirmBox.classList.contains("open") || shareBox.classList.contains("open") || visiting) return
    if (event.key === " ") {
      event.preventDefault()
      setSpeed(ui.speed === 0 ? lastSpeed : 0)
    }
    if (event.key === "1") setSpeed(1)
    if (event.key === "2") setSpeed(2)
    if (event.key === "3") setSpeed(4)
    if (event.key === "Escape") {
      // A stroke being drawn or held is dropped first; the tool stays.
      if (ui.dragFrom) input.cancelStroke()
      else if (ui.tool !== "select") choose("select")
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
    box.append(h3)
    if (help) {
      const info = el("button", "help")
      info.append(iconEl("info", 15))
      info.title = "查看说明"
      info.setAttribute("aria-expanded", "false")
      const text = el("p", "help-text", help)
      info.onclick = () => {
        const open = !text.classList.contains("open")
        text.classList.toggle("open", open)
        info.setAttribute("aria-expanded", String(open))
      }
      h3.append(info)
      box.append(text)
    }
    return box
  }
  /**
   * A slider for one of the town's levers. While it is held, the town's
   * numbers do not move it back; `sync` sets it otherwise.
   */
  const slider = (min: number, max: number, step: number, onInput: (value: number) => void) => {
    const input = el("input", "slider")
    input.type = "range"
    input.min = String(min)
    input.max = String(max)
    input.step = String(step)
    let held = false
    input.addEventListener("pointerdown", () => (held = true))
    input.addEventListener("pointerup", () => (held = false))
    input.addEventListener("blur", () => (held = false))
    const paint = () => input.style.setProperty("--at", `${((Number(input.value) - min) / (max - min)) * 100}%`)
    input.oninput = () => {
      paint()
      onInput(Number(input.value))
    }
    const sync = (value: number) => {
      if (held || input.value === String(value)) return
      input.value = String(value)
      paint()
    }
    paint()
    return { input, sync }
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
      `先铺地面，再摆放设施。相连地面组成一座公园，设施越丰富，周围街区的宜居度越高（市民住宅需要 ${home.tiers[2].appeal}，市民宅邸需要 ${home.tiers[3].appeal}）。每 ${parkRules.cellsPerProp} 格地面可计入一件设施。`
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
      `支持度高时，住宅容纳更多居民；低时则减少。支持度持续两分钟处于 −50 或以下，居民会赶走市长。`
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
      "以下为每分钟收支。有食物的住宅才缴税，税额随需求满足程度变化。行政开支按住宅计收，增长快于城镇规模：城镇较大时，新建一栋移民小屋的税收可能仅够支付新增行政开支；市民住宅和市民宅邸则能以相同的行政成本容纳两倍或三倍人口。连续负债三分钟将导致破产。"
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
      `降税提高支持度，加税降低支持度，影响按各阶层人口加权。税率超过 100% 还会使部分居民迁出，移民比市民更敏感，因此加税未必增收。下方列出各档税率稳定后的预计税收。超过 ${moodRules.grudge.above}% 会积累怨恨，即使降税也只会缓慢消退，任期末突击降税无法抹去长期重税的影响。`
    )
    for (const tier of ["settlers", "citizens"] as const) {
      const line = el("div", "row lever")
      const value = el("span", "rate")
      const name = el("span", "label")
      name.innerHTML = icon(tier, 16)
      name.append(document.createTextNode(tier === "settlers" ? "移民" : "市民"))
      line.append(name, value)
      const rate = slider(TAX_STEPS[0], TAX_STEPS.at(-1)!, 5, (to) => ui.edits.push({ type: "tax", tier, rate: to }))
      rate.input.classList.add("tax")
      rate.input.title = "拖动调整税率；双击恢复标准税率 100%"
      rate.input.ondblclick = () => ui.edits.push({ type: "tax", tier, rate: 100 })
      const effect = el("p", "effect")
      const outlook = el("p", "effect outlook")
      outlook.title = "各档税率稳定后的每分钟住宅税收估算：超过 100% 会使部分居民迁出，税率也会影响支持度"
      levers.append(line, rate.input, effect, outlook)
      live.push(() => {
        const now = ui.stats?.policy[tier] ?? 100
        rate.sync(now)
        value.textContent = `${now}%`
        const sway = Math.round((100 - now) * moodRules.perTaxPoint)
        const grudge = now > moodRules.grudge.above ? " · 维持高税率会积累怨恨，降税后也只会缓慢消退" : ""
        effect.textContent = (sway === 0 ? "标准税率" : `支持度 ${signed(sway)}`) + grudge
        effect.className = `effect ${sway > 0 ? "up" : sway < 0 ? "down" : ""}`
        const steps = ui.stats?.taxOutlook[tier] ?? []
        const best = steps.reduce<{ rate: number; taxes: number } | null>((b, o) => (b === null || o.taxes > b.taxes ? o : b), null)
        const text = steps.length === 0 || best === null
          ? ""
          : `稳定后税收/分钟： ${steps.map((o) => `${o.rate}% ${o.taxes}`).join(" · ")} · ${best.rate}% 时最高`
        if (outlook.textContent !== text) outlook.textContent = text
        outlook.style.display = text ? "" : "none"
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
      "挨饿的住宅不缴税。移民需要市场供应鲜鱼、熏鱼或面包；小屋获得面包后，税收另增 50%。每次送餐按每四位居民一份食物计算，不足四人也算一份；满员的市民住宅消耗为小屋的两倍，市民宅邸为三倍。市民和富裕市民需要面包、布料与信仰。布料只送往宜居度至少为 5 的街区。鲜鱼和面包会逐渐腐坏，鲜鱼腐坏更快；粮仓可将腐坏速度降至原来的五分之一。"
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
      "商人每隔几秒交易一次。将滑块向左拖动，出售超过保留量的物资；向右拖动，以标价的 1.5 倍购入至保留量。拖得越远，每次交易量越大；居中时停止交易。出售使价格下降，购买使价格上涨，上涨速度为下降的三倍；高价回落也很慢。进口适合临时补缺，长期依赖进口食物会让开销不断增加。"
    )
    const reserveLine = el("div", "row lever")
    const reserveValue = el("span", "rate")
    reserveLine.append(el("span", "label", "库存保留量"), reserveValue)
    const reserve = slider(0, RESERVE_MAX, 5, (amount) => ui.edits.push({ type: "reserve", amount }))
    reserve.input.title = "每种物资的保留量：只出售超过此数量的库存，只购买至此数量"
    store.append(reserveLine, reserve.input, el("p", "effect", "每种物资均适用：超过保留量才出售，不足时最多购入至保留量"))
    /** Collections a minute: the traders come at every ledger. */
    const perMinute = 60 / (LEDGER_TICKS * STEP_SECONDS)
    const goodRows = goodIds.map((g) => {
      const line = el("div", "trade-row")
      const name = el("span", "label")
      name.innerHTML = goodIcon(g, 16)
      name.append(document.createTextNode(goods[g].title))
      const value = el("span", "count")
      const price = el("span", "price")
      const top = el("div", "row")
      const change = el("small", "change")
      const right = el("span", "label")
      right.append(change, value, price)
      top.append(name, right)
      // Left of the middle sells, right of it buys, the middle neither; how far out is how much a collection.
      const deal = slider(-TRADE_LOAD, TRADE_LOAD, 1, (v) =>
        ui.edits.push(v === 0 ? { type: "trade", good: g, mode: "none" } : { type: "trade", good: g, mode: v < 0 ? "sell" : "buy", amount: Math.abs(v) })
      )
      deal.input.classList.add("deal")
      deal.input.title = `向左拖动出售${goods[g].title}，向右拖动购买；离中点越远，每次交易量越大。双击停止交易。`
      deal.input.ondblclick = () => ui.edits.push({ type: "trade", good: g, mode: "none" })
      const mode = el("span", "mode")
      const bottom = el("div", "deal-line")
      bottom.append(deal.input, mode)
      line.append(top, bottom)
      store.append(line)
      return { g, value, change, mode, price, deal, line }
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
      work.textContent = `${s.employed}/${s.jobs}`
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
      reserve.sync(s.policy.reserve)
      for (const r of goodRows) {
        const change = ago ? s.stock[r.g] - ago.stock[r.g] : 0
        r.change.textContent = change !== 0 ? `${change > 0 ? "+" : ""}${change}/分钟` : ""
        r.change.className = `change ${change > 0 ? "up" : "down"}`
        r.value.textContent = String(s.stock[r.g])
        const now: TradeMode = s.policy.sells.includes(r.g) ? "sell" : s.policy.buys.includes(r.g) ? "buy" : "none"
        const load = s.policy.loads[r.g]
        r.deal.sync(now === "sell" ? -load : now === "buy" ? load : 0)
        r.mode.textContent = now === "none" ? "不交易" : `${now === "sell" ? "出售" : "购买"} ≤${Math.round(load * perMinute)}/分钟`
        r.mode.className = `mode ${now}`
        r.line.className = `trade-row ${now}`
        const price = now === "buy" ? askOf(r.g, s.prices[r.g]) : Math.round(priceOf(r.g, s.prices[r.g]) * 10) / 10
        r.price.textContent = `${price}金币${s.prices[r.g] !== 100 ? ` (${s.prices[r.g]}%)` : ""}`
        r.price.title = now === "buy" ? "商人出售每件物资的价格" : "商人收购每件物资的价格"
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
        .map((l) => `<p><b>${clockText(Math.round(l.tick / 60))}</b> ${escapeHtml(l.text)}</p>`)
        .join("")
      if (lines.dataset.html !== recent) {
        lines.dataset.html = recent
        lines.innerHTML = recent
      }
    })
  }

  /** A line of a description as a row: its icon and what it is about, its value, any goods as chips, and a note underneath saying why. */
  const renderLine = (row: HTMLElement, l: Line) => {
    // A value too long to sit beside the label goes under it, aligned with it.
    row.className = `line ${l.tone ?? ""}${(l.value ?? "").length > 14 ? " long" : ""}`
    const chips = l.goods ? `<span class="chips">${l.goods.map((g) => `<span class="chip" title="${goods[g.good].title}">${goodIcon(g.good, 14)}${g.count}</span>`).join("")}</span>` : ""
    row.innerHTML = `<span class="mark">${icon(l.icon, 16)}</span><span class="what"></span><span class="count"></span>${chips}${l.note ? `<small class="note"></small>` : ""}`
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
            ? "移民：需要市场供应鲜鱼、熏鱼或面包；负责基础劳动"
            : p.tier === 2
              ? "市民：需要面包、布料、信仰，以及宜居度达到5的街区；负责技术工作"
              : `富裕市民：住宅位于宜居度达到 ${home.tiers[3].appeal} 的优质街区，并获得全部公共服务`
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
        // A closed home has nobody in it to grow.
        nextBox.style.display = now.closed ? "none" : ""
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
      if (p.type === "house") {
        const close = el("button", "frame", "关闭住宅")
        close.title = "关闭的住宅保持空置，不缴税，也不产生行政开支。重新开放后，居民会逐渐入住。"
        close.onclick = () => {
          const now = ui.panel
          if (now?.type === "house") ui.edits.push({ type: "pause", cell: now.cell, on: !now.closed })
        }
        live.push(() => {
          const now = ui.panel
          if (now?.type !== "house") return
          close.textContent = now.closed ? "重新开放住宅" : "关闭住宅"
          close.style.display = now.closable ? "" : "none"
        })
        actions.append(close)
      }
      const remove = el("button", "frame danger", "拆除")
      remove.onclick = () => ui.edits.push({ type: "remove", cell: p.cell })
      live.push(() => {
        const now = ui.panel
        remove.title = now?.type === "building" || now?.type === "house" ? now.salvage : ""
      })
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
  const savedTown = options.saved ?? null
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
    const card = el("div", "sheet wide")
    const title = el("h2", "title", "墨线小镇 ")
    const by = el("small", "by", "作者：")
    const author = el("a", "", "Sandro Maglione") as HTMLAnchorElement
    author.href = "https://www.sandromaglione.com/"
    author.target = "_blank"
    author.rel = "noopener"
    by.append(author)
    title.append(by)
    card.append(title, el("p", "sub", "选择地图，在任期结束前达成城镇发展目标。"))
    const body = el("div", "charter")
    const options = el("div", "")
    const preview = el("div", "preview")
    const mapBox = el("div", "map")
    const map = document.createElement("canvas")
    mapBox.append(map)
    const facts = el("p", "note facts")
    const cells = el("span", "ref ware cells")
    mapBox.append(cells)
    preview.append(mapBox, facts)
    body.append(options, preview)
    /** A figure of the charter as the town's messages name things: an icon and a few words. */
    const chip = (glyph: IconName, text: string) => `<span class="ref ware">${icon(glyph, 13)}${escapeHtml(text)}</span>`
    const group = <T extends string | number>(
      title: string,
      glyph: IconName,
      values: ReadonlyArray<T>,
      label: (v: T) => string,
      note: (v: T) => string,
      tip: (v: T) => string,
      get: () => T,
      set: (v: T) => void
    ) => {
      const box = section(title, glyph)
      const row = el("div", "choices")
      const said = el("p", "note")
      const buttons = values.map((v) => {
        const b = el("button", "frame choice", label(v))
        b.title = tip(v)
        b.onclick = () => {
          set(v)
          refresh()
        }
        row.append(b)
        return { v, b }
      })
      box.append(row, said)
      options.append(box)
      return () => {
        for (const { v, b } of buttons) b.classList.toggle("on", v === get())
        setHtml(said, note(get()))
      }
    }
    const refreshers = [
      group(
        "地图大小",
        "pave",
        sizeIds,
        (v) => sizes[v].title,
        (v) => `目标 ${chip("people", `${sizes[v].goal.residents} 位居民`)}${chip("coins", `${sizes[v].goal.coins} 金币`)}`,
        (v) => `完成目标： ${sizes[v].goal.residents} 位居民及 ${sizes[v].goal.coins} 金币`,
        () => choice.size,
        (v) => (choice.size = v)
      ),
      group(
        "任期",
        "clock",
        TERMS,
        (v) => `${v} 分钟`,
        (v) => `${chip("clock", `${YEARS_PER_TERM} 年，每年 ${Number((v / YEARS_PER_TERM).toFixed(1))} 分钟`)}${chip("winter", `${YEARS_PER_TERM - 1} 个冬季`)}`,
        (v) => `正常速度下 ${v} 分钟，共 ${YEARS_PER_TERM} 年；第一年之后，每年年末迎来冬季`,
        () => choice.term,
        (v) => (choice.term = v)
      ),
      group(
        "资源丰度",
        "wood",
        landIds,
        (v) => lands[v].title,
        (v) => chip("coins", `初始 ${lands[v].coins} 金币`),
        (v) => lands[v].blurb,
        () => choice.land,
        (v) => (choice.land = v)
      )
    ]
    // The land is drawn from a seed: a fresh one on a click; the number itself only on hover, for whoever wants it.
    const reroll = el("button", "frame reroll", "↻ 换张地图")
    reroll.onclick = () => {
      choice.seed = (Math.random() * 0x7fffffff) >>> 0
      refresh()
    }
    mapBox.append(reroll)
    const refresh = () => {
      for (const r of refreshers) r()
      const land = drawLand(map)
      reroll.title = `重新生成地图（当前种子 ${choice.seed}）`
      const rocks = land.rocks.filter((r) => !r.ore).length
      setHtml(cells, `${icon("pave", 13)}${land.cells} 格`)
      setHtml(facts, chip("wood", `${land.trees.length} 棵树`) + chip("stone", `${rocks} 处石料`) + chip("ore", `${land.rocks.length - rocks} 处矿石`))
    }
    refresh()
    const actions = el("div", "actions")
    const found = el("button", "frame primary", "新建城镇")
    found.onclick = () => {
      if (visiting) endVisit()
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
    // On the way in, a town saved in this browser: carry on with it instead.
    if (!cancellable && savedTown) {
      const saved = savedTown
      const resume = el("button", "frame", "继续存档")
      resume.title = `继续此浏览器中的存档： ${saved.title}${saved.savedAt > 0 ? `，保存于${ago(saved.savedAt)}` : ""}`
      resume.onclick = () => {
        const said = persistence().load() ?? "已读取"
        ui.toast(said)
        if (!said.startsWith("已读取")) return
        history.length = 0
        ui.selected = null
        ui.menu = null
        closeCharter()
        choose("select")
        setSpeed(1)
      }
      actions.append(resume)
    }
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
  if (!options.shared) openCharter(false)

  // ── Sharing ──
  // A picture of the town (the card), to post anywhere; and, on asking, a link
  // that opens the town itself, running, for anyone to watch and play on.
  let shareSpeed = 1
  const closeShare = () => {
    if (!shareBox.classList.contains("open")) return
    shareBox.classList.remove("open")
    for (const img of shareBox.querySelectorAll("img")) URL.revokeObjectURL(img.src)
    if (!visiting) setSpeed(shareSpeed)
  }
  shareBox.onclick = (event) => {
    if (event.target === shareBox) closeShare()
  }
  const openShare = async () => {
    const s = ui.stats
    if (!s || shareBox.classList.contains("open")) return
    shareSpeed = ui.speed
    setSpeed(0)
    const facts = cardFacts(s)
    let card: HTMLCanvasElement, png: Blob
    try {
      card = await drawCard(stage.picture(PICTURE_WIDTH, PICTURE_HEIGHT, 2), facts, location.host)
      png = await blobOf(card, "image/png")
    } catch (error) {
      setSpeed(shareSpeed)
      return ui.toast(error instanceof Error ? error.message : "无法生成图片")
    }
    const name = `inkline-town-${s.fate.state === "playing" ? `year-${s.season.year}` : s.fate.state === "won" ? "complete" : "reckoning"}.png`
    const caption = `${metaOf(facts).title} · ${metaOf(facts).description}`
    shareBox.replaceChildren()
    const sheet = el("div", "sheet")
    sheet.append(el("h2", "", "分享城镇"))
    const preview = document.createElement("img")
    preview.className = "card-preview"
    preview.alt = caption
    preview.src = URL.createObjectURL(png)
    sheet.append(preview)
    sheet.append(el("p", "sub", "可保存或分享城镇图片，也可生成链接。打开链接的人会从当前视角看到城镇运行，并可接手继续游玩。"))
    const actions = el("div", "actions")
    const picture = el("button", "frame primary", "")
    picture.append(iconEl("picture", 15), document.createTextNode(handheld() ? "分享图片" : "保存图片"))
    picture.onclick = async () => ui.toast(await offerPicture(png, name, caption))
    const link = el("button", "frame", "")
    link.append(iconEl("link", 15), document.createTextNode("生成链接"))
    const linkRow = el("div", "link-row")
    link.onclick = async () => {
      link.disabled = true
      link.lastChild!.textContent = "正在生成链接…"
      try {
        const small = await blobOf(scaled(card, PICTURE_WIDTH, PICTURE_HEIGHT), "image/jpeg", PICTURE_QUALITY)
        const made = await upload(persistence().shareFile(stage.view()), small, metaOf(facts))
        link.remove()
        const field = document.createElement("input")
        field.readOnly = true
        field.value = made.url
        field.onfocus = () => field.select()
        const copy = el("button", "frame primary", handheld() ? "分享链接" : "复制链接")
        copy.onclick = async () => ui.toast(await offerLink(made.url, metaOf(facts).title))
        const open = el("a", "frame", "打开")
        open.setAttribute("href", made.url)
        open.setAttribute("target", "_blank")
        open.setAttribute("rel", "noopener")
        linkRow.replaceChildren(field, copy, open)
        linkRow.classList.add("show")
        copy.focus()
      } catch (error) {
        link.disabled = false
        link.lastChild!.textContent = "重新生成链接"
        ui.toast(error instanceof Error ? error.message : "无法分享城镇")
      }
    }
    const close = el("button", "frame", "关闭")
    close.onclick = () => closeShare()
    actions.append(picture, link, close)
    sheet.append(actions, linkRow)
    shareBox.append(sheet)
    shareBox.classList.add("open")
    picture.focus()
  }

  // ── Visiting a shared town ──
  // The town runs as its mayor left it, with the building tools put away,
  // until the visitor plays on from here (it becomes theirs, and autosaves)
  // or founds a town of their own.
  let visiting = false
  const endVisit = () => {
    visiting = false
    document.body.classList.remove("visiting")
    visitBar.classList.remove("show")
    window.history.replaceState(null, "", "/")
  }
  /** The shared town is loaded: show it running. */
  const visit = (title: string) => {
    visiting = true
    closeCharter()
    resetPage()
    document.body.classList.add("visiting")
    visitBar.replaceChildren()
    const text = el("div", "cell")
    text.append(iconEl("town", 18))
    const words = el("span", "stack")
    words.append(el("b", "", "分享的城镇"), el("small", "", title))
    text.append(words)
    const play = el("button", "frame primary", "接手游玩")
    play.title = "接手这座城镇，继续建设和治理；进度会自动保存在此浏览器中"
    play.onclick = () => {
      endVisit()
      ui.toast("已接手城镇：游玩进度将自动保存")
    }
    const own = el("button", "frame", "建立自己的城镇")
    own.onclick = () => openCharter(true)
    const buttons = el("div", "cell")
    buttons.append(play, own)
    visitBar.append(text, buttons)
    visitBar.classList.add("show")
    setSpeed(1)
  }
  /** The shared town could not be opened: say why, and found a town instead. */
  const visitFailed = (message: string) => {
    window.history.replaceState(null, "", "/")
    openCharter(false)
    ui.toast(message)
  }

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
    story.innerHTML = s.chronicle.map((l) => `<p><b>${clockText(Math.round(l.tick / 60))}</b> ${escapeHtml(l.text)}</p>`).join("")
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
    const share = el("button", "frame", "分享城镇")
    share.title = "分享城镇图片和任期评价，或生成分享链接"
    share.onclick = () => void openShare()
    actions.append(again, look, share)
    card.append(actions)
    reckoning.append(card)
    showReckoning(true)
  }

  const input = new MapInput(stage, ui)
  // A road, a row of homes, or a patch of park let go of on a touch screen is held here until built or
  // dropped; the tooltip says what it lays and costs.
  const strokeBar = el("div", "stroke-bar")
  const strokeBuild = el("button", "primary", "建造")
  strokeBuild.onclick = () => input.confirmStroke()
  const strokeDrop = el("button", "", "取消")
  strokeDrop.onclick = () => input.cancelStroke()
  strokeBar.append(strokeDrop, strokeBuild)
  document.body.append(strokeBar)
  const resetPage = () => {
    choose("select")
    ui.menu = null
    ui.selected = null
    input.reset()
  }

  /** Ticker lines the mayor has put away, by what they say (and, for news, when). */
  const dismissed = new Set<string>()
  let tickerLines: { guide: Stats["guide"]["step"]; alerts: Stats["alerts"]; news: Stats["chronicle"] } = { guide: null, alerts: [], news: [] }
  ticker.onclick = (event) => {
    event.stopPropagation()
    // On a phone the peeking line opens the guide in full.
    if (ticker.classList.contains("peek")) return setFold("guide")
    const target = event.target as HTMLElement
    const off = target.closest<HTMLElement>("[data-dismiss]")
    if (off) {
      dismissed.add(off.dataset.dismiss!)
      return
    }
    // The guide: put this step away, or turn the guide off (the bottom-right button turns it back on).
    const skip = target.closest<HTMLElement>("[data-skip]")
    if (skip) {
      ui.guide.push({ type: "skip", id: skip.dataset.skip! })
      return
    }
    if (target.closest("[data-guide-off]")) {
      ui.guide.push({ type: "off" })
      ui.toast("引导已关闭 · 可从右下方重新开启")
      return
    }
    // A building the line is about: go to it.
    const go = target.closest<HTMLElement>("[data-go]")
    if (go) {
      const row = go.closest<HTMLElement>("[data-alert]")
      const there = row ? tickerLines.alerts[Number(row.dataset.alert)]?.places?.[go.dataset.go as KindId] : undefined
      if (there) goTo(there.at, there.size, there.id)
      return
    }
    const ref = target.closest<HTMLElement>("[data-kind]")
    if (ref) {
      const kind = ref.dataset.kind as KindId
      // Straight to placing it: the placement itself says if the town cannot build it yet.
      if (kinds[kind].buildable) place(kind)
      return
    }
    const line = target.closest<HTMLElement>(".cell.place")
    if (!line) return
    if (line.dataset.guide !== undefined && tickerLines.guide?.at) return goTo(tickerLines.guide.at, tickerLines.guide.size, tickerLines.guide.id)
    const alert = line.dataset.alert !== undefined ? tickerLines.alerts[Number(line.dataset.alert)] : undefined
    if (alert?.at) return goTo(alert.at, alert.size, alert.id)
    const news = line.dataset.news !== undefined ? tickerLines.news[Number(line.dataset.news)] : undefined
    if (news?.at) goTo(news.at, 1, null)
  }

  /** The last chronicle line announced. */
  let lastNews = ""
  /** The guide step last shown, and the timer that hides its peek. */
  let lastStep = ""
  let peekTimer = 0
  /** Copies the town's numbers and preview into the page, once a frame. */
  const syncPage = () => {
    syncPanel()
    const s = ui.stats
    if (s) {
      // The treasury as the goods are shown: which way it went over the last minute, and by how much; the steady rate until a minute is counted.
      const cf = s.flow?.coins ?? null
      const change = cf ? cf.made + cf.traded - cf.used : s.net
      const way = cf ? trendOf(cf.made, cf.used, cf.traded) : 0
      setHtml(
        coins,
        `${icon("coins", 20)}<span class="stack"><b>${s.coins}${cf ? `<span class="trend ${trendClass(way)}">${trendMark(way)}</span>` : ""}</b>` +
          `<small class="${change >= 0 ? "up" : "down"}">${change >= 0 ? "+" : ""}${change}/分钟</small></span>`
      )
      coins.title = cf
        ? `国库金币 · 点击查看上分钟收支\n上分钟：${signed(change)}（收入 ${cf.made}，支出 ${cf.used}${cf.traded !== 0 ? `，贸易 ${signed(cf.traded)}` : ""}）\n按当前速率：${signed(s.net)}/分钟（税收、贸易、维护、行政）`
        : `国库金币及当前每分钟收支 · 点击查看上分钟收支`
      coins.classList.toggle("debt", s.coins < 0)
      const left = Math.max(0, s.charter.term * 60 - Math.floor(s.minute * 60))
      const severity = (w: typeof s.season.coming) => (w === null ? "" : ` (${winters[w].title})`)
      const until = s.season.winter
        ? `${winters[s.season.severity ?? "normal"].title} · 距离春季 ${clockText(s.season.left)}`
        : s.season.coming === null
          ? "本任期不再有冬季"
          : `距离冬季 ${clockText(s.season.left)}${severity(s.season.coming)}`
      setHtml(clock, `${icon(s.season.winter ? "winter" : "clock", 20)}<span class="stack"><b>${clockText(left)}${ui.speed === 0 ? `<span class="paused-tag">已暂停</span>` : ""}</b><small class="${s.season.winter ? "winter" : s.season.coming === "hard" ? "down" : ""}">第 ${s.season.year} 年 · ${until}</small></span>`)
      clock.title = `${s.season.winter ? "冬季：农田停产，捕鱼减少，食物消耗加快" : "任期剩余时间"}\n年历：下个冬季为${s.season.coming === null ? "任期之外" : winters[s.season.coming].title}，再下个为${s.season.after === null ? "任期之外" : winters[s.season.after].title}。\n暖冬：捕鱼量 ${Math.round(winters.mild.fishing * 100)}%。普通冬季：${Math.round(winters.normal.fishing * 100)}%。严冬：时长增加50%，捕鱼量 ${Math.round(winters.hard.fishing * 100)}%，住宅取暖增加火灾风险。`
      const trend = s.mood.target > s.mood.approval ? "↑" : s.mood.target < s.mood.approval ? "↓" : ""
      setHtml(approval, `${icon("approval", 18)}<span class="stack"><b class="${s.mood.approval < 0 ? "down" : ""}">${signed(s.mood.approval)} <span class="${s.mood.target >= s.mood.approval ? "up" : "down"}">${trend}</span></b><small>支持度</small></span>`)
      setHtml(settlerCell, `${icon("settlers", 18)}<span class="stack"><b>${s.settlers}</b><small>移民</small></span>`)
      setHtml(citizenCell, `${icon("citizens", 18)}<span class="stack"><b>${s.citizens}</b><small>市民${s.burghers > 0 ? ` · ${s.burghers} 富裕市民` : ""}</small></span>`)
      const short = s.shortStaffed.length
      setHtml(jobs, `${icon("jobs", 18)}<span class="stack"><b>${s.employed}<span class="of">/${s.jobs}</span></b><small class="${short > 0 ? "down" : ""}">${short > 0 ? `${short} 处缺人 · 点击定位` : "已就业"}</small></span>`)
      jobs.title = short > 0
        ? `已就业人数 / 所需人数。${short} 处工作场所缺人：${s.shortStaffed.slice(0, 5).map((w) => `${w.title} ${w.assigned}/${w.needed}${w.nobodyNear ? "（15格道路内无住宅）" : ""}`).join("、")}。点击逐一定位。`
        : "已就业人数 / 所需人数：所有工作场所人手充足。居民最多步行15格道路上班。"
      const chipHtml = (["planks", "stone", "tools"] as const)
        .map((g) => `<span class="${s.stock[g] === 0 ? "short" : ""}">${goodIcon(g, 14)}${s.stock[g]}</span>`)
        .join("")
      if (goodsChip.dataset.html !== chipHtml) {
        goodsChip.dataset.html = chipHtml
        goodsChip.innerHTML = chipHtml
      }
      for (const [g, count] of goodCells) {
        count.textContent = String(s.stock[g])
        const way = s.flow ? flowTrend(s.flow, g) : 0
        const trend = goodTrends.get(g)!
        trend.textContent = s.flow ? trendMark(way) : ""
        trend.className = `trend ${trendClass(way)}`
        // Empty storage is only worth dimming when nothing is held anywhere else either.
        count.parentElement!.classList.toggle("empty", s.stock[g] === 0 && (s.flow?.elsewhere[g] ?? 0) === 0)
        count.parentElement!.title = `${goods[g].title}: ${goodHelp[g]}` + (s.flow
          ? `\n上分钟：生产 ${s.flow.made[g]}，消耗 ${s.flow.used[g]}${s.flow.traded[g] !== 0 ? `, ${s.flow.traded[g] > 0 ? "买入" : "卖出"} ${Math.abs(s.flow.traded[g])}` : ""}。仓储 ${s.stock[g]}，城镇其他处 ${s.flow.elsewhere[g]}（工坊、市场和运输途中）。`
          : "")
      }
      // On a phone the goods chip opens the table itself, once there is a minute to show; the plain goods until then.
      document.body.classList.toggle("flow-ready", s.flow !== null)
      if (flowCard.classList.contains("open") || (phone.matches && fold === "goods")) setHtml(flowCard, flowHtml(s))
      // The crown's request.
      request.classList.toggle("show", s.crown.open && s.fate.state === "playing")
      if (s.crown.open) {
        const have = s.stock[s.crown.good]
        // What is asked on top, in one line; the terms under it.
        setHtml(
          requestText,
          `${icon("crown", 18)}<span class="lines"><span class="ask">王室要求 <b>${s.crown.amount}</b> ${goodIcon(s.crown.good, 14)} <b>${goods[s.crown.good].title}</b></span>` +
            `<span class="terms"><span class="${have < s.crown.amount ? "down" : "up"}">库存 ${have}</span> · 剩余 <b>${clockText(s.crown.left)}</b> · +${s.crown.reward} 金币</span></span>`
        )
        send.title = have < s.crown.amount ? `库存${goods[s.crown.good].title}不足` : `交付 ${s.crown.amount} ${goods[s.crown.good].title}，获得 ${s.crown.reward} 金币`
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
      const alerts = s.alerts.filter((a) => !dismissed.has(`a:${a.text}`))
      // The crown's request has its own card while it is open, and is settled after: its news line would only repeat it.
      const fresh = news.filter((l) => !dismissed.has(`n:${l.tick}:${l.text}`) && !l.text.startsWith("The crown asks") && !l.text.startsWith("王室要求"))
      const toneIcon = { hint: "hint", warn: "caution", bad: "warning" } as const
      const row = (kind: string, tone: string, glyph: IconName, text: string, place: boolean, key: string, data: string) =>
        `<div class="cell ${kind} ${tone}${place ? " place" : ""}" ${data}>${icon(glyph, 16, "mark")}<span class="text">${text}</span><span class="acts">${place ? `<button class="act locate" title="定位">${icon("locate", 14)}</button>` : ""}<button class="act dismiss" data-dismiss="${escapeHtml(key)}" title="收起">${icon("close", 12)}</button></span></div>`
      // The guide's step first: what to do next, and why.
      const g = s.guide.step
      const guideHtml = g
        ? [
            `<div class="head guide"><span>引导 · ${{ Founding: "建立城镇", "Keeping it standing": "维持运转", "Growing citizens": "吸引市民", Governing: "治理城镇" }[g.chapter]}</span><span class="progress" title="已完成的引导步骤">已完成 ${s.guide.done}/${s.guide.total} 步</span><button class="quiet" data-guide-off title="关闭引导（可从右下方的引导按钮重新开启）">隐藏引导</button></div>`,
            `<div class="cell alert hint guide${g.at !== null ? " place" : ""}" data-guide>${icon("hint", 16, "mark")}<span class="text">${callouts(g.text)}<span class="goal">${icon("goal", 12)}<span>完成条件：${callouts(g.goal)}</span></span></span><span class="acts">${g.at !== null ? `<button class="act locate" title="定位">${icon("locate", 14)}</button>` : ""}<button class="act dismiss" data-skip="${escapeHtml(g.key)}" title="跳过此步骤">${icon("close", 12)}</button></span></div>`
          ]
        : []
      const tickerHtml = [
        ...guideHtml,
        ...(alerts.length > 0 ? [`<div class="head">当前</div>`] : []),
        ...alerts.map((a) => row("alert", a.tone, toneIcon[a.tone], callouts(a.text, new Set(Object.keys(a.places ?? {}) as Array<KindId>)), a.at !== null, `a:${a.text}`, `data-alert="${s.alerts.indexOf(a)}"`)),
        ...(fresh.length > 0 ? [`<div class="head">最近</div>`] : []),
        ...fresh.map((l) => row("news", "", "chronicle", `${callouts(l.text)} <em data-tick="${l.tick}"></em>`, l.at !== null, `n:${l.tick}:${l.text}`, `data-news="${news.indexOf(l)}"`))
      ].join("")
      if (ticker.dataset.html !== tickerHtml) {
        ticker.dataset.html = tickerHtml
        ticker.innerHTML = tickerHtml
      }
      for (const em of ticker.querySelectorAll<HTMLElement>("em[data-tick]")) {
        const text = ago(Number(em.dataset.tick))
        if (em.textContent !== text) em.textContent = text
      }
      tickerLines = { guide: g, alerts: s.alerts, news }
      guideButton.classList.toggle("on", !s.guide.off)
      guideButton.title = s.guide.off ? "重新开启引导，在动态栏顶部查看下一步及其原因" : "关闭引导"
      ticker.classList.toggle("show", tickerHtml !== "" && s.fate.state === "playing")
      // The phone's guide button: the step it is on, or how many things need looking at.
      const bad = alerts.some((a) => a.tone === "bad")
      const badge = g ? `${s.guide.done + 1}/${s.guide.total}` : alerts.length > 0 ? String(alerts.length) : ""
      if (guideBadge.textContent !== badge) guideBadge.textContent = badge
      guideBulb.classList.toggle("alert", bad)
      // A new step peeks out above the tool bar for a few seconds.
      const stepKey = g?.key ?? ""
      // Not behind the town picker: the step waits until the town is founded.
      if (stepKey !== lastStep && !ui.founding) {
        lastStep = stepKey
        window.clearTimeout(peekTimer)
        ticker.classList.toggle("peek", stepKey !== "" && phone.matches && fold === null)
        if (stepKey !== "") peekTimer = window.setTimeout(() => ticker.classList.remove("peek"), 7000)
      }
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
    const screenPointer = input.tip
    // A stroke being drawn says what it lays and costs.
    const text = ui.dragFrom && ui.stroke !== "cancel" && ui.preview.stroke ? ui.preview.stroke : ui.preview.tooltip
    // A held touch stroke waits for its build button.
    const held = ui.stroke === "held" && ui.preview.stroke !== null
    strokeBar.classList.toggle("open", held)
    document.body.classList.toggle("stroke-held", held)
    if (text && screenPointer) {
      tooltip.textContent = text
      tooltip.style.display = "block"
      tooltip.style.left = `${Math.min(screenPointer.x, window.innerWidth - tooltip.offsetWidth - 20)}px`
      tooltip.style.top = `${screenPointer.y}px`
    } else tooltip.style.display = "none"
  }

  return { app, stage, ui, syncPage, resetPage, input, visit, visitFailed, visiting: () => visiting }
}

/** Which way a good (or the treasury) went over the last minute: made and bought against used and sold, past a tenth of the traffic either way. */
const trendOf = (made: number, used: number, traded: number): number => {
  const net = made + traded - used
  const room = Math.max(1, Math.round((made + used + Math.abs(traded)) / 10))
  return net > room ? 1 : net < -room ? -1 : 0
}
const flowTrend = (flow: NonNullable<Stats["flow"]>, g: GoodId): number => trendOf(flow.made[g], flow.used[g], flow.traded[g])

/** A good's way over the last minute: up, down, or holding steady. */
const trendMark = (way: number) => (way > 0 ? "↑" : way < 0 ? "↓" : "→")
const trendClass = (way: number) => (way > 0 ? "up" : way < 0 ? "down" : "steady")

/** The goods' last minute, side by side: only the goods the town has touched. */
const flowHtml = (s: Stats): string => {
  const f = s.flow
  if (f === null) return `<p class="sub">正在统计城镇物资，首批数据将在半分钟后显示……</p>`
  const rows = goodIds.filter((g) => f.made[g] + f.used[g] + Math.abs(f.traded[g]) + s.stock[g] + f.elsewhere[g] > 0)
  const head = `<span></span><b title="上分钟由工坊和采集建筑生产">生产</b><b title="上分钟用于食用、加工、建造，以及腐坏和交付的物资">消耗</b><b title="上分钟买入（+）或卖出（−）">交易</b><b title="存放在市政厅、仓库和粮仓中">仓储</b><b title="位于工坊、市场，或由服务人员和运输员携带">城镇其他处</b>`
  const cell = (n: number) => `<span>${n === 0 ? `<i>–</i>` : n}</span>`
  const signedCell = (n: number) => `<span>${n === 0 ? `<i>–</i>` : n > 0 ? `+${n}` : `−${-n}`}</span>`
  // The treasury first: taxes and rewards made, upkeep and building used, trade's coins; it is all in storage.
  const c = f.coins
  const way = trendOf(c.made, c.used, c.traded)
  const treasury = `<span class="name" title="金币">${icon("coins", 14)}<span class="label">金币</span><span class="trend ${trendClass(way)}">${trendMark(way)}</span></span>` +
    `${cell(c.made)}${cell(c.used)}${signedCell(c.traded)}${cell(s.coins)}<span><i>–</i></span>`
  const body = treasury + rows.map((g) => {
    const way = flowTrend(f, g)
    const traded = f.traded[g] === 0 ? `<i>–</i>` : f.traded[g] > 0 ? `+${f.traded[g]}` : `−${-f.traded[g]}`
    return `<span class="name" title="${goods[g].title}">${goodIcon(g, 14)}<span class="label">${goods[g].title}</span><span class="trend ${trendClass(way)}">${trendMark(way)}</span></span>` +
      `${cell(f.made[g])}${cell(f.used[g])}<span>${traded}</span>${cell(s.stock[g])}${cell(f.elsewhere[g])}`
  }).join("")
  return `<div class="flow-grid">${head}${body}</div>`
}

/** How long ago a save was made, roughly: "刚刚", "12 min ago", "3 h ago", "2 days ago". */
const ago = (at: number): string => {
  const minutes = Math.floor((Date.now() - at) / 60000)
  if (minutes < 1) return "刚刚"
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  return days === 1 ? "昨天" : `${days} 天前`
}
