import * as THREE from "three"
import { assetById } from "./assets.ts"
import { buildAsset, exportAsset, floorScale, vertex3 } from "./renderer.ts"
import "./service-study.css"

const root = document.querySelector<HTMLElement>("#service-study")!
root.innerHTML = `
  <header><a href="/">墨线小镇</a><span>建筑研究 / 02</span></header>
  <section class="intro"><p class="eyebrow">城镇仍在生长</p><h1>熟悉的小镇，<br>渐成规模。</h1><p>两款服务建筑升级模型，延续浅色石材与墨线风格。<br>升级前后均占 2×2 格，四个模型使用相同比例展示。</p></section>
  <nav class="study-controls" aria-label="模型视角控制">
    <button id="reset">初始视角</button><button id="back">查看背面</button>
    <label>旋转 <input id="heading" type="range" min="-180" max="180" value="0"><output id="heading-value">0°</output></label>
    <label>俯仰 <input id="tilt" type="range" min="15" max="65" value="30"><output id="tilt-value">30°</output></label>
    <button id="scale" aria-pressed="false">街道尺度</button>
  </nav>
  <section class="family" aria-labelledby="market-heading"><div class="family-heading"><h2 id="market-heading">交易之所</h2><p>条纹摊位，变成有顶大厅。</p></div><div class="model-pair">
    ${card("market", "01", "市场", "熟悉的条纹摊位与货场。")}
    ${card("market-hall", "02", "市场大厅", "坡屋顶、带顶拱廊与楼上窗户，保留标志性的条纹。")}
  </div></section>
  <section class="family" aria-labelledby="chapel-heading"><div class="family-heading"><h2 id="chapel-heading">相聚之所</h2><p>小穹顶，变成完整的钟楼。</p></div><div class="model-pair">
    ${card("chapel", "01", "教堂", "蓝色玻璃、浅色墙面与原有的小穹顶。")}
    ${card("church", "02", "大教堂", "坡顶中殿、石砌扶壁与悬挂铜钟的开放式钟楼。")}
  </div></section>
  <footer><p>拖动任意模型可同步旋转四个视图，在模型上滚动可缩放。</p><div><a href="/asset-lab.html?asset=market-hall">完整模型目录 ↗</a><a href="/map-lab.html">在城镇中查看 ↗</a></div><p class="note">此页仅预览模型，游戏内升级规则尚未接入。</p></footer>
`

function card(id: string, tier: string, title: string, note: string) {
  return `<article class="model-card"><div class="model-label"><span>等级 ${tier}</span><span>占地 2 × 2</span></div><div class="model-view" data-model="${id}" role="img" aria-label="${title}，可旋转的三维模型" tabindex="0"></div><div class="model-caption"><div><h3>${title}</h3><p>${note}</p></div><button data-export="${id}" aria-label="下载${title} GLB 模型">GLB ↓</button></div></article>`
}

let yaw = 0, pitch = 30, zoom = 1, street = false
const heading = root.querySelector<HTMLInputElement>("#heading")!
const tilt = root.querySelector<HTMLInputElement>("#tilt")!
const views = [...root.querySelectorAll<HTMLElement>("[data-model]")].map(view => {
  const asset = assetById.get(view.dataset.model!)!
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true })
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.NoToneMapping
  renderer.setClearColor(0xf0f2ec, 0)
  view.append(renderer.domElement)
  const model = buildAsset(asset, { batchFaces: true })
  const scene = new THREE.Scene()
  scene.add(model.group)
  const camera = new THREE.OrthographicCamera(-130, 130, 130, -130, 0.1, 4000)
  let drag: { x: number; y: number } | null = null
  view.onpointerdown = e => { drag = { x: e.clientX, y: e.clientY }; view.setPointerCapture(e.pointerId) }
  view.onpointermove = e => {
    if (!drag) return
    yaw = THREE.MathUtils.euclideanModulo(yaw + (e.clientX - drag.x) * 0.6 + 180, 360) - 180
    pitch = Math.max(15, Math.min(65, pitch + (e.clientY - drag.y) * 0.25))
    drag = { x: e.clientX, y: e.clientY }
    render()
  }
  view.onpointerup = view.onpointercancel = view.onlostpointercapture = () => { drag = null }
  view.addEventListener("wheel", e => {
    e.preventDefault()
    zoom = Math.max(0.65, Math.min(1.75, zoom * Math.exp(-e.deltaY * 0.001)))
    render()
  }, { passive: false })
  view.onkeydown = e => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home"].includes(e.key)) return
    e.preventDefault()
    if (e.key === "Home") { yaw = 0; pitch = 30; zoom = 1 }
    else if (e.key === "ArrowLeft" || e.key === "ArrowRight") yaw = THREE.MathUtils.euclideanModulo(yaw + (e.key === "ArrowLeft" ? -15 : 15) + 180, 360) - 180
    else pitch = Math.max(15, Math.min(65, pitch + (e.key === "ArrowUp" ? 5 : -5)))
    render()
  }
  return { id: asset.id, view, renderer, model, scene, camera }
})

function render() {
  heading.value = String(yaw)
  tilt.value = String(pitch)
  root.querySelector("#heading-value")!.textContent = `${Math.round(yaw)}°`
  root.querySelector("#tilt-value")!.textContent = `${Math.round(pitch)}°`
  for (const { view, renderer, model, scene, camera } of views) {
    const width = view.clientWidth, height = view.clientHeight
    if (!width || !height) continue
    renderer.setSize(width, height, false)
    // Shared projection and ground target keep tier height differences honest.
    const span = (street ? 335 : 195) / zoom
    camera.left = -span * width / height / 2
    camera.right = -camera.left
    camera.top = span / 2
    camera.bottom = -camera.top
    const target = vertex3([0, 0, 49])
    const angle = THREE.MathUtils.degToRad(45 + yaw), altitude = THREE.MathUtils.degToRad(pitch)
    camera.position.set(target.x + Math.cos(angle) * 700 * Math.cos(altitude), target.y + 700 * Math.sin(altitude), target.z + Math.sin(angle) * 700 * Math.cos(altitude))
    camera.lookAt(target)
    camera.updateProjectionMatrix()
    for (const { material, width } of model.lineMaterials) material.linewidth = width
    model.updateContours(camera)
    renderer.render(scene, camera)
  }
}

heading.oninput = () => { yaw = Number(heading.value); render() }
tilt.oninput = () => { pitch = Number(tilt.value); render() }
root.querySelector<HTMLButtonElement>("#reset")!.onclick = () => { yaw = 0; pitch = 30; zoom = 1; render() }
root.querySelector<HTMLButtonElement>("#back")!.onclick = () => { yaw = yaw === -180 ? 0 : -180; render() }
root.querySelector<HTMLButtonElement>("#scale")!.onclick = e => {
  street = !street
  ;(e.currentTarget as HTMLButtonElement).setAttribute("aria-pressed", String(street))
  render()
}
for (const button of root.querySelectorAll<HTMLButtonElement>("[data-export]")) button.onclick = async () => {
  const asset = assetById.get(button.dataset.export!)!
  const blob = new Blob([await exportAsset(asset)], { type: "model/gltf-binary" })
  const url = URL.createObjectURL(blob), a = document.createElement("a")
  a.href = url; a.download = `inkline-${asset.id}.glb`; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
const observer = new ResizeObserver(render)
views.forEach(({ view }) => observer.observe(view))
render()
Object.assign(window, { serviceStudy: {
  rotate: (angle: number, elevation = 30) => { yaw = angle; pitch = elevation; render() },
  stats: () => ({ yaw, pitch, street, scale: floorScale, models: views.map(v => ({ id: v.id, triangles: v.renderer.info.render.triangles })) }),
  capture: (id: string) => views.find(v => v.id === id)!.renderer.domElement.toDataURL("image/png")
} })
if (import.meta.hot) import.meta.hot.dispose(() => {
  observer.disconnect()
  views.forEach(({ renderer, model }) => { model.dispose(); renderer.dispose() })
})
