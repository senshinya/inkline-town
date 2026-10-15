import * as THREE from "three"
import { assetById } from "../asset-lab/assets.ts"
import { buildAsset, exportAsset } from "../asset-lab/renderer.ts"
import { kindIds } from "../content.ts"
import { ruralIds } from "../asset-lab/rural.ts"
import "./style.css"

const families = {
  town: { title: "全部建筑", ids: [...kindIds, "market-hall", "church"] },
  rural: { title: "细节修订", ids: ruralIds },
  trades: { title: "贸易与生产建筑", ids: ["mill", "warehouse", "fishery", "bakery", "weaver", "watchhouse"] },
  workshops: { title: "工坊组", ids: ["mine", "smithy", "sawmill", "townhall"] },
  fixes: { title: "修订模型", ids: ["mill","bakery","weaver","warehouse","mine","farm","chapel","hospital","smokehouse","builder","townhouse","quarry","stone-full","stone-quarried","ore-full","ore-quarried","stone-full-2x1","stone-full-2x2","stone-full-3x3","ore-full-2x1","ore-full-2x2","ore-full-3x3","problem-marker","smoke","firewatch"] },
  buildings: { title: "建筑", ids: ["granary", "smokehouse", "firewatch", "healer", "hospital", "watchhouse", "builder"] },
  ornaments: { title: "公园", ids: ["park-sample", "park-lamp", "park-fountain", "park-statue", "paved-street"] },
  homes: { title: "住宅与街区", ids: ["cottage", "citizen", "townhouse", "cottage-fine", "citizen-fine", "townhouse-fine", "cottage-poor", "citizen-worn", "townhouse-worn"] },
  winter: { title: "冬季", ids: ["cottage-winter", "citizen-winter", "townhouse-winter", "granary-winter", "smokehouse-winter", "firewatch-winter", "healer-winter", "hospital-winter", "watchhouse-winter", "builder-winter"] },
  hazards: { title: "废墟", ids: ["ruin-burnt-1", "ruin-collapsed-1", "ruin-derelict-1"] },
  people: { title: "人物与货物", ids: ["service-watchman", "service-firefighter", "service-physician", "service-constable", "service-builder", "goods-smoked", "cart-smoked-4", "barrow-smoked-4"] },
  wear: { title: "建筑状况", ids: ["granary-worn", "smokehouse-worn", "firewatch-worn", "healer-worn", "hospital-worn", "watchhouse-worn", "builder-worn"] },
  upgrades: { title: "建筑升级与采空矿面", ids: ["market", "market-hall", "chapel", "church", "stone-full", "stone-quarried", "stone-worked", "ore-full", "ore-quarried", "ore-worked"] }
} as const
type Family = keyof typeof families
const introductions: Partial<Record<Family, { heading: string; eyebrow: string; description: string; aside: string }>> = {
  town: { heading: "整座小镇，<br>同样的墨线。", eyebrow: "完整建筑集合", description: "包含全部建筑，以及市场大厅和大教堂。对比轮廓、旋转整组模型，或打开单栋建筑查看细节。", aside: `${kindIds.length} 种建筑<br>2 款升级模型<br><span>工作院落、生产作坊、<br>仓储与公共服务。</span>` },
  rural: { heading: "细微之处，<br>小镇更生动。", eyebrow: "建筑细节修订", description: "木制入口、苗床、农场细节、简洁的教堂与连通的消防站瞭望台，一起查看九款修订模型。", aside: "9 款修订建筑<br>保留原有占地<br><span>连通的结构、<br>清晰的入口与实用院落。</span>" },
  workshops: { heading: "留出工作空间，<br>延续墨线风格。", eyebrow: "第一组建筑", description: "围绕工具布置的开放院落，以及市政厅的公共入口。旋转模型查看工作空间。", aside: "4 款修订建筑<br>3 处开放院落<br><span>保留原有占地，以浅色表面、<br>细墨线和工作器具呈现。</span>" },
  trades: { heading: "各有所用，<br>同样的墨线。", eyebrow: "第二组建筑", description: "装卸平台、渔网、敞开的烤炉与织机，从各个角度查看设备和入口。", aside: "6 款修订建筑<br>保留原有占地<br><span>木制装卸门、开放作业间、<br>各行业的工作设备。</span>" }
}
const root = document.querySelector<HTMLElement>("#review")!
root.innerHTML = `<header><a href="/">墨线小镇</a><span>城镇模型预览</span><a href="/map-lab.html">城镇地图 ↗</a></header>
  <section class="intro"><div><p class="eyebrow">让城镇更有生机</p><h1>新的街景。<br>熟悉的墨线。</h1><p>成组查看模型并旋转视角，也可打开单个模型查看细节。</p></div><aside>7 种建筑<br>3 种公园设施<br>3 个住宅等级<br><span>还有人物、灾害、石铺道路、<br>积雪与磨损效果。</span></aside></section>
  <nav aria-label="模型合集"></nav><section class="camera"><label>旋转模型 <input aria-label="模型旋转" type="range" min="-180" max="180" value="0"><output>0°</output></label><button id="rear">查看背面</button><button id="reset">重置视角</button><button id="sheet">保存模型总览图</button><a id="sheet-link" hidden download>下载总览图 ↗</a><label>视角 <select aria-label="视角仰角"><option value="30">街道视角</option><option value="50">俯视</option><option value="15">近地视角</option></select></label></section>
  <section class="grid" aria-label="3D 模型"></section><footer><a href="/park-lab.html">公园布局与流水 ↗</a> · <a href="/effects-lab.html">住宅动态特效 ↗</a> · 拖动模型旋转整组视角 · <a href="/asset-lab.html">完整模型图鉴 ↗</a> · <a href="/">进入游戏 ↗</a></footer>`
const nav = root.querySelector("nav")!, grid = root.querySelector<HTMLElement>(".grid")!, rotation = root.querySelector<HTMLInputElement>("input")!, elevation = root.querySelector<HTMLSelectElement>("select")!
const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true })
renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.setClearColor(0xf0f2ec, 0); renderer.setScissorTest(true)
renderer.domElement.className = "models"; document.body.append(renderer.domElement)
let family: Family = "buildings", yaw = 0, pitch = 30, renders = 0
let sheetUrl = ""
let models: Array<{ scene: THREE.Scene; camera: THREE.OrthographicCamera; built: ReturnType<typeof buildAsset>; view: HTMLElement; center: THREE.Vector3; size: THREE.Vector3 }> = []
// Include both the tower height and the ground plane projected into the view.
// Taking only the larger dimension clips the mill's foreground at street angle.
function viewHeight(size: THREE.Vector3, heading: number, angle: number, aspect: number) {
  const width = Math.abs(Math.cos(heading)) * size.x + Math.abs(Math.sin(heading)) * size.z
  const depth = Math.abs(Math.sin(heading)) * size.x + Math.abs(Math.cos(heading)) * size.z
  const height = Math.abs(Math.cos(angle)) * size.y + Math.abs(Math.sin(angle)) * depth
  return Math.max(height, width / aspect, 18) * 1.12
}
function render() {
  renderer.setSize(innerWidth, innerHeight, false)
  renderer.setScissorTest(false); renderer.clear(); renderer.setScissorTest(true)
  for (const model of models) {
    const r = model.view.getBoundingClientRect()
    if (r.bottom <= 0 || r.top >= innerHeight) continue
    const heading = (45 + yaw) * Math.PI / 180, angle = pitch * Math.PI / 180,
      vertical = viewHeight(model.size, heading, angle, r.width / r.height), camera = model.camera
    camera.top = vertical / 2; camera.bottom = -camera.top; camera.left = -vertical * r.width / r.height / 2; camera.right = -camera.left
    camera.position.copy(model.center).add(new THREE.Vector3(Math.sin(heading) * Math.cos(angle), Math.sin(angle), Math.cos(heading) * Math.cos(angle)).multiplyScalar(1000))
    camera.lookAt(model.center); camera.updateProjectionMatrix(); camera.updateMatrixWorld()
    model.built.updateContours(camera)
    model.built.updateEffects(performance.now()/1000)
    renderer.setViewport(r.left, innerHeight - r.bottom, r.width, r.height)
    renderer.setScissor(Math.max(0, r.left), Math.max(0, innerHeight - r.bottom), Math.min(innerWidth, r.right) - Math.max(0, r.left), Math.min(innerHeight, r.bottom) - Math.max(0, r.top))
    renderer.render(model.scene, camera)
  }
  root.querySelector("output")!.textContent = `${Math.round(yaw)}°`; rotation.value = String(yaw); renders++
}
function select(next: Family) {
  if (sheetUrl) URL.revokeObjectURL(sheetUrl)
  sheetUrl = ""; root.querySelector<HTMLAnchorElement>("#sheet-link")!.hidden = true
  family = next; models.forEach(m => m.built.dispose()); models = []; grid.replaceChildren()
  const intro = introductions[family] ?? { heading: "新的街景。<br>熟悉的墨线。", eyebrow: "让城镇更有生机", description: "成组查看模型并旋转视角，也可打开单个模型查看细节。", aside: "7 种建筑<br>3 种公园设施<br>3 个住宅等级<br><span>还有人物、灾害、石铺道路、<br>积雪与老化痕迹。</span>" }
  root.querySelector(".intro h1")!.innerHTML = intro.heading
  root.querySelector(".eyebrow")!.textContent = intro.eyebrow
  root.querySelector(".intro > div > p:last-child")!.textContent = intro.description
  root.querySelector(".intro aside")!.innerHTML = intro.aside
  for (const [i, id] of families[family].ids.entries()) {
    const asset = assetById.get(id)!
    if (!asset) throw new Error(`Missing review model: ${id}`)
    const card = document.createElement("article")
    card.innerHTML = `<div class="card-top"><span>${String(i + 1).padStart(2, "0")}</span><a href="/asset-lab.html?asset=${id}">查看详情 ↗</a></div><div class="model-view" role="img" aria-label="${asset.title} 3D 模型"></div><div class="caption"><h2>${asset.title}</h2><p>${asset.note}</p><button class="export">下载 GLB</button></div>`
    grid.append(card)
    const built = buildAsset(asset, {batchFaces: true}), scene = new THREE.Scene(), camera = new THREE.OrthographicCamera(-100, 100, 100, -100, 0.1, 4000)
    scene.add(built.group); scene.updateMatrixWorld(true)
    const bounds = new THREE.Box3().setFromObject(built.group)
    models.push({built, scene, camera, view: card.querySelector<HTMLElement>(".model-view")!, center: bounds.getCenter(new THREE.Vector3()), size: bounds.getSize(new THREE.Vector3())})
    card.querySelector<HTMLButtonElement>(".export")!.onclick = async () => {
      const url = URL.createObjectURL(new Blob([await exportAsset(asset)], {type: "model/gltf-binary"})), a = document.createElement("a")
      a.href = url; a.download = `inkline-${id}.glb`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
    }
  }
  nav.querySelectorAll("button").forEach(b => { b.setAttribute("aria-pressed", String(b.dataset.family === next)) })
  history.replaceState(null, "", `?collection=${next}`); render()
}
for (const [id, group] of Object.entries(families)) {
  const b = document.createElement("button"); b.textContent = group.title; b.dataset.family = id; b.onclick = () => select(id as Family); nav.append(b)
}
rotation.oninput = () => { yaw = Number(rotation.value); render() }
elevation.onchange = () => { pitch = Number(elevation.value); render() }
root.querySelector<HTMLButtonElement>("#rear")!.onclick = () => { yaw = yaw === 180 ? 0 : 180; render() }
root.querySelector<HTMLButtonElement>("#reset")!.onclick = () => { yaw = 0; pitch = 30; elevation.value = "30"; render() }
root.querySelector<HTMLButtonElement>("#sheet")!.onclick = () => {
  const canvas = document.createElement("canvas"), ctx = canvas.getContext("2d")!, columns = 3, width = 400, height = 350
  canvas.width = columns * width; canvas.height = 100 + Math.ceil(models.length / columns) * height
  ctx.fillStyle = "#f0f2ec"; ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = "#3d4943"; ctx.font = "30px Georgia"; ctx.fillText(`墨线小镇 / ${families[family].title}`, 30, 48)
  ctx.font = "13px monospace"; ctx.fillText(`墨线小镇 · 旋转 ${Math.round(yaw)}° · 仰角 ${pitch}°`, 30, 76)
  renderer.setSize(width, 270, false); renderer.setScissorTest(false)
  models.forEach((model, i) => {
    const camera = model.camera, heading = (45 + yaw) * Math.PI / 180, angle = pitch * Math.PI / 180,
      vertical = viewHeight(model.size, heading, angle, width / 270)
    camera.top = vertical / 2; camera.bottom = -camera.top; camera.left = -vertical * width / 270 / 2; camera.right = -camera.left
    camera.position.copy(model.center).add(new THREE.Vector3(Math.sin(heading) * Math.cos(angle), Math.sin(angle), Math.cos(heading) * Math.cos(angle)).multiplyScalar(1000))
    camera.lookAt(model.center); camera.updateProjectionMatrix(); camera.updateMatrixWorld(); model.built.updateContours(camera)
    model.built.updateEffects(performance.now()/1000)
    renderer.setViewport(0, 0, width, 270); renderer.render(model.scene, camera)
    const x = (i % columns) * width, y = 100 + Math.floor(i / columns) * height
    ctx.drawImage(renderer.domElement, x, y, width, 270)
    ctx.fillStyle = "#3d4943"; ctx.font = "21px Georgia"; ctx.fillText(assetById.get(families[family].ids[i]!)!.title, x + 24, y + 305)
    ctx.strokeStyle = "#cbd1c5"; ctx.strokeRect(x + 12, y + 8, width - 24, height - 20)
  })
  render()
  canvas.toBlob(blob => {
    if (!blob) return
    if (sheetUrl) URL.revokeObjectURL(sheetUrl)
    sheetUrl = URL.createObjectURL(blob)
    const link = root.querySelector<HTMLAnchorElement>("#sheet-link")!
    link.href = sheetUrl; link.download = `inkline-${family}-review.png`; link.hidden = false
  })
}
let drag: { x: number; yaw: number } | null = null
grid.onpointerdown = e => { if (!(e.target as HTMLElement).classList.contains("model-view")) return; drag = {x: e.clientX, yaw}; grid.setPointerCapture(e.pointerId) }
grid.onpointermove = e => { if (drag) { yaw = ((drag.yaw + (e.clientX - drag.x) * 0.5 + 540) % 360) - 180; render() } }
grid.onpointerup = grid.onpointercancel = () => { drag = null }
let frame = 0
const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(render) }
addEventListener("scroll", schedule, {passive: true}); addEventListener("resize", schedule)
const query = new URLSearchParams(location.search).get("collection")
select(query && query in families ? query as Family : "buildings")
let effectFrame=0
const animateEffects=()=>{if(families[family].ids.some(id=>assetById.get(id)?.smokeEffect||assetById.get(id)?.fountains?.length))render();effectFrame=requestAnimationFrame(animateEffects)}
effectFrame=requestAnimationFrame(animateEffects)
Object.assign(window, { townModelReview: { stats: () => ({ family, models: models.length, renders, yaw, pitch }) } })
if (import.meta.hot) import.meta.hot.dispose(() => { cancelAnimationFrame(effectFrame);models.forEach(m => m.built.dispose()); renderer.dispose(); renderer.domElement.remove(); removeEventListener("scroll", schedule); removeEventListener("resize", schedule) })
