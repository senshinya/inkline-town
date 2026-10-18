import { assetById } from "../asset-lab/assets.ts"
import { Drawing, type InkAsset, type Vertex } from "../asset-lab/primitives.ts"
import { bench, flowerBed, parkAsset } from "../asset-lab/town-props.ts"
import { builtPark } from "../park-lab/park.ts"
import { key } from "../grid.ts"
import type { GroundId } from "../content.ts"

export function parkReviewModels(): InkAsset[] {
  const models=["park-lamp","park-statue","park-fountain"].map(id=>assetById.get(id)!)
  for(const [id,title,draw] of [["park-bench","公园长椅",bench],["park-border","花境",flowerBed]] as const){
    const d=new Drawing(id,title,"共用公园设施，以未改变的人物比例展示。")
    draw(d,0,0);d.asset.category="land";d.asset.footprint=1;models.push(d.asset)
  }
  for(const [ground,title] of [["lawn","草坪与座椅"],["flowers","花坛"],["path","碎石小径"],["square","石铺广场"]] as const satisfies ReadonlyArray<readonly[GroundId,string]>){
    const cells=new Map([[key(0,0),{x:0,y:0,ground,prop:"none" as const}]])
    const roads=ground==="path"||ground==="lawn"?new Set([key(0,1)]):new Set<number>()
    const asset=parkAsset(cells,roads),shift=([u,v,z]:Vertex):Vertex=>[u-.5,v-.5,z]
    models.push({...asset,id:`park-${ground}`,title,footprint:1,faces:asset.faces.map(f=>({...f,points:f.points.map(shift)})),strokes:asset.strokes.map(s=>({...s,points:s.points.map(shift)}))})
  }
  const join=parkAsset(new Map([[key(0,0),{x:0,y:0,ground:"path",prop:"none"}]]),new Set([key(-1,0),key(1,0),key(0,-1),key(0,1)]))
  const shift=([u,v,z]:Vertex):Vertex=>[u-.5,v-.5,z]
  models.push({...join,id:"park-junction",title:"相连小径",footprint:1,faces:join.faces.map(f=>({...f,points:f.points.map(shift)})),strokes:join.strokes.map(s=>({...s,points:s.points.map(shift)}))})
  models.push(assetById.get("park-sample")!,builtPark())
  return models
}
