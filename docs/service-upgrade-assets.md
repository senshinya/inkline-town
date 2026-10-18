# 市场大厅与大教堂模型

市场大厅与大教堂模型已加入目录、预览地图和实际游戏，包括大教堂两侧竖直的木制双开门。达到城镇等级后，可从原建筑详情面板开始升级；先支付金币，再由运输员送来建材，在原占地内施工，完成后切换模型（见 `Kind.upgrade` 与 `Works`）。

## 模型接口

`src/asset-lab/service-upgrades.ts` 导出 `marketHall()`、`church()`，以及：

```ts
serviceBuilding("market", 2) // 市场大厅 market-hall
serviceBuilding("chapel", 2) // 大教堂 church
serviceBuilding("market", 1) // 原有市场
```

升级前后均占地 2×2 格。目录引用为 `{ type: "building", kind: "market" | "chapel", tier: 2 }`；`kind` 仍表示原有服务类别，模型 ID 为 `market-hall` 和 `church`。

默认调用会生成包含底板的完整预览模型。游戏使用 `UpgradeOptions` 控制底板显示和入口朝向道路的方式；升级费用、解锁等级与服务效果由模拟规则负责。

## 游戏内显示

`src/render3d/models.ts` 中的 `buildingAsset(id, …, level)` 通过 `serviceBuilding(kind, 2, { plate: false, doors })` 绘制升级后的市场或教堂。游戏单独绘制底板，因此模型自身不带底板。

模型使用 `quartersFor` 以四分之一圈为单位旋转，让尽可能多的临街正面朝向入口道路：市场大厅对应两侧拱廊，大教堂对应钟楼入口。烘焙光照方向保持不变；原先受光的墙面转至背光侧后，会改用材质的阴影色。

`upgradeHeights` 提供各模型的檐口高度和最高点，分别用于表面特效、火焰及问题标记。市场大厅不再使用原市场的旗帜，模型缓存键也包含建筑等级；施工中的升级另行绘制脚手架，原建筑仍会工作。

建造菜单和详情面板通过 `src/render3d/portrait.ts` 显示建筑与住宅的 3D 肖像，包括升级后的市场大厅与大教堂。肖像使用与城镇初始镜头相同的方向绘制模型，并按模型范围裁剪，使其与地图上的建筑外观一致。

## 其他升级模型

市政厅可依次成为行会大厅、城市政厅。它们由 `src/asset-lab/civic.ts` 绘制；仓库、采石场、农场、面包坊和消防站的升级外观由 `src/asset-lab/upgrade-dress.ts` 添加至原建筑模型。`src/asset-lab/upgrade-catalogue.ts` 汇总这些模型，以及共用脚手架在不同建材送达进度下的示例。

`src/render3d/models.ts` 使用数值等级 `level` 选择模型、檐口和标记高度，支持市政建筑的两次升级。仓储容量、运输员、服务范围、生产速度和行政减免均来自 `src/content.ts`，展示模型本身不决定规则。

## 预览与导出

运行 `pnpm dev`，打开 `/service-upgrades.html`，可同步对比不同等级、切换街道尺度并下载 GLB。`/asset-lab.html?asset=church` 和 `/asset-lab.html?asset=market-hall` 可分别查看模型；`/map-lab.html` 也包含两款模型。

`pnpm assets:build` 会导出 GLB 和 JSON 几何数据，检查重新导入的几何数据与无光照材质，并生成 `output/inkline-3d/inkline-service-upgrades.html`。独立查看器无需开发服务器即可使用。
