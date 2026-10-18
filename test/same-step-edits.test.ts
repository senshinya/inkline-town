/**
 * What is placed and taken back in the same step: ApplyEdits queues the
 * spawn, so no query sees it yet, and pulling it down (or founding a new
 * town) must despawn it through the id `spawn` returned, not leave it
 * standing off the grid.
 */
import assert from "node:assert/strict"
import { test } from "node:test"

import { goodIds, kinds, step, type CharterValue } from "../src/content.ts"
import { resolveRules } from "../src/rules/config.ts"
import { salvageOf } from "../src/rules/salvage.ts"
import { headless } from "../src/sim/headless.ts"
import { district } from "../tools/balance/scenario.ts"
import { fixture } from "../tools/balance/verify/fixture.ts"

const charter: CharterValue = { size: "small", term: 45, land: "fair", seed: 7 }
const roads = Array.from({ length: 9 }, (_, i) => ({ x: 34 + i, y: 31 }))
const home = { x: 36, y: 30 }

const at = (town: ReturnType<typeof headless>, cell: { readonly x: number; readonly y: number }) =>
  town.snapshot().entities.filter((entity) => {
    const tile = entity.components["Town/Tile"]
    return tile !== undefined && tile.x === cell.x && tile.y === cell.y
  })

test("a home placed and pulled down in the same step is gone", () => {
  const town = headless(charter)
  town.edit({ type: "roads", cells: roads }, { type: "homes", cells: [home] }, { type: "remove", cell: home })
  town.run(step.dt)
  assert.deepEqual(at(town, home), [])
  // The cell is free again: a home can go there next step.
  town.edit({ type: "homes", cells: [home] })
  town.run(step.dt)
  assert.equal(at(town, home).length, 1)
})

test("a new town founded in the same step as a placement keeps nothing of it", () => {
  const fresh = headless(charter)
  fresh.edit({ type: "newTown", charter })
  fresh.run(step.dt)

  const town = headless(charter)
  town.edit({ type: "roads", cells: roads }, { type: "homes", cells: [home] }, { type: "newTown", charter })
  town.run(step.dt)

  assert.equal(town.snapshot().entities.length, fresh.snapshot().entities.length)
  assert.deepEqual(at(town, home), at(fresh, home))
})

test("works begun and cancelled in the same step refund their coins", () => {
  const rules = resolveRules()
  const scenario = district("cancel-new-works", [], ["market"], false, rules)
  const town = fixture(scenario, rules)
  town.change(s => { s.resources["Town/Fate"].rank = 2 })
  const market = scenario.buildings.find(b => b.kind === "market")!
  const before = town.snapshot().resources["Town/Treasury"].coins

  town.edit({ type: "upgrade", cell: market.tile }, { type: "remove", cell: market.tile })
  town.run(step.dt)

  const after = town.snapshot()
  assert.equal(after.resources["Town/Treasury"].coins, before - salvageOf(kinds.market.cost).fee)
  assert.equal(after.entities.some(e => e.id === market.id), false)
})

test("a new home cancelled in the same step refunds its coins without creating materials", () => {
  const town = headless(charter)
  town.edit({ type: "roads", cells: roads })
  town.run(step.dt)
  const before = town.snapshot()

  town.edit({ type: "homes", cells: [home] }, { type: "remove", cell: home })
  town.run(step.dt)

  const after = town.snapshot()
  assert.equal(after.resources["Town/Treasury"].coins, before.resources["Town/Treasury"].coins)
  const stored = (snapshot: typeof before, good: (typeof goodIds)[number]) =>
    snapshot.entities.reduce((n, e) => n + (e.components["Town/Storage"] ? e.components["Town/Inventory"].stock[good] : 0), 0)
  for (const good of goodIds) assert.equal(stored(after, good), stored(before, good), good)
  assert.deepEqual(at(town, home), [])
})
