import { buildingDimensions, makeBuilding } from "./buildings.ts"
import { dressedBuilding, scaffoldAsset } from "./upgrade-dress.ts"
import type { InkAsset } from "./primitives.ts"
import { civicEave } from "./civic.ts"

export function upgradeCatalogue(): InkAsset[] {
  const upgrades = ([
    ["townhall", 1, "guildhall", "行会大厅", "陡顶行会建筑，配有高钟楼、石制阳台、屋顶窗与悬挂的行会旗帜。"],
    ["townhall", 2, "cityhall", "城市政厅", "穹顶市政建筑，配有低矮侧翼、角亭、礼仪台阶与柱廊门厅。"],
    ["warehouse", 1, "depot", "货运仓库", "加固龙门吊横跨装卸场，滑轮和吊货位于院落内部。"],
    ["bakery", 1, "ovenworks", "烘焙工坊", "敞开烤炉后方的烘焙房增设第二根砖砌烟道。"],
    ["quarry", 1, "masonry", "石工作坊", "开放采石院内设有坚固木制吊架与加工石块。"],
    ["farm", 1, "estate", "庄园", "农场空余院落中增设架高鸽舍与开放干草棚。"],
    ["firewatch", 1, "fire-brigade", "消防队", "原有警钟瞭望台增配手动水泵与带轮水带车。"]
  ] as const).map(([kind, level, id, title, note]) => ({
    ...dressedBuilding(kind, level, makeBuilding(kind), buildingDimensions(kind).height),
    id, title, note, reference: { type: "none" } as const
  }))
  const stages = [0.15, 0.5, 0.9].map(share => {
    const base = makeBuilding("townhall"), frame = scaffoldAsset(3, buildingDimensions("townhall").height, share)
    return { ...base, id: `upgrade-works-${Math.round(share * 100)}`, title: `建材送达进度 · ${Math.round(share * 100)}%`,
      note: "共用脚手架单元、工作平台、梯子、帆布围挡与运抵建材。", reference: { type: "none" } as const,
      faces: [...base.faces, ...frame.faces], strokes: [...base.strokes, ...frame.strokes] }
  })
  const examples = ([
    ["carpenter",0,.5], ["warehouse",0,.65], ["quarry",0,.5],
    ["farm",0,.75], ["townhall",1,.5], ["townhall",2,.9]
  ] as const).map(([kind,level,share]) => {
    const base=level?upgrades.find(a=>a.id===(level===1?"guildhall":"cityhall"))!:makeBuilding(kind)
    const height=kind==="townhall"&&level>0?civicEave(level):buildingDimensions(kind).height
    const frame=scaffoldAsset(base.footprint!,height,share)
    return {...base,id:`works-${kind}-${level}`,title:`${base.title} · 施工中`,
      note:"共用施工绘制函数，仅依据占地、建筑高度与建材送达比例生成。",reference:{type:"none"} as const,
      faces:[...base.faces,...frame.faces],strokes:[...base.strokes,...frame.strokes]}
  })
  return [...upgrades, ...stages, ...examples]
}
