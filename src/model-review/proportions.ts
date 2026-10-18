import * as THREE from "three"
import { buildAsset, vertex3 } from "../asset-lab/renderer.ts"
import type { InkAsset } from "../asset-lab/primitives.ts"
import { proportionModels, architectureIds } from "./proportion-models.ts"
import { parkReviewModels } from "./park-models.ts"
import "./proportions.css"

type Baseline = { revision: string; models: InkAsset[]; walker: InkAsset }
const parksMode=new URLSearchParams(location.search).get("collection")==="parks"
const notes: Record<string,string> = {
  cottage:"按人物尺度调整木门与墙高，保留原有的一格占地。",
  citizen:"两层住宅沿用小屋的通行净高，窗户位于新的楼层线之上。",
  townhouse:"三层住宅采用一致的层高和完整入口，保留原有狭长地块。",
  townhall:"缩小层间距与封闭体量，市政入口保留足够通行净高。",
  guildhall:"窗户与阳台细节按人物比例调整，钟楼与陡屋顶仍是地标。",
  cityhall:"侧翼窗户与楼层线更加统一，台阶和栏杆更精细，穹顶依然突出。",
  warehouse:"降低棚屋墙体与装卸设备，保留大型货运入口和院落。",
  depot:"沿用仓库的比例调整，龙门吊为实际货物留出足够净空。",
  granary:"缩小层间距，调整通风口位置，让吊机与上层装卸平台对齐。",
  hospital:"两层公共空间采用一致的窗户与入口尺度，保留病房占地和屋顶采光亭。",
  chapel:"降低礼拜堂主体，保留高挑尖拱窗，小穹顶仍高出屋顶。",
  healer:"缩小诊室主体，将招牌、药罐与候诊长椅放在合适的高度。",
  watchhouse:"降低建筑主体，将观察格栅与公告栏调整至人物高度。",
  market:"缩小商铺主体，提高棚下通行净空，让柜台处于适合工作的高度。",
  "market-hall":"拱廊上方保留可用楼层，加大上层窗户，并统一柜台高度。",
  church:"降低中殿及尖拱窗位置，加高入口，钟楼仍是地标。",
  carpenter:"保留二十单位高的门，将椅面调整至与共用长椅一致的高度，工具仍触手可及。",
  fishery:"加高渔屋入口，增加屋檐下净空，处理鱼获的工作台仍保持腰部高度。",
  bakery:"降低烘焙房与烟道，加高门和遮篷，将招牌移至遮篷之外。",
  weaver:"降低开放棚屋，加高仓储门，织机保留原有工作尺寸。",
  lumberjack:"增加木门上方的棚屋净空，砍伐工具缩小至适合取用的尺寸。",
  forester:"增加门上方的棚屋净空，苗床和树苗尺寸保持不变。",
  farm:"屋顶更浅，谷仓入口更高，保留筒仓和农场院落。",
  sheep:"调整谷仓门、围栏和栅门的尺度，水槽与羊的比例一致。",
  smokehouse:"为入口保留足够净高并缩短烟道，挂鱼和熏制设备仍便于取用。",
  builder:"调整棚屋入口与工作台高度，保留木材架和开放院落。",
  mill:"缩小层间距并保留货运入口，风车翼留有足够运转净空。",
  sawmill:"降低棚屋，将切割机构调至便于操作的高度，原木上方保留净空。",
  smithy:"降低棚屋，缩小锻炉开口并统一工作台高度，烟道仍保持高挑。",
  mine:"保留井架高度，以人物模型核对矿洞、工具与矿车的尺寸。",
  quarry:"降低石工小屋并调整入口净高，岩壁与起重设备保持原高。",
  masonry:"沿用小屋的比例调整，吊架构件更精细，加工石块的尺寸更统一。",
  estate:"沿用谷仓的比例调整，加高干草棚入口，与相同的人物参照匹配。",
  ovenworks:"沿用烘焙房的比例调整，缩短第二根烟道，保留升级后的特征。",
  firewatch:"加高瞭望室以便站立，沿原有通道提高护栏。",
  "fire-brigade":"加高瞭望室与护栏，将水带车把手提高至消防员手部高度。",
  chair:"椅面与共用长椅同高，同时保持紧凑，便于作为家具运送。",
  chest:"以人物模型核对储物箱尺寸，保持适合储物与运输的紧凑体积。",
  bench:"座面与靠背高度和椅子一致，公园及候诊区共用同一绘制函数。",
  "cart-furniture-4":"货车把手仍与人物比例匹配，装载调整后的共用家具模型。",
  "barrow-furniture-4":"独轮车保留原有底架，装载调整后的共用家具模型。",
  "crate-wood":"缩小通用货箱，所有物资标签共用此改动；仓库的大型货物另行绘制。",
  "park-lamp":"加高铸铁路灯杆，配有阶梯底座、带框玻璃灯罩、防雨顶和小型顶饰。",
  "park-statue":"朴素石制半身像，配有宽阔的雕刻肩部、简洁头部与克制的阶梯基座。",
  "park-fountain":"加大带线脚的石制水池，逐块绘制池沿石，并在喷嘴周围抬高碗状池体。",
  "park-bench":"四条座板、后倾的三条靠背板、铁制支架与扶手，座面高度仍为 4.5 单位。",
  "park-border":"石质围边、内嵌土壤、茎叶与独立花朵，和城镇花境共用模型。",
  "park-lawn":"短草坪与更简洁的草丛，小径旁合适的草地上偶尔摆放长椅。",
  "park-flowers":"抬高花坛围边，以不规则的带叶花簇替代平面方块和整齐圆点。",
  "park-path":"带围边的碎石小径，加入小石块，并清晰连接邻近小径和道路。",
  "park-square":"较大的错缝石板、细薄灰缝与低矮精整的边缘。",
  "park-junction":"碎石与围边连接四个道路入口，不遮挡通行。",
  "park-sample":"保留原有二十五格布局，调整设施、花草、铺地与座椅；公园规则和费用不变。",
  "park-built":"保留两条街道之间的相连公园，以人物比例展示流水与调整后的设施。",
}

const root=document.querySelector<HTMLElement>("#proportions")!
root.innerHTML=`<header><div><div class="eyebrow">墨线小镇 / 比例研究</div><h1>一座小镇，统一的人物尺度。</h1><p>对比全部建筑与升级，以及共用家具和施工模型。人物模型保持不变，两侧始终采用相同的镜头、地面位置与缩放。</p></div><div><a href="/model-review.html?collection=handoff">模型目录 ↗</a><p class="status" id="status">正在加载已确认的原始模型……</p></div></header><div class="layout"><aside><input aria-label="查找模型" type="search" placeholder="查找模型……"><select aria-label="模型分组"><option value="all">全部模型</option><option value="architecture">建筑与住宅</option><option value="props">物件与施工</option></select><select aria-label="选择模型"></select><nav aria-label="全部对比模型"></nav></aside><section><div class="row"><button id="previous" aria-label="上一个模型">←</button><h2></h2><button id="next" aria-label="下一个模型">→</button></div><p class="meta" id="note"></p><div class="controls"><label>旋转 <input aria-label="模型旋转" type="range" min="-180" max="180" value="0"><output>0°</output></label><label>仰角 <select aria-label="视角仰角"><option value="30">游戏视角</option><option value="0">平视</option><option value="50">俯视</option></select></label><label>缩放 <input aria-label="缩放" type="range" min=".7" max="2" step=".1" value="1"></label><label><input type="checkbox" id="town-scale"> 所有模型使用统一比例</label><button id="reset">重置视角</button><button id="save">保存对比图</button></div><div class="view"><div class="captions"><span>修改前 · 已确认版本</span><span>修改后 · 调整版本</span></div><div class="divider"></div></div><div class="footer"><span id="dimensions"></span><br>拖动可同步旋转两侧视图，用箭头按钮逐一浏览模型。开启统一比例，可比较整个目录中的建筑大小。<br>修改前的几何数据固定于 <code>a2845b4</code>. 本次调整修改模型几何，不改变镜头缩放。</div></section></div>`
const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true})
if(parksMode){
  document.title="墨线小镇 · 公园修改前后对比"
  root.querySelector(".eyebrow")!.textContent="墨线小镇 / 公园研究"
  root.querySelector("h1")!.textContent="值得驻足的公园。"
  root.querySelector("header p")!.textContent="将全部公园设施、花草与铺地同已确认的原始模型并列对比，人物和镜头保持不变。"
  const groups=root.querySelectorAll("select[aria-label='模型分组'] option")
  groups[1]!.textContent="设施与花草";groups[2]!.textContent="铺地与完整公园"
  root.querySelector(".footer code")!.textContent="f4df9d5"
  root.querySelector(".footer")!.lastChild!.textContent="。调整直接作用于原生模型几何。"
}
renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setClearColor(0xf0f2ec);renderer.setScissorTest(true)
const view=root.querySelector<HTMLElement>(".view")!;view.append(renderer.domElement)
const camera=new THREE.OrthographicCamera(-100,100,100,-100,.1,4000)
const search=root.querySelector<HTMLInputElement>("input[type=search]")!,group=root.querySelector<HTMLSelectElement>("select[aria-label='模型分组']")!,picker=root.querySelector<HTMLSelectElement>("select[aria-label='选择模型']")!,nav=root.querySelector<HTMLElement>("nav")!
const rotation=root.querySelector<HTMLInputElement>("input[aria-label='模型旋转']")!,elevation=root.querySelector<HTMLSelectElement>("select[aria-label='视角仰角']")!,zoom=root.querySelector<HTMLInputElement>("input[aria-label='缩放']")!,townScale=root.querySelector<HTMLInputElement>("#town-scale")!
const geometryBounds=(a:InkAsset)=>new THREE.Box3().setFromPoints([...a.faces,...a.strokes].flatMap(f=>f.points.map(vertex3)))
let before:Baseline,after=parksMode?parkReviewModels():proportionModels(),filtered=after,selected=0,yaw=0,pitch=30,drag:number|null=null
let pair:Array<{scene:THREE.Scene;built:ReturnType<typeof buildAsset>;person:ReturnType<typeof buildAsset>}>=[],bounds=new THREE.Box3()
const clean=(a:InkAsset):InkAsset=>{const {smokeEffect,effects,...geometry}=a;if(!parksMode)delete geometry.fountains;return geometry}

function render(){
  if(!pair.length)return
  const {width,height}=view.getBoundingClientRect(),w=width/2
  renderer.setSize(width,height,false)
  const heading=(45+yaw)*Math.PI/180,angle=pitch*Math.PI/180
  const box=townScale.checked?(parksMode?new THREE.Box3(new THREE.Vector3(-180,-1,-180),new THREE.Vector3(180,70,180)):new THREE.Box3(new THREE.Vector3(-85,-1,-75),new THREE.Vector3(85,170,85))):bounds
  const center=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3())
  const horizontal=Math.abs(Math.cos(heading))*size.x+Math.abs(Math.sin(heading))*size.z
  const vertical=Math.cos(angle)*size.y+Math.abs(Math.sin(angle))*(Math.abs(Math.sin(heading))*size.x+Math.abs(Math.cos(heading))*size.z)
  const extent=Math.max(vertical,horizontal/(w/height))*1.18/Number(zoom.value)
  camera.top=extent/2;camera.bottom=-extent/2;camera.left=-extent*w/height/2;camera.right=-camera.left
  camera.position.copy(center).add(new THREE.Vector3(Math.sin(heading)*Math.cos(angle),Math.sin(angle),Math.cos(heading)*Math.cos(angle)).multiplyScalar(1000))
  camera.lookAt(center);camera.updateProjectionMatrix();camera.updateMatrixWorld()
  pair.forEach(({scene,built,person},i)=>{
    renderer.setViewport(i*w,0,w,height);renderer.setScissor(i*w,0,w,height)
    for(const b of [built,person]){b.updateContours(camera);b.updateEffects(1.2)}
    renderer.render(scene,camera)
  })
  root.querySelector("output")!.textContent=`${yaw}°`
}
function select(id:string){
  const a=after.find(m=>m.id===id)!,b=before.models.find(m=>m.id===id)!
  if(!a||!b)return
  selected=filtered.findIndex(m=>m.id===id)
  pair.forEach(p=>{p.built.dispose();p.person.dispose()});pair=[];bounds=new THREE.Box3()
  const half=Math.max(a.footprint??1,b.footprint??1)/2*32*Math.SQRT2
  const personPosition=new THREE.Vector3(-half-6,0,half+3)
  for(const asset of [b,a]){
    const built=buildAsset(clean(asset),{batchFaces:true}),person=buildAsset(before.walker,{batchFaces:true}),scene=new THREE.Scene()
    person.group.position.copy(personPosition);scene.add(built.group,person.group)
    bounds.union(geometryBounds(asset));bounds.union(geometryBounds(before.walker).translate(personPosition))
    for(const f of parksMode?asset.fountains??[]:[])bounds.expandByPoint(vertex3([f.origin[0],f.origin[1],f.origin[2]+f.nozzle+7]))
    pair.push({scene,built,person})
  }
  root.querySelector("h2")!.textContent=a.title
  root.querySelector("#note")!.textContent=notes[id]??"各建材送达阶段的平台间距、护栏和梯子尺寸，均依据同一人物参照。"
  const top=(asset:InkAsset)=>Math.max(...[...asset.faces,...asset.strokes].flatMap(f=>f.points.map(p=>p[2])))
  const changed=JSON.stringify([a.faces,a.strokes])!==JSON.stringify([b.faces,b.strokes])
  root.querySelector("#dimensions")!.textContent=`${changed?"已调整":"已检查 · 保留原样"} · 模型高度 ${top(b).toFixed(1)} → ${top(a).toFixed(1)} · 占地 ${a.footprint??1} × ${a.footprint??1} 格 · 人物高度 17.1，未变`
  picker.value=id;nav.querySelectorAll("button").forEach(el=>el.setAttribute("aria-current",String(el.dataset.id===id)))
  history.replaceState(null,"",`?${parksMode?"collection=parks&":""}model=${id}`);render()
}
function filter(){
  const q=search.value.toLowerCase()
  filtered=after.filter(a=>(group.value==="all"||(group.value==="architecture")===(parksMode?["park-lamp","park-statue","park-fountain","park-bench","park-border"].includes(a.id):architectureIds.includes(a.id)))&&`${a.title} ${a.id}`.toLowerCase().includes(q))
  picker.replaceChildren();nav.replaceChildren()
  for(const asset of filtered){
    const option=document.createElement("option");option.value=asset.id;option.textContent=asset.title;picker.append(option)
    const button=document.createElement("button");button.textContent=asset.title;button.dataset.id=asset.id;button.onclick=()=>select(asset.id);nav.append(button)
  }
  for(const id of ["previous","next"])root.querySelector<HTMLButtonElement>(`#${id}`)!.disabled=!filtered.length
  picker.disabled=!filtered.length
  if(filtered.length)select(filtered[0]!.id)
  else{
    pair.forEach(p=>{p.built.dispose();p.person.dispose()});pair=[]
    renderer.setScissorTest(false);renderer.clear();renderer.setScissorTest(true)
    root.querySelector("h2")!.textContent="没有匹配的模型"
    root.querySelector("#note")!.textContent="请尝试其他名称或模型分组。"
    root.querySelector("#dimensions")!.textContent=""
  }
}
rotation.oninput=()=>{yaw=Number(rotation.value);render()};elevation.onchange=()=>{pitch=Number(elevation.value);render()};zoom.oninput=render;townScale.onchange=render
search.oninput=filter;group.onchange=filter;picker.onchange=()=>select(picker.value)
root.querySelector<HTMLButtonElement>("#previous")!.onclick=()=>select(filtered[(selected-1+filtered.length)%filtered.length]!.id)
root.querySelector<HTMLButtonElement>("#next")!.onclick=()=>select(filtered[(selected+1)%filtered.length]!.id)
root.querySelector<HTMLButtonElement>("#reset")!.onclick=()=>{yaw=0;pitch=30;rotation.value="0";elevation.value="30";zoom.value="1";townScale.checked=false;render()}
root.querySelector<HTMLButtonElement>("#save")!.onclick=()=>{const a=document.createElement("a");a.download=`inkline-${picker.value}-before-after.png`;a.href=renderer.domElement.toDataURL();a.click()}
renderer.domElement.onpointerdown=e=>{drag=e.clientX;renderer.domElement.setPointerCapture(e.pointerId)}
renderer.domElement.onpointermove=e=>{if(drag===null)return;yaw=Math.max(-180,Math.min(180,Math.round(yaw+(e.clientX-drag)*.5)));drag=e.clientX;rotation.value=String(yaw);render()}
renderer.domElement.onpointerup=()=>drag=null
new ResizeObserver(render).observe(view)
async function start(){
  const requested=new URLSearchParams(location.search).get("model")
  const response=await fetch(`/model-review/${parksMode?"parks":"proportions"}-before.json.gz`)
  if(!response.ok)throw new Error(`基准模型加载失败：${response.status}`)
  const bytes=await response.arrayBuffer()
  // Dev servers serve .gz verbatim. Some hosts decompress it automatically.
  const raw=new Uint8Array(bytes)
  before=JSON.parse(raw[0]===31&&raw[1]===139?await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"))).text():new TextDecoder().decode(raw))
  if(before.models.length!==after.length||after.some(a=>!before.models.some(b=>b.id===a.id)))throw new Error("对比目录与冻结的基准版本不匹配")
  filter();if(requested&&after.some(a=>a.id===requested))select(requested)
  root.querySelector("#status")!.textContent=parksMode?"12 组公园对比 · 人物未变":`${architectureIds.length} 款建筑外观 · ${after.length-architectureIds.length} 款共用示例`
  Object.assign(window,{proportionReview:{ids:after.map(a=>a.id),select,render,capture:()=>renderer.domElement.toDataURL(),stats:()=>({id:picker.value,before:before.revision,yaw,pitch,pairs:pair.length})}})
}
start().catch(error=>{root.querySelector("#status")!.textContent=String(error);root.querySelector("#status")!.classList.add("error");console.error(error)})
