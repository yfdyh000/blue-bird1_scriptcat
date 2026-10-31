# SteamPy 游戏清单

本地游戏清单用于检索、记录、导出和标记想买、忽略、已有的游戏。

## 数据模型

- GM 存储键：`steampyGameTracker`（JSON 数组）。
- 记录字段：`appId`、`gameId`、`name`、`status`、`source`、`note`、`addedAt`、`updatedAt`。
- `status` 枚举：`wanted`（想买）、`ignored`（忽略）、`owned`（已有）。
- `source` 枚举：`steam-wishlist`、`steam-owned`、`steam-ignored`、`manual`。

## 功能

- 卡片标记：在 `.gameblock` 卡片右上角显示「标」按钮，点击弹出「想买 / 忽略 / 已有 / 取消标记」菜单；详情页与捡漏扫描面板可直接标记「忽略 / 已有」。
- 清单面板：菜单「打开游戏清单（查看/搜索/标记/导出）」打开全屏面板，支持按名称/AppID 搜索、按状态筛选、切换状态、删除记录。
- 同步：无需手动菜单——「同步Steam数据」完成后会自动把 Steam 愿望单/已拥有/已忽略导入为记录（已存在的不覆盖），脚本启动时也会自动导入一次；清单面板的「同步 Steam」按钮可手动触发并提示新增数。
- 导出：菜单或面板按钮导出 CSV / JSON，CSV 带 BOM 便于 Excel 打开。

## 实现

- `src/lib/steampy/game-tracker.js`
- Steam 数据来自 `steam-library.js` 的 `dynamicstore/userdata` 同步结果。