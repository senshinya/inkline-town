/**
 * What an upgrade does, in words a mayor can weigh before paying for it:
 * each thing about the building it changes, from what it is now to what it
 * will be (see `asUpgraded`), and what it costs, now and carried in. The
 * build menu, the upgrade tool's tooltip, and the building's panel all read
 * these, so the mayor is told the same thing wherever they look.
 */
import { asUpgraded, costText, nextUpgrade, upgradeAt, type Kind, type Upgrade } from "../content.ts"
import { shippedRules, type Rules } from "./config.ts"

const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n)}`
const seconds = (s: number) => `${Math.round(s * 10) / 10} 秒`

/** What changes from `level` to the next, a line each ("upkeep 6 → 12 coins a minute"); empty when there is no next. */
export const upgradeChanges = (kind: Kind, level: number, rules: Rules = shippedRules): ReadonlyArray<string> => {
  const up = nextUpgrade(kind, level)
  if (!up) return []
  const now = asUpgraded(kind, level), then = asUpgraded(kind, level + 1), out: Array<string> = []
  if (now.recipe && then.recipe && now.recipe.seconds !== then.recipe.seconds) {
    const per = (k: Kind) => Math.round((60 / k.recipe!.seconds) * k.recipe!.batch)
    out.push(`${rules.goods[now.recipe.output].title}每分钟产量 ${per(now)} → ${per(then)}（每批耗时 ${seconds(now.recipe.seconds)} → ${seconds(then.recipe.seconds)}）`)
  }
  if (now.workers !== then.workers) out.push(`工人 ${now.workers} → ${then.workers} 人`)
  if (now.holds && then.holds && now.holds.cap !== then.holds.cap) out.push(`每种物资容量 ${now.holds.cap} → ${then.holds.cap}`)
  if (now.carriers !== then.carriers) out.push(`运输员 ${now.carriers ?? 0} → ${then.carriers ?? 0} 人`)
  if (now.service && then.service) {
    if (now.service.range !== then.service.range) out.push(`服务范围 ${now.service.range} → ${then.service.range} 格道路`)
    if (now.service.seconds !== then.service.seconds) out.push(`服务人员出发间隔 ${seconds(now.service.seconds)} → ${seconds(then.service.seconds)}`)
  }
  const crewsNow = upgradeAt(kind, level)?.crews ?? (kind.service?.service === "fire" ? rules.risk.fire.crews : undefined)
  if (up.crews !== undefined && up.crews !== crewsNow) out.push(`消防员 ${crewsNow ?? 0} → ${up.crews} 人`)
  if (up.deep && !upgradeAt(kind, level)?.deep) out.push("全速开采采空矿面，免受三分之一速度的限制")
  if (up.admin !== undefined) out.push(`行政开支减免 ${Math.round((upgradeAt(kind, level)?.admin ?? 0) * 100)}% → ${Math.round(up.admin * 100)}%`)
  const a = now.appeal, b = then.appeal
  if (b && (!a || a.value !== b.value || a.reach !== b.reach)) out.push(`周围宜居度 ${a ? signed(a.value) : "0"} → ${signed(b.value)}${!a || a.reach !== b.reach ? `，影响 ${b.reach} 格` : ""}`)
  if (now.upkeep !== then.upkeep) out.push(`每分钟维护费 ${now.upkeep} → ${then.upkeep} 金币`)
  return out
}

/** What starting an upgrade costs: coins now, and the materials carriers then bring ("400 coins now · carriers bring 6 planks, 12 stone"). */
export const upgradePrice = (up: Upgrade): string => {
  const carried = costText({ coins: 0, materials: up.cost.materials })
  return `立即支付 ${up.cost.coins} 金币${carried ? ` · 运输员送来 ${carried}` : ""}`
}
