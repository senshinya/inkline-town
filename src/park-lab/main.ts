import * as THREE from "three"
import { assetById } from "../asset-lab/assets.ts"
import { buildAsset, type BuiltAsset } from "../asset-lab/renderer.ts"
import { builtPark, parkCells, parkSummary } from "./park.ts"
import "./style.css"

const assets={park:builtPark(),fountain:assetById.get("park-fountain")!,statue:assetById.get("park-statue")!}
type View=keyof typeof assets
const root=document.querySelector<HTMLElement>("#park-lab")!
root.innerHTML=`<header><a href="/model-review.html?collection=ornaments">墨线小镇 · 公园</a><a href="/asset-lab.html?asset=park-sample">完整图鉴 ↗</a></header><section class="intro"><h1>一格一格，建起公园。</h1><p>草坪、花坛与小径连接两个街道入口。喷泉与朴素的石制半身像构成公园中心。</p></section><nav aria-label="公园预览视角"><button data-view="park" aria-pressed="true">完整公园</button><button data-view="fountain" aria-pressed="false">喷泉特写</button><button data-view="statue" aria-pressed="false">雕像特写</button></nav><section class="controls"><label>旋转 <input aria-label="公园旋转" type="range" min="-180" max="180" value="0"><output>0°</output></label><label>视角 <select aria-label="公园仰角"><option value="30">街道视角</option><option value="55">俯视</option><option value="15">近地视角</option></select></label><button id="rear">查看背面</button><button id="pause">暂停流水</button><button id="reset">重置视角</button></section><section class="stage" aria-label="公园渲染画面"></section><footer><div><h2 id="title"></h2><p id="note"></p></div><span id="summary">25 格公园 · 2 个入口 · 3 盏路灯</span></footer>`
const stage=root.querySelector<HTMLElement>(".stage")!,renderer=new THREE.WebGLRenderer({alpha:true,antialias:true,preserveDrawingBuffer:true}),scene=new THREE.Scene(),camera=new THREE.OrthographicCamera(-100,100,100,-100,0.1,4000)
renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setClearColor(0xf0f2ec,0);renderer.outputColorSpace=THREE.SRGBColorSpace;stage.append(renderer.domElement)
let view:View="park",yaw=0,pitch=30,time=0,paused=false,last=0,frames=0,built:BuiltAsset|null=null,bounds=new THREE.Box3()
function aim(width:number,height:number){
  const target=bounds.getCenter(new THREE.Vector3()),heading=(45+yaw)*Math.PI/180,altitude=pitch*Math.PI/180
  camera.position.copy(target).add(new THREE.Vector3(Math.sin(heading)*Math.cos(altitude),Math.sin(altitude),Math.cos(heading)*Math.cos(altitude)).multiplyScalar(1000));camera.lookAt(target);camera.updateMatrixWorld(true)
  let x=1,y=1
  for(const u of [bounds.min.x,bounds.max.x])for(const v of [bounds.min.y,bounds.max.y])for(const z of [bounds.min.z,bounds.max.z]){
    const p=new THREE.Vector3(u,v,z).applyMatrix4(camera.matrixWorldInverse);x=Math.max(x,Math.abs(p.x));y=Math.max(y,Math.abs(p.y))
  }
  const half=Math.max(y,x*height/width)*1.12
  camera.top=half;camera.bottom=-half;camera.left=-half*width/height;camera.right=-camera.left;camera.updateProjectionMatrix()
  built!.updateContours(camera)
}
function draw(width=stage.clientWidth,height=stage.clientHeight){
  renderer.setSize(width,height,false);aim(width,height);built!.updateEffects(time);renderer.render(scene,camera);frames++
}
function select(next:View){
  built?.group.removeFromParent();built?.dispose();view=next;built=buildAsset(assets[view],{batchFaces:true});scene.add(built.group);bounds=new THREE.Box3().setFromObject(built.group)
  root.querySelectorAll<HTMLButtonElement>("nav button").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.view===view)))
  root.querySelector("#title")!.textContent=view==="park"?"二十五格，一座公园":view==="fountain"?"流动的水":"奠基者的石像"
  root.querySelector("#note")!.textContent=view==="park"?assets.park.note:view==="fountain"?"水流从柱顶涌出，落入水池，泛起轻柔涟漪。":"头部、双肩与基座，即使缩小到游戏尺寸，轮廓仍然清晰。"
  root.querySelector<HTMLElement>("#summary")!.hidden=view!=="park";draw()
  history.replaceState(null,"",`?view=${view}`)
}
function capture(t=time,width=960,height=700){
  time=t;renderer.setPixelRatio(1);renderer.setClearAlpha(1);draw(width,height);const image=renderer.domElement.toDataURL();renderer.setClearAlpha(0);renderer.setPixelRatio(Math.min(devicePixelRatio,2));draw();return image
}
root.querySelectorAll<HTMLButtonElement>("nav button").forEach(b=>b.onclick=()=>select(b.dataset.view as View))
root.querySelector<HTMLInputElement>("input")!.oninput=e=>{yaw=Number((e.target as HTMLInputElement).value);root.querySelector("output")!.textContent=`${yaw}°`;draw()}
root.querySelector<HTMLSelectElement>("select")!.onchange=e=>{pitch=Number((e.target as HTMLSelectElement).value);draw()}
root.querySelector<HTMLButtonElement>("#rear")!.onclick=()=>{yaw=yaw===180?0:180;root.querySelector<HTMLInputElement>("input")!.value=String(yaw);root.querySelector("output")!.textContent=`${yaw}°`;draw()}
root.querySelector<HTMLButtonElement>("#reset")!.onclick=()=>{yaw=0;pitch=30;root.querySelector<HTMLInputElement>("input")!.value="0";root.querySelector<HTMLSelectElement>("select")!.value="30";root.querySelector("output")!.textContent="0°";draw()}
root.querySelector<HTMLButtonElement>("#pause")!.onclick=e=>{paused=!paused;(e.target as HTMLButtonElement).textContent=paused?"恢复流水":"暂停流水"}
let drag:{x:number;yaw:number}|null=null
stage.onpointerdown=e=>{drag={x:e.clientX,yaw};stage.setPointerCapture(e.pointerId)}
stage.onpointermove=e=>{if(drag){yaw=((drag.yaw+(e.clientX-drag.x)*0.4+540)%360)-180;root.querySelector<HTMLInputElement>("input")!.value=String(yaw);root.querySelector("output")!.textContent=`${Math.round(yaw)}°`;draw()}}
stage.onpointerup=stage.onpointercancel=()=>{drag=null}
const initial=new URLSearchParams(location.search).get("view")
select(initial&&Object.hasOwn(assets,initial)?initial as View:"park")
renderer.setAnimationLoop(now=>{if(!paused&&last)time+=Math.min((now-last)/1000,0.1);last=now;draw()})
Object.assign(window,{parkLab:{capture,pause:()=>{paused=true},stats:()=>({view,yaw,pitch,time,frames,fountains:assets[view].fountains?.length??0,parkCells:parkCells.length,entrances:parkSummary.entrances,triangles:renderer.info.render.triangles})}})
if(import.meta.hot)import.meta.hot.dispose(()=>{renderer.setAnimationLoop(null);built?.dispose();renderer.dispose()})
