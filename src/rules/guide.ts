/**
 * The mayor's guide: a tutorial told through the ticker, one step at a
 * time. Each step says what to build or do next and why, and names the
 * buildings it means so the ticker can turn them into chips that place
 * them. A step shows while it applies (`when`) and is put away for good
 * once the town has done it (`done`), whether or not it was ever shown, so
 * a mayor who already knows the game is not told what they did. The list
 * is in order of priority, not of chapters: a request from the crown with a
 * deadline goes ahead of a chain that takes minutes to build.
 *
 * The first steps (`opening`) come one after another, each once the last
 * is built: homes, then food, then planks, then stone, so a new mayor learns
 * the store and its chains; then where to look as the town grows (a home's
 * panel, the town panel). After them, steps come when the town needs them,
 * not back to back: each waits for a
 * sign (planks running low, the woods thinning, a fire risk rising), and
 * after one is done the guide keeps quiet for `GUIDE_QUIET` seconds. An
 * urgent step (the crown's request, winter, a fire, the sick, a building
 * falling apart) does not wait for the quiet. A step once shown stays until
 * it is done or put away, so the ticker does not hop between steps. A step
 * that asks for a building is done when the building stands, not when it is
 * laid.
 */
import type { Amounts, KindId } from "../content.ts"

/** What the guide reads of the town. */
export interface GuideFacts {
  /** Homes laid, built or not; and built. */
  readonly homes: number
  readonly builtHomes: number
  readonly residents: number
  /** Citizens, and homes that hold them (citizens' homes and townhouses). */
  readonly citizens: number
  readonly finerHomes: number
  /** Kinds of building placed (sites too), and standing. */
  readonly placed: ReadonlySet<KindId>
  readonly standing: ReadonlySet<KindId>
  readonly stock: Amounts
  readonly sick: number
  readonly burning: number
  /** It is winter now, or the next one is this many seconds away (`null`: none before the term ends). */
  readonly winter: boolean
  readonly winterIn: number | null
  /** A building that wants mending. */
  readonly worn: boolean
  /** A settlers' home with every citizens' need met, on a street too poor for citizens. */
  readonly poorStreet: boolean
  readonly crown: { readonly open: boolean; readonly met: number }
  /** Coins a minute, and approval. */
  readonly net: number
  readonly approval: number
  /** The town buys or sells something; a tax rate is off the usual. */
  readonly trading: boolean
  /** The town buys tools from traders. */
  readonly buysTools: boolean
  readonly taxed: boolean
  /** The most of any one good in store. */
  readonly most: number
  /** The page: the town panel has been open; a home has been selected. */
  readonly sawTown: boolean
  readonly sawHome: boolean
  /** A home whose risk of fire, sickness, or theft is rising. */
  readonly risk: { readonly fire: boolean; readonly health: boolean; readonly order: boolean }
  /** A lumberjack with few trees left in reach. */
  readonly fewTrees: boolean
}

/** Seconds of the town's time the guide keeps quiet after a step, before the next that is not urgent. */
export const GUIDE_QUIET = 45

/** Where a step's "show me where" goes: a place on the land, or a building of a kind. */
export type GuideFocus = "hall" | "water" | "trees" | "stone" | "ore" | "worn" | "poorStreet" | { readonly kind: KindId }

export const chapters = ["Founding", "Keeping it standing", "Growing citizens", "Governing"] as const
export type Chapter = (typeof chapters)[number]

export interface GuideStep {
  readonly id: string
  readonly chapter: Chapter
  /** What to do and why. Building names become chips to place one; a key in brackets, a key. */
  readonly text: string
  /** When the step is done, in a few words: shown under it, so the mayor knows what closes it. */
  readonly goal: string
  readonly focus: GuideFocus | null
  readonly when: (f: GuideFacts) => boolean
  /** One of the first steps, which come one after another, without the quiet. */
  readonly opening?: boolean
  /** It cannot wait for the guide's quiet (and goes ahead of the step shown). */
  readonly urgent?: (f: GuideFacts) => boolean
  readonly done: (f: GuideFacts) => boolean
}

/** Every one of these buildings stands (built, not only laid). */
const has = (f: GuideFacts, ...kinds: ReadonlyArray<KindId>) => kinds.every((k) => f.standing.has(k))

export const guideSteps: ReadonlyArray<GuideStep> = [
  {
    id: "homes",
    goal: "一栋住宅建成",
    chapter: "Founding",
    text: "按（H），沿市政厅外的道路拖动建造一排住宅；也可先按（R） 铺设道路。建造工会从仓库运来木板。住宅建成后，移民会自行入住，并缴纳税款。",
    focus: "hall",
    opening: true,
    when: () => true,
    done: (f) => f.builtHomes > 0
  },
  {
    id: "fishery",
    goal: "一座渔场建成",
    chapter: "Founding",
    text: "顶部物资栏显示城镇库存。移民会食用库存中的鲜鱼，但储存的鲜鱼也会逐渐腐坏。按（B），在距水面不超过两格、连接道路的位置建造渔场；市政厅的配送员会把鱼送到各户。",
    focus: "water",
    opening: true,
    when: (f) => f.builtHomes > 0,
    done: (f) => has(f, "fishery") || has(f, "bakery")
  },
  {
    id: "crown",
    goal: "点击王室要求卡片上的按钮，交付物资",
    chapter: "Governing",
    text: "王室要求在期限内交付物资。用顶部卡片中的按钮交付，即可获得金币；逾期会被罚款，连续三次未交付，市长将被撤职。",
    focus: null,
    when: (f) => f.crown.open,
    urgent: () => true,
    done: (f) => f.crown.met > 0
  },
  {
    id: "winter",
    goal: "一座粮仓或熏鱼坊建成",
    chapter: "Keeping it standing",
    text: "冬季将至：捕鱼变慢，居民食物消耗加快，库存鲜鱼也会腐坏。粮仓将鲜鱼和面包的腐坏速度降至五分之一；熏鱼坊生产的熏鱼不会腐坏，可以储备过冬。",
    focus: "hall",
    when: (f) => f.residents >= 20 && (f.winter || (f.winterIn !== null && f.winterIn <= 120)),
    urgent: () => true,
    done: (f) => has(f, "granary") || has(f, "smokehouse")
  },
  {
    id: "tools",
    goal: "在城镇面板的贸易栏购买工具，或建成铁匠铺",
    chapter: "Growing citizens",
    text: "工具快用完了。只有铁匠铺能生产工具，达到 10 位市民后才能建造。在此之前，按（T） 打开城镇面板，向商人购买工具，供工坊使用。",
    focus: null,
    when: (f) => f.residents >= 15 && f.stock.tools <= 3 && !has(f, "smithy"),
    done: (f) => f.buysTools || has(f, "smithy")
  },
  {
    id: "planks",
    goal: "一座伐木场和一座锯木厂建成",
    chapter: "Founding",
    text: "建造住宅和建筑都要消耗库存木板，必须及时补充。物资生产需要相应的产业链：在树林旁建造伐木场获取原木，再由锯木厂加工成木板。",
    focus: "trees",
    opening: true,
    when: (f) => f.stock.planks < 25 || f.standing.has("fishery"),
    done: (f) => has(f, "lumberjack", "sawmill")
  },
  {
    id: "forester",
    goal: "一座林务所建成",
    chapter: "Founding",
    text: "伐木场附近的树快砍完了。在旁边建造林务所，种植新树，供伐木场继续采伐。",
    focus: { kind: "lumberjack" },
    when: (f) => f.fewTrees,
    done: (f) => has(f, "forester")
  },
  {
    id: "quarry",
    goal: "一座采石场建成",
    chapter: "Founding",
    text: "仓储建筑、工坊和石铺道路都需要石料，城镇初始库存不多。采石场从附近浅色岩石中开采石料；深色岩石是矿石，稍后才会用到。",
    focus: "stone",
    opening: true,
    when: (f) => f.stock.stone < 10 || has(f, "lumberjack", "sawmill"),
    done: (f) => has(f, "quarry")
  },
  {
    id: "look",
    goal: "点击一栋住宅",
    chapter: "Founding",
    text: "城镇已经初具规模。点击住宅，查看住了哪些居民、还缺什么、缴纳多少税款；点击其他建筑，可查看产出和停工原因。",
    focus: "hall",
    opening: true,
    when: (f) => has(f, "quarry") && f.builtHomes > 0,
    done: (f) => f.sawHome
  },
  {
    id: "watch",
    goal: "按（T） 打开城镇面板",
    chapter: "Founding",
    text: "城镇发展时，要留意顶部库存是否短缺、右上方的支持度和就业情况，以及这里的动态提示。按（T） 打开城镇面板，可查看任期目标、贸易和税率。",
    focus: null,
    opening: true,
    when: (f) => has(f, "quarry") && f.builtHomes > 0,
    done: (f) => f.sawTown
  },
  {
    id: "grow",
    goal: "十栋住宅建成",
    chapter: "Founding",
    text: "现在可以扩建了。铺设新街道和住宅，增加居民，获得更多税收，并解锁建造菜单中的新建筑（B）。城镇出现新的需求时，引导会再次提示。",
    focus: "hall",
    opening: true,
    when: (f) => has(f, "quarry") && f.sawHome && f.sawTown,
    done: (f) => f.builtHomes >= 10
  },
  {
    id: "firewatch",
    goal: "一座消防站建成",
    chapter: "Keeping it standing",
    text: "火灾风险正在上升。木制小屋容易起火，火势还会蔓延至邻居。消防站派出巡查员沿街预防火灾，并派消防员灭火。按（F） 查看火灾风险。",
    focus: "hall",
    when: (f) => f.risk.fire || f.burning > 0,
    urgent: (f) => f.burning > 0,
    done: (f) => has(f, "firewatch")
  },
  {
    id: "builder",
    goal: "一座修缮工坊建成",
    chapter: "Keeping it standing",
    text: "建筑会逐渐磨损，破旧建筑的工作速度减半，还可能倒塌。修缮工坊派出工匠，使用木板和石料修缮沿途建筑。按（C） 查看建筑状况。",
    focus: "worn",
    when: (f) => f.worn,
    urgent: () => true,
    done: (f) => has(f, "builder")
  },
  {
    id: "market",
    goal: "一座市场建成",
    chapter: "Keeping it standing",
    text: "市政厅配送员的服务范围只有 20 格道路。市场可派出配送员，把鲜鱼、熏鱼、面包和布料送到更远的街区。",
    focus: "hall",
    when: (f) => f.residents >= 40 && f.standing.has("fishery"),
    done: (f) => has(f, "market")
  },
  {
    id: "street",
    goal: "优质街区的一栋住宅入住市民",
    chapter: "Growing citizens",
    text: "这里的住宅已有面包、布料和信仰，但街区宜居度不足，无法吸引市民：至少需要 5 点。按（D） 查看宜居度，让住宅远离工坊，并增建教堂、市场或公园。",
    focus: "poorStreet",
    when: (f) => f.poorStreet,
    done: (f) => f.finerHomes > 0
  },
  {
    id: "wheat",
    goal: "一座农场和一座磨坊建成",
    chapter: "Growing citizens",
    text: "移民住宅同时获得面包、布料和信仰后，即可升级为市民住宅。市民的每人基础税收是移民的两倍；升级前，移民只需食物。先准备产业链最长的面包：农场种植小麦，磨坊将小麦磨成面粉。",
    focus: "hall",
    when: (f) => f.residents >= 30,
    done: (f) => has(f, "farm", "mill")
  },
  {
    id: "bakery",
    goal: "一座面包坊建成",
    chapter: "Growing citizens",
    text: "面包坊将磨坊生产的面粉烤成面包。市民需要面包；获得面包供应的移民小屋，税收也会增加 50%。",
    focus: { kind: "mill" },
    when: (f) => has(f, "farm", "mill"),
    done: (f) => has(f, "bakery")
  },
  {
    id: "cloth",
    goal: "一座牧羊场和一座织布坊建成",
    chapter: "Growing citizens",
    text: "接下来准备布料：牧羊场剪取羊毛，织布坊将羊毛织成布料。",
    focus: "hall",
    when: (f) => has(f, "bakery") || f.residents >= 60,
    done: (f) => has(f, "sheep", "weaver")
  },
  {
    id: "chapel",
    goal: "一座教堂建成",
    chapter: "Growing citizens",
    text: "最后还需要信仰。教堂的传教士为沿途住宅提供信仰服务，教堂本身也能提高周围宜居度。",
    focus: "hall",
    when: (f) => has(f, "sheep", "weaver"),
    done: (f) => has(f, "chapel")
  },
  {
    id: "goals",
    goal: "按（T） 打开城镇面板",
    chapter: "Growing citizens",
    text: "第一批市民已经入住。按（T） 打开城镇面板，查看任期考核的四项目标：居民、市民、支持度和金币。",
    focus: null,
    when: (f) => f.finerHomes > 0,
    done: (f) => f.sawTown
  },
  {
    id: "healer",
    goal: "一座医馆建成",
    chapter: "Keeping it standing",
    text: "疾病正在蔓延。饥饿、拥挤和采石粉尘会导致居民患病，患病住宅的容纳人数减半。医馆派医师沿街诊治。按（A） 查看疾病风险。",
    focus: "hall",
    when: (f) => f.residents >= 30 && (f.sick > 0 || f.risk.health),
    urgent: (f) => f.sick > 0,
    done: (f) => has(f, "healer") || has(f, "hospital")
  },
  {
    id: "watchhouse",
    goal: "一座治安所建成",
    chapter: "Keeping it standing",
    text: "盗窃风险正在上升：较差的街区、入住不足的住宅和低支持度都会增加风险。治安所派出警员沿街维护秩序。按（O） 查看治安风险。",
    focus: "hall",
    when: (f) => f.residents >= 40 && f.risk.order,
    done: (f) => has(f, "watchhouse")
  },
  {
    id: "trade",
    goal: "在城镇面板的贸易栏设置购买或出售一种物资",
    chapter: "Governing",
    text: "新城镇默认不进行贸易。按（T） 打开城镇面板，设置出售超过保留量的物资，或购买短缺物资。",
    focus: null,
    when: (f) => f.residents >= 20 && (f.net < 0 || f.most >= 80),
    done: (f) => f.trading
  },
  {
    id: "taxes",
    goal: "在城镇面板调整一项税率",
    chapter: "Governing",
    text: "居民较为满意，当前支持度允许适当加税。按（T） 打开城镇面板调整税率；超过 125% 会积累怨恨，降税后仍会持续一段时间。",
    focus: null,
    when: (f) => f.approval >= 30 && f.net < 0,
    done: (f) => f.taxed
  },
  {
    id: "smithy",
    goal: "一座矿场和一座铁匠铺建成",
    chapter: "Governing",
    text: "矿石只用于制造工具。现在已解锁：在深色、带锈红纹理的矿床旁建造矿场，开采矿石，再由铁匠铺锻造成工具。工坊和路灯都需要工具，使用中会逐渐消耗。",
    focus: "ore",
    when: (f) => f.citizens >= 10,
    done: (f) => has(f, "mine", "smithy")
  }
]

/** The steps the town has now done that the guide has not yet put away. */
export const guideDone = (f: GuideFacts, done: ReadonlySet<string>): Array<string> =>
  guideSteps.filter((s) => !done.has(s.id) && s.done(f)).map((s) => s.id)

/**
 * The step to show now, if any: an urgent one first; else the step already
 * shown (`shown`), until it is done or put away; else, unless the guide is
 * keeping `quiet`, the first that applies.
 */
export const guideStep = (f: GuideFacts, done: ReadonlySet<string>, pace: { readonly shown?: string | null; readonly quiet?: boolean } = {}): GuideStep | null => {
  const open = (s: GuideStep) => !done.has(s.id) && !s.done(f)
  const urgent = guideSteps.find((s) => open(s) && s.when(f) && s.urgent?.(f))
  if (urgent) return urgent
  const shown = guideSteps.find((s) => s.id === pace.shown && open(s) && (!s.urgent || s.when(f)))
  if (shown) return shown
  // The opening steps come one after another; the rest wait out the quiet.
  return guideSteps.find((s) => open(s) && s.when(f) && (!pace.quiet || s.opening)) ?? null
}
