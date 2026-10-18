/**
 * The mayor's guide: a tutorial told through the ticker, one step at a
 * time, written for someone who has never played a town-builder. Each step
 * is one thing to do (`action`) and one reason for it (`why`), and names the
 * buildings it asks for (`asks`) so the ticker can turn them into chips that
 * place them. A step shows while it applies (`when`) and is put away for good
 * once the town has done it (`done`), whether or not it was ever shown, so a
 * mayor who already knows the game is not told what they did. The list is in
 * order of priority, not of chapters: a request from the crown with a
 * deadline goes ahead of a chain that takes minutes to build.
 *
 * Most steps are a course (`course`), taught in order, chapter by chapter,
 * and counted ("step 3 of 8"). Founding: homes, a road to the water, a
 * fishery, a look at what it needs, a lumberjack, a sawmill, the term's goal,
 * and ten homes. Growing citizens: a quarry, cloth, faith, bread, the first
 * citizens, the goals again. Governing: the ranks, up to a city. The course always has
 * something to say, so the guide never falls silent on a mayor who does not
 * know what comes next; a step whose buildings the town cannot build yet
 * says what opens them (`lockedNote`), and the course goes on to one it can.
 *
 * The course never asks for a building before the town needs it: a
 * building's upkeep starts the day it stands. A step with a `need` waits for
 * it (planks running low, stone running low), the course goes on past it,
 * and the card says what comes next and when (`upcoming`: "next: a
 * lumberjack and a sawmill, once planks fall below 25 (31 now)").
 *
 * Around the course, steps come when the town needs them: each waits for a
 * sign (stone running low, the woods thinning, a fire risk rising), goes
 * ahead of the course once Founding is done, and after one is done the guide
 * keeps quiet about such signs for `GUIDE_QUIET` seconds. An urgent step (the
 * crown's request, winter, a fire, the sick, a building falling apart) does
 * not wait for the quiet. A sign once shown stays until it is done or put
 * away, so the ticker does not hop between steps.
 *
 * A step that asks for a building is done when the building stands, not when
 * it is laid; in between, `waiting` says what is happening (carriers bringing
 * planks to the site), so the mayor knows they did the right thing.
 *
 * The texts are written once for mouse and touch. In them:
 * - a building's name (in `asks`) becomes a chip that starts placing one;
 * - `[homes]`, `[road]`, `[select]`, `[build]`, `[town]`, `[speed]`,
 *   `[pause]`, and `[view:fire]` (any map view) become chips that pick that
 *   tool, open that panel, or show that view; on a keyboard they carry the key;
 * - `{tap|click}` reads "tap" on a touch screen and "click" with a mouse.
 */
import { kinds, type Amounts, type KindId } from "../content.ts"

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
  /** The page: the town panel is open; a home is selected; a building (not the town hall) is selected. */
  readonly sawTown: boolean
  readonly sawHome: boolean
  readonly sawBuilding: boolean
  /** A road comes within two cells of water, close enough for a fishery on it. */
  readonly roadToWater: boolean
  /** The town's rank: 0 hamlet, 1 village, 2 town, 3 city. */
  readonly rank: number
  /** Kinds of building upgraded where they stand (a market hall, a church). */
  readonly upgraded: ReadonlySet<KindId>
  /** Coins in the treasury. */
  readonly coins: number
  /** Built homes no food walker reaches (the town hall's or a market's). */
  readonly unreached: number
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
  /** What to do, in one sentence. */
  readonly action: string
  /** Why, in a sentence or two. */
  readonly why: string
  /** When the step is done, in a few words: shown under it, so the mayor knows what closes it. */
  readonly goal: string
  /** The buildings the step asks for: their names in the text become chips to place one. */
  readonly asks?: ReadonlyArray<KindId>
  readonly focus: GuideFocus | null
  readonly when: (f: GuideFacts) => boolean
  /** Part of the course, taught in this order chapter by chapter, without the quiet. */
  readonly course?: boolean
  /** A course step that waits until the town needs it (the course goes on past it meanwhile); and, while it waits, what for. */
  readonly need?: (f: GuideFacts) => boolean
  readonly soon?: (f: GuideFacts) => string
  /** It cannot wait for the guide's quiet (and goes ahead of the step shown). */
  readonly urgent?: (f: GuideFacts) => boolean
  readonly done: (f: GuideFacts) => boolean
  /** Once the mayor has done their part and the town is at work on it: what is happening (`null`: not yet). */
  readonly waiting?: (f: GuideFacts) => string | null
}

/** Every one of these buildings stands (built, not only laid). */
const has = (f: GuideFacts, ...kinds: ReadonlyArray<KindId>) => kinds.every((k) => f.standing.has(k))

/** Planks and stone low enough that a lumberjack and a sawmill, or a quarry, are worth their upkeep. */
export const PLANKS_LOW = 25
export const STONE_LOW = 8

/** What a site needs while it waits: planks, mostly, carried from the store. */
const siteNote = (f: GuideFacts) =>
  f.stock.planks === 0
    ? "库存中的木板已耗尽，工地正在等待：在[town]面板出售多余物资，或购买木板。"
    : "目前仍是工地：运输员先从仓储运来木板和石料，随后开始搭建。[speed]可加快时间。"

/** The step's buildings are laid but not all standing yet. */
const rising = (...kinds: ReadonlyArray<KindId>) => (f: GuideFacts) =>
  kinds.some((k) => f.placed.has(k) && !f.standing.has(k)) ? siteNote(f) : null

export const guideSteps: ReadonlyArray<GuideStep> = [
  // ── The opening, in order ──
  {
    id: "homes",
    chapter: "Founding",
    course: true,
    action: "选择[homes]，沿市政厅周围的灰色道路拖动{，再轻点“建造”|}。",
    why: "移民会入住与道路相连的住宅；有食物供应的住宅缴纳税款，为城镇带来收入。",
    goal: "一栋住宅建成",
    focus: "hall",
    when: () => true,
    done: (f) => f.builtHomes > 0,
    waiting: (f) =>
      f.homes > 0
        ? f.stock.planks === 0
          ? "住宅正在等待木板，但仓储中已无木板。"
          : "运输员正从仓储向新住宅运送木板，建成后移民便会入住。[speed]可加快时间。"
        : null
  },
  {
    id: "road",
    chapter: "Founding",
    course: true,
    action: "选择[road]，从市政厅周围的道路向水边拖动铺路。",
    why: "建筑一侧的中点必须连接道路，人员才能到达。接下来要建渔场，需要靠近水域。",
    goal: "道路延伸至距水域两格以内",
    focus: "water",
    when: () => true,
    done: (f) => f.roadToWater || has(f, "fishery") || has(f, "bakery")
  },
  {
    id: "fishery",
    chapter: "Founding",
    course: true,
    action: "{轻点|点击}渔场，将其放在这条道路旁，距水域不超过两格。",
    why: "移民需要食物。城镇最初只有少量鲜鱼，且库存中的鲜鱼会逐渐腐坏。",
    goal: "一座渔场建成",
    asks: ["fishery"],
    focus: "water",
    when: () => true,
    done: (f) => has(f, "fishery") || has(f, "bakery"),
    waiting: rising("fishery")
  },
  {
    id: "look",
    chapter: "Founding",
    course: true,
    action: "选择[select]，再{轻点|点击}渔场打开详情面板。",
    why: "建筑的工人来自十五格道路内的住宅；详情面板显示人手和运转障碍，顶部就业计数汇总所有岗位。",
    goal: "打开一座建筑的详情面板",
    focus: { kind: "fishery" },
    when: (f) => f.standing.has("fishery"),
    done: (f) => f.sawBuilding
  },
  {
    id: "lumberjack",
    chapter: "Founding",
    course: true,
    action: "在树林旁、与道路相连的位置建造伐木场。",
    why: "木板即将耗尽，而住宅和建筑都需要木板。先采集原木，才能加工木板。",
    goal: "一座伐木场建成",
    asks: ["lumberjack"],
    focus: "trees",
    when: () => true,
    need: (f) => f.stock.planks < PLANKS_LOW || f.placed.has("lumberjack"),
    soon: (f) => `木板库存低于 ${PLANKS_LOW} 时建造伐木场和锯木厂（当前 ${f.stock.planks}）`,
    done: (f) => has(f, "lumberjack"),
    waiting: rising("lumberjack")
  },
  {
    id: "sawmill",
    chapter: "Founding",
    course: true,
    action: "在伐木场附近、与道路相连的位置建造锯木厂。",
    why: "物资通过生产链加工：伐木场获取原木，锯木厂将其加工成木板，运输员沿道路在建筑之间搬运。",
    goal: "一座锯木厂建成",
    asks: ["sawmill"],
    focus: { kind: "lumberjack" },
    when: () => true,
    need: (f) => f.stock.planks < PLANKS_LOW || f.placed.has("lumberjack") || f.placed.has("sawmill"),
    soon: (f) => `木板库存低于 ${PLANKS_LOW} 时建造锯木厂（当前 ${f.stock.planks}）`,
    done: (f) => has(f, "sawmill"),
    waiting: rising("sawmill")
  },
  {
    id: "term",
    chapter: "Founding",
    course: true,
    action: "打开[town]面板，查看顶部的发展目标。",
    why: "达成目标可让聚落依次晋升为村庄、城镇和城市，每次晋升都会获得王室奖励。需要考虑布局时，可用[pause]暂停时间。",
    goal: "打开城镇面板",
    focus: null,
    when: () => true,
    done: (f) => f.sawTown
  },
  {
    id: "grow",
    chapter: "Founding",
    course: true,
    action: "继续铺路、建造住宅，直到十栋住宅建成。",
    why: "人口增加会带来更多税收，并在[build]中解锁新建筑。引导只会在城镇需要时建议建造。",
    goal: "十栋住宅建成",
    focus: "hall",
    when: () => true,
    done: (f) => f.builtHomes >= 10,
    waiting: (f) => (f.homes >= 10 && f.builtHomes < 10 ? "十栋住宅已放置，正在施工。" : null)
  },

  // ── The course goes on: citizens ──
  {
    id: "quarry",
    chapter: "Growing citizens",
    course: true,
    action: "在浅色岩石旁、与道路相连的位置建造采石场。",
    why: "石料即将耗尽，市民所需的工坊都要用到石料。深色岩石是矿床，稍后才会用到。",
    goal: "一座采石场建成",
    asks: ["quarry"],
    focus: "stone",
    when: () => true,
    need: (f) => f.stock.stone < STONE_LOW || f.placed.has("quarry"),
    soon: (f) => `石料库存低于 ${STONE_LOW} 时建造采石场（当前 ${f.stock.stone}）`,
    done: (f) => has(f, "quarry"),
    waiting: rising("quarry")
  },
  {
    id: "cloth",
    chapter: "Growing citizens",
    course: true,
    action: "建造牧羊场和织布坊，让两者相邻并连接道路。",
    why: "住宅需要面包、布料和信仰才能升级为市民住宅。牧羊场获取羊毛，织布坊将其织成布料。",
    goal: "一座牧羊场和一座织布坊建成",
    asks: ["sheep", "weaver"],
    focus: "hall",
    when: () => true,
    done: (f) => has(f, "sheep", "weaver"),
    waiting: rising("sheep", "weaver")
  },
  {
    id: "chapel",
    chapter: "Growing citizens",
    course: true,
    action: "在住宅区中、与道路相连的位置建造教堂。",
    why: "第二项需求是信仰。教堂的传教士为沿途住宅提供信仰服务，教堂也会提高街区宜居度。",
    goal: "一座教堂建成",
    asks: ["chapel"],
    focus: "hall",
    when: () => true,
    done: (f) => has(f, "chapel"),
    waiting: rising("chapel")
  },
  {
    id: "wheat",
    chapter: "Growing citizens",
    course: true,
    action: "建造农场和磨坊。",
    why: "第三项需求是面包，它的生产链最长：农场种植小麦，磨坊将小麦磨成面粉。",
    goal: "一座农场和一座磨坊建成",
    asks: ["farm", "mill"],
    focus: "hall",
    when: () => true,
    done: (f) => has(f, "farm", "mill"),
    waiting: rising("farm", "mill")
  },
  {
    id: "bakery",
    chapter: "Growing citizens",
    course: true,
    action: "在磨坊附近建造面包坊。",
    why: "面包坊把磨坊的面粉烤成面包。移民小屋获得面包供应后，税收也会增加 50%。",
    goal: "一座面包坊建成",
    asks: ["bakery"],
    focus: { kind: "mill" },
    when: (f) => has(f, "farm", "mill"),
    done: (f) => has(f, "bakery"),
    waiting: rising("bakery")
  },
  {
    id: "citizens",
    chapter: "Growing citizens",
    course: true,
    action: "选择[select]，再{轻点|点击}住宅，查看升级为市民住宅还缺少什么。",
    why: "住宅获得面包、布料和信仰，街区宜居度达到 5，并支付金币、木板与石料后，即可升级。详情面板会列出尚未满足的条件。",
    goal: "首栋住宅入住市民",
    focus: "hall",
    when: () => true,
    done: (f) => f.finerHomes > 0
  },
  {
    id: "goals",
    chapter: "Growing citizens",
    course: true,
    action: "打开[town]面板，查看距离发展目标还有多远。",
    why: "首批市民已入住；城镇等级越高，要求的市民占比也越高。",
    goal: "打开城镇面板",
    focus: null,
    when: (f) => f.finerHomes > 0,
    done: (f) => f.sawTown
  },
  {
    id: "ranks",
    chapter: "Governing",
    course: true,
    action: "达成[town]面板中的全部目标，提升城镇等级。",
    why: "同时满足全部目标并维持两分钟，即可晋升，最高成为城市。达到城镇等级后，市场和教堂可原地升级。需要处理问题时，引导会及时提醒。",
    goal: "晋升为城市",
    focus: null,
    when: () => true,
    done: (f) => f.rank >= 3
  },

  // ── Around the course, when the town needs them ──
  {
    id: "crown",
    chapter: "Governing",
    action: "点击顶部王室要求中的“交付”，送出所需物资。",
    why: "交付可获得金币；逾期会被罚款，连续三次未交付将导致任期失败。",
    goal: "交付所需物资",
    focus: null,
    when: (f) => f.crown.open,
    urgent: () => true,
    done: (f) => f.crown.met > 0
  },
  {
    id: "winter",
    chapter: "Keeping it standing",
    action: "在冬季到来前建造粮仓或熏鱼坊。",
    why: "冬季捕鱼减少，居民食物消耗加快，鲜鱼还会在库存中腐坏。粮仓可将保鲜时间延长至五倍，熏鱼则能储存整个冬季。",
    goal: "一座粮仓或熏鱼坊建成",
    asks: ["granary", "smokehouse"],
    focus: "hall",
    when: (f) => f.residents >= 20 && (f.winter || (f.winterIn !== null && f.winterIn <= 120)),
    urgent: () => true,
    done: (f) => has(f, "granary") || has(f, "smokehouse"),
    waiting: rising("granary", "smokehouse")
  },
  {
    id: "tools",
    chapter: "Growing citizens",
    action: "在[town]面板的“物资与贸易”中，将工具设为买入。",
    why: "工坊会消耗工具，只有铁匠铺能生产新工具；市民达到 10 人时解锁铁匠铺。",
    goal: "设为买入工具，或建成铁匠铺",
    focus: null,
    when: (f) => f.residents >= 15 && f.citizens < 10 && f.stock.tools <= 3 && !has(f, "smithy"),
    done: (f) => f.buysTools || has(f, "smithy")
  },
  {
    id: "forester",
    chapter: "Founding",
    action: "在伐木场旁建造林务所。",
    why: "伐木场附近的树木即将砍完，林务所可以补种。",
    goal: "一座林务所建成",
    asks: ["forester"],
    focus: { kind: "lumberjack" },
    when: (f) => f.fewTrees,
    done: (f) => has(f, "forester"),
    waiting: rising("forester")
  },
  {
    id: "firewatch",
    chapter: "Keeping it standing",
    action: "在住宅区中、与道路相连的位置建造消防站。",
    why: "木制小屋容易着火，火势还会蔓延至邻居。消防巡查员降低火灾风险，消防员负责灭火。[view:fire]可显示火灾风险。",
    goal: "一座消防站建成",
    asks: ["firewatch"],
    focus: "hall",
    when: (f) => f.risk.fire || f.burning > 0,
    urgent: (f) => f.burning > 0,
    done: (f) => has(f, "firewatch"),
    waiting: rising("firewatch")
  },
  {
    id: "builder",
    chapter: "Keeping it standing",
    action: "在破旧建筑附近建造修缮工坊。",
    why: "破旧建筑效率减半，还有坍塌风险。修缮工坊的工匠使用木板和石料维修沿途建筑。[view:condition]可显示建筑状况。",
    goal: "一座修缮工坊建成",
    asks: ["builder"],
    focus: "worn",
    when: (f) => f.worn,
    urgent: () => true,
    done: (f) => has(f, "builder"),
    waiting: rising("builder")
  },
  {
    id: "market",
    chapter: "Keeping it standing",
    action: "在距离市政厅较远的住宅区建造市场。",
    why: "部分住宅超出了市政厅配送员的二十格道路范围，无法获得食物。市场可向更远的街区配送。",
    goal: "一座市场建成",
    asks: ["market"],
    focus: "hall",
    when: (f) => f.unreached >= 2,
    done: (f) => has(f, "market"),
    waiting: rising("market")
  },
  {
    id: "markethall",
    chapter: "Keeping it standing",
    action: "{轻点|点击}上方带金色箭头的市场，在详情面板中开始升级市场大厅。",
    why: "部分住宅位于所有配送员的服务范围之外。市场大厅配送更频繁、范围更远，无需另建一座市场。",
    goal: "一座市场大厅建成",
    focus: { kind: "market" },
    when: (f) => f.rank >= 2 && has(f, "market") && f.unreached >= 2,
    done: (f) => f.upgraded.has("market")
  },
  {
    id: "street",
    chapter: "Growing citizens",
    action: "将这栋住宅所在街区的宜居度提高至 5：在附近增建教堂、市场或公园，并让工坊远离住宅。",
    why: "这栋住宅已有面包、布料和信仰，但市民还要求街区宜居。[view:appeal]可显示宜居度。",
    goal: "优质街区的一栋住宅入住市民",
    asks: ["chapel", "market"],
    focus: "poorStreet",
    when: (f) => f.poorStreet,
    done: (f) => f.finerHomes > 0
  },
  {
    id: "carpenter",
    chapter: "Growing citizens",
    action: "建造木工坊，用木板制作家具。",
    why: "富裕市民居住的市民宅邸需要家具：首次升级要消耗两件，此后还需市场定期配送，才能维持等级。市民宅邸容纳人数最多，税收也最高。",
    goal: "一座木工坊建成",
    asks: ["carpenter"],
    focus: "hall",
    when: (f) => f.citizens >= 60 && f.finerHomes >= 8,
    done: (f) => has(f, "carpenter"),
    waiting: rising("carpenter")
  },
  {
    id: "healer",
    chapter: "Keeping it standing",
    action: "在住宅区中、与道路相连的位置建造医馆。",
    why: "疾病正在蔓延，患病住宅的容量减半。医馆的医师会巡视住宅、治疗病人。[view:health]可显示疾病风险。",
    goal: "一座医馆建成",
    asks: ["healer"],
    focus: "hall",
    when: (f) => f.residents >= 30 && (f.sick > 0 || f.risk.health),
    urgent: (f) => f.sick > 0,
    done: (f) => has(f, "healer") || has(f, "hospital"),
    waiting: rising("healer")
  },
  {
    id: "watchhouse",
    chapter: "Keeping it standing",
    action: "在住宅区中、与道路相连的位置建造治安所。",
    why: "宜居度低、住宅半空和支持度低都会增加盗窃风险。治安所警员沿街巡逻，维护秩序。[view:order]可显示治安风险。",
    goal: "一座治安所建成",
    asks: ["watchhouse"],
    focus: "hall",
    when: (f) => f.residents >= 40 && f.risk.order,
    done: (f) => has(f, "watchhouse"),
    waiting: rising("watchhouse")
  },
  {
    id: "trade",
    chapter: "Governing",
    action: "在[town]面板的“物资与贸易”中，出售积压物资，或买入短缺物资。",
    why: "新城镇默认不交易物资。出售多余物资，可以换取金币。",
    goal: "设为出售或买入一种物资",
    focus: null,
    when: (f) => f.residents >= 20 && (f.net < 0 || f.most >= 80),
    done: (f) => f.trading
  },
  {
    id: "taxes",
    chapter: "Governing",
    action: "在[town]面板中适当提高税率。",
    why: "居民较满意，但城镇正在亏损，可考虑适当加税。税率超过 125% 会积累持久的怨恨。",
    goal: "调整一次税率",
    focus: null,
    when: (f) => f.approval >= 30 && f.net < 0,
    done: (f) => f.taxed
  },
  {
    id: "smithy",
    chapter: "Governing",
    action: "在带锈色纹路的深色岩石旁建造矿场，并建造铁匠铺。",
    why: "工具即将耗尽，工坊还会持续消耗。矿场开采矿石，铁匠铺将矿石锻造成工具。",
    goal: "一座矿场和一座铁匠铺建成",
    asks: ["mine", "smithy"],
    focus: "ore",
    when: (f) => f.citizens >= 10 && f.stock.tools <= 5,
    done: (f) => has(f, "mine", "smithy"),
    waiting: rising("mine", "smithy")
  }
]

/** The course, in order. */
export const courseSteps: ReadonlyArray<GuideStep> = guideSteps.filter((s) => s.course)

/** Where a course step stands in its chapter ("step 3 of 8"), or `null` for a step not in the course or alone in its chapter. */
export const courseCount = (step: GuideStep): { readonly at: number; readonly of: number } | null => {
  if (!step.course) return null
  const chapter = courseSteps.filter((s) => s.chapter === step.chapter)
  return chapter.length > 1 ? { at: chapter.indexOf(step) + 1, of: chapter.length } : null
}

/** When the town cannot build what a step asks for yet: what opens it, and what to do meanwhile (`null`: it can). */
export const lockedNote = (step: GuideStep, f: GuideFacts): string | null => {
  for (const id of step.asks ?? []) {
    const kind = kinds[id]
    if (kind.unlock.residents > f.residents)
      return `${kind.title.toLowerCase()}需要 ${kind.unlock.residents} 位居民才能解锁（当前 ${f.residents} 位）：增建[homes]并保证食物供应。`
    if (kind.unlock.citizens > f.citizens) return `${kind.title.toLowerCase()}需要 ${kind.unlock.citizens} 位市民才能解锁（当前 ${f.citizens} 位）。`
  }
  // Not yet laid, and the treasury cannot pay for the cheapest of them.
  const unpaid = (step.asks ?? []).filter((id) => !f.placed.has(id)).map((id) => kinds[id])
  const cheapest = unpaid.sort((a, b) => a.cost.coins - b.cost.coins)[0]
  if (cheapest && f.coins < cheapest.cost.coins)
    return `先积攒金币：${cheapest.title.toLowerCase()}需要 ${cheapest.cost.coins} 金币（当前 ${f.coins}）。住宅每分钟缴纳税款。`
  return null
}

/** The next course step that waits for the town to need it: what it is, and when it comes (`null`: none waiting). */
export const upcoming = (f: GuideFacts, done: ReadonlySet<string>): string | null => {
  const step = courseSteps.find((s) => !done.has(s.id) && !s.done(f) && s.when(f) && s.need && !s.need(f) && s.soon)
  return step ? `接下来：${step.soon!(f)}。` : null
}

/** The steps the town has now done that the guide has not yet put away. */
export const guideDone = (f: GuideFacts, done: ReadonlySet<string>): Array<string> =>
  guideSteps.filter((s) => !done.has(s.id) && s.done(f)).map((s) => s.id)

/**
 * The step to show now, if any: an urgent one first; then the course while
 * the town is being founded; then a sign already shown (`shown`), until it is
 * done or put away; then, unless the guide is keeping `quiet`, a new sign;
 * and otherwise the course: its next step, or when the town cannot build
 * that yet, a later building it can (else the step, saying what opens it).
 */
export const guideStep = (f: GuideFacts, done: ReadonlySet<string>, pace: { readonly shown?: string | null; readonly quiet?: boolean } = {}): GuideStep | null => {
  const open = (s: GuideStep) => !done.has(s.id) && !s.done(f)
  const urgent = guideSteps.find((s) => open(s) && s.when(f) && s.urgent?.(f))
  if (urgent) return urgent
  const course = courseSteps.filter((s) => open(s) && s.when(f) && (s.need?.(f) ?? true))
  // A step the town cannot build yet gives way to a later building it can; else it shows, saying what opens it.
  const first = course[0] ?? null
  const next = first && lockedNote(first, f) !== null ? (course.find((s) => s.asks && lockedNote(s, f) === null) ?? first) : first
  if (next?.chapter === "Founding") return next
  const shown = guideSteps.find((s) => s.id === pace.shown && !s.course && open(s) && (!s.urgent || s.when(f)))
  if (shown) return shown
  const sign = pace.quiet ? undefined : guideSteps.find((s) => !s.course && open(s) && s.when(f))
  return sign ?? next
}
