# 市场大厅与大教堂模型

二级服务建筑的展示模型已确认，包括大教堂两侧竖直的木制双开门。模型已加入目录和预览地图；游戏内仍使用原有的一级建筑。

## 模型接口

`src/asset-lab/service-upgrades.ts` 导出 `marketHall()`、`church()`，以及：

```ts
serviceBuilding("market", 2) // 市场大厅 market-hall
serviceBuilding("chapel", 2) // 大教堂 church
serviceBuilding("market", 1) // 原有市场
```

升级前后均占地 2×2 格。目录引用为 `{ type: "building", kind: "market" | "chapel", tier: 2 }`；`kind` 仍表示原有服务类别，模型 ID 为 `market-hall` 和 `church`。

这些函数目前生成包含底板的完整预览模型。接入游戏时，需要支持现有 `BuildingOptions` 对入口朝向道路、施工适配、底板显示与独立动画的约定。未实现这些控制前，不应使用预览辅助函数替换 `buildingAsset()`。

## 尚待接入的游戏规则

- 定义升级条件、费用和服务效果。存档需保存服务建筑等级，并让旧存档默认使用一级建筑，保持兼容。
- 将等级经展示层传入 `src/render3d/models.ts` 和 `src/render3d/views.ts`，并纳入共享模型与缓存的键。保留建筑状况、冬季、烟雾和施工表现。
- 施工与特效使用升级后的轮廓和尺寸。一级教堂保留原有小穹顶，一级市场保留原有旗帜。
- 添加升级界面，验证保存与读取、施工、沿路入口、选择与旋转。仅注册模型元数据不会开启游戏内升级。

## 预览与导出

运行 `pnpm dev`，打开 `/service-upgrades.html`，可同步对比不同等级、切换街道尺度并下载 GLB。`/asset-lab.html?asset=church` 和 `/asset-lab.html?asset=market-hall` 可分别查看模型；`/map-lab.html` 也包含两款模型。

`pnpm assets:build` 会导出 GLB 和 JSON 几何数据，检查重新导入的几何数据与无光照材质，并生成 `output/inkline-3d/inkline-service-upgrades.html`。独立查看器无需开发服务器即可使用。
