import assert from "node:assert/strict"
import { test } from "node:test"
import { amounts, kinds } from "../src/content.ts"
import { resolveRules } from "../src/rules/config.ts"
import { salvageOf } from "../src/rules/salvage.ts"
import { district } from "../tools/balance/scenario.ts"
import { fixture } from "../tools/balance/verify/fixture.ts"

const setup = () => {
  const rules = resolveRules(), scenario = district("salvage-storage", [], ["warehouse", "granary", "farm"], false, rules)
  const town = fixture(scenario, rules)
  town.change(s => {
    for (const e of s.entities) {
      const inv = e.components["Town/Inventory"]
      if (inv) inv.stock = amounts({})
    }
  })
  return { town, scenario }
}

test("demolishing an empty warehouse returns its materials to surviving storage", () => {
  const { town, scenario } = setup(), warehouse = scenario.buildings.find(b => b.kind === "warehouse")!
  // The warehouse has most room, but will disappear along with anything put in it.
  town.change(s => {
    const hall = s.entities.find(e => e.components["Town/TownHall"])!.components["Town/Inventory"]
    hall.stock.planks = 10; hall.stock.stone = 10
  })
  town.edit({ type: "remove", cell: warehouse.tile }); town.run(0.5)
  const after = town.snapshot(), back = salvageOf(kinds.warehouse.cost).back
  const hall = after.entities.find(e => e.components["Town/TownHall"])!.components["Town/Inventory"]
  for (const [g, n] of Object.entries(back)) assert.equal(hall.stock[g], 10 + n!, g)
  assert(!after.entities.some(e => e.id === warehouse.id))
  assert(after.entities.filter(e => e.components["Town/Inventory"]).every(e => {
    const inv = e.components["Town/Inventory"]
    return Object.entries(inv.stock).every(([g, n]) => !n || inv.accepts.includes(g))
  }))
})

test("salvage never puts construction materials in a food-only granary", () => {
  const { town, scenario } = setup(), farm = scenario.buildings.find(b => b.kind === "farm")!
  town.change(s => {
    const hall = s.entities.find(e => e.components["Town/TownHall"])!.components["Town/Inventory"]
    hall.stock.planks = hall.cap; hall.stock.stone = hall.cap
    s.entities.find(e => e.components["Town/Building"]?.kind === "warehouse")!.components["Town/Inventory"].stock = { ...hall.stock }
  })
  town.edit({ type: "remove", cell: farm.tile }); town.run(0.5)
  const granary = town.snapshot().entities.find(e => e.components["Town/Building"]?.kind === "granary")!.components["Town/Inventory"]
  assert.equal(granary.stock.planks, 0); assert.equal(granary.stock.stone, 0)
})
