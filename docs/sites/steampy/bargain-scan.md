# SteamPy 低价挂单扫描

买家页筛选栏的「低价扫描」用于找出平时价格不低、但当前出现明显低价挂单的游戏。

## 判定模型

- 平时价基准：历史均价 `keyAveAmt`，来自 `GET /xboot/steamGame/getOne`。
- 前提：`keyAveAmt >= 平时价下限`（默认 `0.6` 元，排除本来就是低价的游戏）。
- 命中条件（满足任一）：
  - 当前最低挂单价 `<= 绝对低价`（默认 `0.1` 元，即 SteamPy 最低挂单价）。
  - 当前最低挂单价 `<= keyAveAmt * 折扣比率`（默认 `20%`）。
  - 当前最低挂单价 `<= 额度上限`（可选，默认留空）。
- 当前价取列表字段 `keyPrice`，缺失时回退 `keyTxAmt`。

默认参数下，「平常 0.6 元以上、现在 0.1 元」与「平常 5 元、现在 1 元」均可命中。

## 使用

- 在 `/cdKey/cdKey` 与 `/pro/cdKey/cdKey` 买家页的筛选栏输入参数，点击「低价扫描」。
- 页数输入可跨页扫描（后续页为未筛选列表，沿用「查看低价」的机制）。
- 结果在模态面板列出（游戏、平时价、当前价、折扣、状态），并在卡片上打标记。
- 参数与「仅显示命中」开关持久化在 GM 存储。

## 实现

- `src/lib/steampy/steampy-plus-bargain-scan.js`
- `src/lib/steampy/xboot-client.js` 的 `fetchSteamGameDetail` 封装 `GET /xboot/steamGame/getOne`。