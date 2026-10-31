# SteamPy 低价挂单扫描

买家页筛选栏的「低价扫描」用于找出平时价格不低、但当前出现明显低价挂单的游戏。

## 价格定义

- **平时价**：SteamPy 历史平均成交价 `keyAveAmt`，来自 `GET /xboot/steamGame/getOne`。这是 SteamPy 站内该游戏的平时成交价，**不是 Steam 原价**。
- **当前价**：SteamPy 当前最低挂单价 `keyTxAmt`（游戏列表/详情字段，与 `listSale` 最低挂单一致）。注意不要使用列表的 `keyPrice` 字段，它是站内的参考低价，**不是真实挂单价格**。

## 判定模型

- 前提：`keyAveAmt >= 平时价下限`（默认 `0.6` 元，排除本来就是低价的游戏）。
- 命中条件（满足任一）：
  - 当前价 `<= 绝对低价`（默认 `0.1` 元，即 SteamPy 最低挂单价）。
  - 当前价 `<= keyAveAmt * 折扣比率`（默认 `20%`）。
  - 当前价 `<= 额度上限`（可选，默认留空）。
- 当前价取 `keyTxAmt`，缺失时回退 `keyPrice`。

默认参数下，「平常 0.6 元以上、现在 0.1 元」与「平常 5 元、现在 1 元」均可命中。

## 使用

- 在 `/cdKey/cdKey` 与 `/pro/cdKey/cdKey` 买家页点击「低价扫描」按钮，弹出参数配置面板。
- 参数包括：平时价下限、绝对低价、折扣比率、额度上限（可空）、扫描页数。
- 参数自动记忆（GM 存储），可点击「重置默认值」恢复默认。
- 开始扫描后跨页扫描（页数大于 1 时），结果在模态面板列出（游戏、平时价、当前价、折扣、状态），并在卡片上打标记。
- 「仅显示命中」开关独立持久化。

## 实现

- `src/lib/steampy/steampy-plus-bargain-scan.js`
- `src/lib/steampy/xboot-client.js` 的 `fetchSteamGameDetail` 封装 `GET /xboot/steamGame/getOne`。