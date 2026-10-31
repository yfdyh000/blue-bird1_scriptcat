# SteamPy 游戏清单

本地游戏清单用于检索、记录、导出和标记想买、忽略、已有的游戏。

## 数据模型

- GM 存储键：`steampyGameTracker`（JSON 数组）。
- 记录字段：`appId`、`gameId`、`name`、`status`、`source`、`note`、`addedAt`、`updatedAt`。
- `status` 枚举：`wanted`（想买）、`ignored`（忽略）、`owned`（已有）。
- `source` 枚举：`steam-wishlist`、`steam-owned`、`steam-ignored`、`manual`。

## 功能

- 卡片标记：在 `.gameblock` 卡片顶部中间显示状态角标与「想买 / 忽略 / 已有」三个快捷按钮，点击设置或取消标记。
- 清单面板：菜单「打开游戏清单」打开全屏面板，支持按名称/AppID 搜索、按状态筛选、切换状态、删除记录。
- 同步：菜单「从 Steam 同步游戏清单」读取 Steam 愿望单/已拥有/已忽略（AppID 列表）并导入为记录，已存在的记录不被覆盖；同步后可在面板中按需解析游戏名称。
- 导出：菜单或面板按钮导出 CSV / JSON，CSV 带 BOM 便于 Excel 打开。

## 实现

- `src/lib/steampy/game-tracker.js`
- Steam 数据来自 `steam-library.js` 的 `dynamicstore/userdata` 同步结果。