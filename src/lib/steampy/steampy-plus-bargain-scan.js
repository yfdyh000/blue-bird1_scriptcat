import { normalizeSteamPyRegion, parseThreshold } from "./steampy-plus-lowest-listing-price.js";

const BARGAIN_SCAN_BUTTON_ID = "steamPyPlusBargainScanButton";
const BARGAIN_SCAN_MIN_NORMAL_INPUT_ID = "steamPyPlusBargainMinNormalPrice";
const BARGAIN_SCAN_ABS_LOW_INPUT_ID = "steamPyPlusBargainAbsLowPrice";
const BARGAIN_SCAN_RATIO_INPUT_ID = "steamPyPlusBargainDiscountRatio";
const BARGAIN_SCAN_AMOUNT_CAP_INPUT_ID = "steamPyPlusBargainAmountCap";
const BARGAIN_SCAN_PAGE_COUNT_INPUT_ID = "steamPyPlusBargainPageCount";
const BARGAIN_SCAN_PANEL_ID = "steamPyPlusBargainScanPanel";
const BARGAIN_SCAN_STYLE_ID = "steamPyPlusBargainScanStyle";
const BARGAIN_SCAN_MARKER_ATTR = "data-steam-py-plus-bargain";
const BARGAIN_SCAN_HIT_ONLY_STORAGE_KEY = "steamPyPlusBargainHitOnly";
const FILTER_ANCHOR_SELECTOR = ".tag.flex-row.align-items-center";
const GAME_BLOCK_SELECTOR = ".gameblock";
const QUERY_CONCURRENCY = 2;
const BARGAIN_SCAN_SPEED_KEY = "steamPyPlusBargainSpeed";
const BARGAIN_SCAN_SPEED_INPUT_ID = "steamPyPlusBargainSpeedInput";
const SPEED_PRESETS = Object.freeze({
  fast: { min: 200, max: 400, label: "快速" },
  normal: { min: 400, max: 800, label: "标准" },
  safe: { min: 800, max: 1600, label: "保守" },
});
const RATE_LIMIT_PATTERN = /频繁|限流|请求过快|too many|429/i;
const TRACKER_MARK_LABELS = Object.freeze({ ignored: "忽略", owned: "已有" });
const BARGAIN_SCAN_USE_FILTER_KEY = "steamPyPlusBargainUseFilter";
const DEFAULT_MIN_NORMAL_PRICE = 0.6;
const DEFAULT_ABS_LOW_PRICE = 0.1;
const DEFAULT_DISCOUNT_RATIO = 20;

function isFiniteNumber(value) {
  return Number.isFinite(Number(value));
}

export function parseBargainConfig({
  minNormalPrice,
  absLowPrice,
  discountRatio,
  amountCap,
} = {}) {
  const minNormal = parseThreshold(minNormalPrice) ?? DEFAULT_MIN_NORMAL_PRICE;
  const absLow = parseThreshold(absLowPrice) ?? DEFAULT_ABS_LOW_PRICE;
  const ratio = parseThreshold(discountRatio) ?? DEFAULT_DISCOUNT_RATIO;
  const cap = parseThreshold(amountCap);
  return {
    minNormalPrice: Math.max(0, minNormal),
    absLowPrice: Math.max(0, absLow),
    discountRatio: Math.max(0, ratio) / 100,
    amountCap: cap === null ? null : Math.max(0, cap),
  };
}

export function isBargain(game, config) {
  const average = Number(game?.keyAveAmt);
  const price = Number(game?.keyTxAmt ?? game?.keyPrice);
  if (!Number.isFinite(average) || average <= 0) return false;
  if (!Number.isFinite(price) || price <= 0) return false;
  if (average < config.minNormalPrice) return false;
  if (config.absLowPrice > 0 && price <= config.absLowPrice) return true;
  if (config.discountRatio > 0 && price <= average * config.discountRatio) return true;
  if (config.amountCap !== null && price <= config.amountCap) return true;
  return false;
}

function formatPrice(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "--";
  if (number > 0 && number < 0.01) return `￥${number.toFixed(4)}`;
  return `￥${number.toFixed(2)}`;
}

function formatRatio(price, average) {
  const priceNumber = Number(price);
  const averageNumber = Number(average);
  if (!Number.isFinite(priceNumber) || !Number.isFinite(averageNumber) || averageNumber <= 0) return "--";
  return `${(priceNumber / averageNumber * 100).toFixed(1)}%`;
}

export function steamRatingLabel(rating, reviewScoreDesc) {
  const desc = String(reviewScoreDesc || "").trim();
  if (desc) {
    const descColor = {
      "好评如潮": "#0a7d33",
      "特别好评": "#16a34a",
      "多半好评": "#2f86eb",
      "褒贬不一": "#e69f00",
      "多半差评": "#d55e00",
      "差评如潮": "#8c8c8c",
      "无用户评测": "#999",
    };
    return { label: desc, color: descColor[desc] || "#999" };
  }
  const value = Number(rating);
  if (!Number.isFinite(value) || value <= 0) return { label: "--", color: "#999" };
  if (value >= 0.95) return { label: "好评如潮", color: "#0a7d33" };
  if (value >= 0.8) return { label: "特别好评", color: "#16a34a" };
  if (value >= 0.7) return { label: "多半好评", color: "#2f86eb" };
  if (value >= 0.4) return { label: "褒贬不一", color: "#e69f00" };
  if (value >= 0.2) return { label: "多半差评", color: "#d55e00" };
  return { label: "差评如潮", color: "#8c8c8c" };
}

export function discountColor(ratio, price) {
  const priceNumber = Number(price);
  if (Number.isFinite(priceNumber) && priceNumber > 0) {
    if (Math.abs(priceNumber - 0.1) < 0.005) return "#7d3c98";
    if (priceNumber > 0.1 && priceNumber < 0.2) return "#008b8b";
  }
  if (!Number.isFinite(ratio) || ratio <= 0) return "#999";
  if (ratio > 1) return "#8c8c8c";
  if (ratio < 0.1) return "#00429d";
  if (ratio < 0.2) return "#0072b2";
  if (ratio < 0.3) return "#009e73";
  if (ratio < 0.5) return "#e69f00";
  if (ratio < 0.8) return "#d55e00";
  return "#595959";
}

function waitFor(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isRateLimitError(error) {
  const status = Number(error?.response?.status);
  if (status === 429) return true;
  return RATE_LIMIT_PATTERN.test(error?.message || "");
}

export function createSteamPyBargainScanController({
  client,
  gameTracker = null,
  shouldShow = null,
  getValue = GM_getValue,
  setValue = GM_setValue,
} = {}) {
  let vm = null;
  let button = null;
  let minNormalInput = null;
  let absLowInput = null;
  let ratioInput = null;
  let amountCapInput = null;
  let pageCountInput = null;
  let useFilterCheckbox = null;
  let speedSelect = null;
  let panel = null;
  let querying = false;
  let rateLimited = false;
  let queryGeneration = 0;
  let activePageCount = 1;
  let activeLastCheckedPage = 1;
  let activeBasePageNumber = 1;
  let activeRequestCount = 0;
  let closeWaiters = [];
  let activeSortColumn = null;
  let activeSortOrder = "asc";

  function gameList() {
    return Array.isArray(vm?.gameList) ? vm.gameList : [];
  }

  function gameBlocks() {
    return document.querySelectorAll(GAME_BLOCK_SELECTOR);
  }

  function gameIdOf(game) {
    return game?.id ?? game?.gameId ?? null;
  }

  function gameNameOf(game) {
    return game?.gameName || game?.name || `gameId ${gameIdOf(game) ?? "未知"}`;
  }

  function resolveRegion() {
    return normalizeSteamPyRegion(vm?.areas);
  }

  function closePanel() {
    queryGeneration += 1;
    querying = false;
    const waiters = closeWaiters;
    closeWaiters = [];
    waiters.forEach((resolve) => resolve());
    panel?.remove();
    panel = null;
  }

  function clearMarkers() {
    closePanel();
    document.querySelectorAll(`[${BARGAIN_SCAN_MARKER_ATTR}]`).forEach((marker) => marker.remove());
  }

  function renderMarker(index, result) {
    const block = gameBlocks()[index];
    if (!block) return;
    const existing = block.querySelector(`[${BARGAIN_SCAN_MARKER_ATTR}]`);
    existing?.remove();
    const marker = document.createElement("div");
    marker.setAttribute(BARGAIN_SCAN_MARKER_ATTR, "true");
    let text;
    let color;
    if (result.hit) {
      text = `✓ 低价 ${formatPrice(result.price)}${result.scarce ? "（少量）" : ""}`;
      color = discountColor(result.price / result.average, result.price);
    } else {
      text = result.reason || "未命中";
      color = "#999";
    }
    marker.textContent = text;
    marker.style.cssText = `font-size:.12rem;line-height:.16rem;color:${color};padding:0 .04rem;`;
    const priceContainer = block.querySelector(".gameFoot");
    (priceContainer || block).append(marker);
  }

  function createPanel() {
    document.getElementById(BARGAIN_SCAN_STYLE_ID)?.remove();
    const overlay = document.createElement("div");
    overlay.id = BARGAIN_SCAN_PANEL_ID;
    overlay.style.cssText = "position:fixed;z-index:10000;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.38);";
    const dialog = document.createElement("section");
    dialog.style.cssText = "width:min(8rem,94vw);height:min(80vh,8.5rem);display:flex;flex-direction:column;gap:.12rem;padding:.2rem;border-radius:.08rem;background:#fff;color:#17233d;box-sizing:border-box;";
    const header = document.createElement("div");
    header.style.cssText = "display:flex;align-items:center;justify-content:space-between;";
    const title = document.createElement("h3");
    title.style.cssText = "margin:0;font-size:.18rem;";
    title.textContent = "捡漏扫描";
    const close = document.createElement("button");
    close.type = "button";
    close.className = "ivu-btn ivu-btn-default ivu-btn-sm";
    close.textContent = "×";
    close.style.cssText = "min-width:.3rem;padding:0;font-size:.2rem;line-height:.3rem;cursor:pointer;";
    close.addEventListener("click", closePanel);
    header.append(title, close);

    const progressRow = document.createElement("div");
    progressRow.style.cssText = "display:flex;align-items:center;justify-content:space-between;";
    const progress = document.createElement("div");
    progress.dataset.steamPyPlusBargainProgress = "true";
    progress.style.cssText = "font-size:.13rem;color:#666;";
    const hitOnly = document.createElement("label");
    hitOnly.style.cssText = "display:flex;align-items:center;gap:.05rem;font-size:.13rem;color:#17233d;cursor:pointer;";
    const savedHitOnly = getValue?.(BARGAIN_SCAN_HIT_ONLY_STORAGE_KEY, true);
    const hitCheckbox = document.createElement("input");
    hitCheckbox.type = "checkbox";
    hitCheckbox.checked = savedHitOnly !== false;
    hitCheckbox.dataset.steamPyPlusBargainHitOnly = "true";
    hitCheckbox.style.cssText = "margin:0;cursor:pointer;";
    hitCheckbox.addEventListener("change", () => {
      setValue?.(BARGAIN_SCAN_HIT_ONLY_STORAGE_KEY, hitCheckbox.checked);
      applyHitOnlyFilter();
    });
    hitOnly.append(hitCheckbox, document.createTextNode("仅显示命中"));
    progressRow.append(progress, hitOnly);

    const tableWrap = document.createElement("div");
    tableWrap.style.cssText = "flex:1;overflow:auto;min-height:0;";
    const table = document.createElement("table");
    table.style.cssText = "width:100%;border-collapse:collapse;font-size:.13rem;";
    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    headRow.style.cssText = "background:#f5f7fa;";
    [["游戏", "name"], ["评价", "rating"], ["平时价", "average"], ["当前价", "price"], ["折扣", "ratio"], ["状态", "status"]].forEach(([text, key]) => {
      const th = document.createElement("th");
      th.dataset.sortKey = key;
      th.title = key === "ratio"
        ? "点击排序：默认升序（折扣百分比最低在前），再点切换；新增结果自动排序"
        : `点击按“${text}”排序（默认升序，再点切换；新增结果自动排序）`;
      th.style.cssText = "padding:.08rem .1rem;border:1px solid #e8eaec;text-align:left;cursor:pointer;user-select:none;";
      const span = document.createElement("span");
      span.textContent = text;
      const arrow = document.createElement("span");
      arrow.dataset.sortArrow = key;
      arrow.style.cssText = "margin-left:.04rem;font-size:.1rem;color:#2d8cf0;";
      th.append(span, arrow);
      th.addEventListener("click", () => toggleSort(key));
      headRow.append(th);
    });
    thead.append(headRow);
    const tbody = document.createElement("tbody");
    table.append(thead, tbody);
    tableWrap.append(table);

    dialog.append(header, progressRow, tableWrap);
    overlay.append(dialog);
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) closePanel();
    });
    document.body.append(overlay);
    return overlay;
  }

  function applyHitOnlyFilter() {
    if (!panel) return;
    const hitCheckbox = panel.querySelector("[data-steam-py-plus-bargain-hit-only]");
    const onlyHit = hitCheckbox?.checked;
    panel.querySelectorAll("tbody tr").forEach((row) => {
      const hit = row.dataset.hit === "1";
      row.style.display = onlyHit && !hit ? "none" : "";
    });
  }

  function updateSortArrows() {
    panel?.querySelectorAll("[data-sort-arrow]").forEach((arrow) => {
      const key = arrow.dataset.sortArrow;
      arrow.textContent = activeSortColumn === key ? (activeSortOrder === "asc" ? "▲" : "▼") : "";
    });
  }

  function toggleSort(key) {
    if (activeSortColumn === key) {
      activeSortOrder = activeSortOrder === "asc" ? "desc" : "asc";
    } else {
      activeSortColumn = key;
      activeSortOrder = "asc";
    }
    updateSortArrows();
    sortTableRows();
  }

  function sortTableRows() {
    if (!panel || !activeSortColumn) return;
    const tbody = panel.querySelector("tbody");
    const rows = [...tbody.children];
    const key = activeSortColumn;
    const dataKey = `sort${key.charAt(0).toUpperCase()}${key.slice(1)}`;
    rows.sort((first, second) => {
      const firstValue = Number(first.dataset[dataKey]);
      const secondValue = Number(second.dataset[dataKey]);
      let comparison;
      if (Number.isFinite(firstValue) && Number.isFinite(secondValue)) {
        comparison = firstValue - secondValue;
      } else {
        comparison = String(first.dataset[dataKey] ?? "").localeCompare(String(second.dataset[dataKey] ?? ""));
      }
      return activeSortOrder === "asc" ? comparison : -comparison;
    });
    rows.forEach((row) => tbody.append(row));
  }

  function renderProgress(completed, total) {
    const element = panel?.querySelector("[data-steam-py-plus-bargain-progress]");
    if (!element) return;
    const hitCount = panel
      ? [...panel.querySelectorAll("tbody tr[data-hit='1']")].length
      : 0;
    const currentPage = Math.max(1, activeLastCheckedPage - activeBasePageNumber + 1);
    const done = completed >= total && !rateLimited;
    const prefix = rateLimited ? "⛔" : done ? "✓" : "⏳";
    const color = rateLimited ? "#cb2634" : done ? "#16a34a" : "#2d8cf0";
    element.textContent = `${prefix} 已处理 ${completed}/${total} · 命中 ${hitCount} · 第 ${currentPage}/${activePageCount} 页 · 请求 ${activeRequestCount}`;
    element.style.color = color;
    element.style.fontWeight = done || rateLimited ? "bold" : "normal";
  }

  function renderRow(index, game, result, region) {
    if (!panel) return;
    const tbody = panel.querySelector("tbody");
    let row = tbody.querySelector(`tr[data-game-index="${index}"]`);
    if (!row) {
      row = document.createElement("tr");
      row.dataset.gameIndex = String(index);
      tbody.append(row);
    }
    row.replaceChildren();
    row.dataset.hit = result.hit ? "1" : "0";
    row.dataset.sortName = gameNameOf(game);
    row.dataset.sortRating = Number(game?.rating) || 0;
    row.dataset.sortAverage = Number(game?.keyAveAmt) || 0;
    row.dataset.sortPrice = Number(game?.keyTxAmt ?? game?.keyPrice) || 0;
    const averageForSort = Number(game?.keyAveAmt);
    const priceForSort = Number(game?.keyTxAmt ?? game?.keyPrice);
    row.dataset.sortRatio = averageForSort > 0 ? priceForSort / averageForSort : 999;
    row.dataset.sortStatus = result.hit ? (result.scarce ? 0 : 1) : 2;
    row.style.display = "none";
    const name = document.createElement("td");
    name.style.cssText = "display:flex;align-items:center;padding:.06rem .1rem;border:1px solid #e8eaec;";
    const gameId = gameIdOf(game);
    const appId = game?.appId;
    const nameText = gameNameOf(game);
    if (gameId) {
      const detailLink = document.createElement("a");
      detailLink.textContent = nameText;
      detailLink.href = `https://steampy.com/cdkDetail?name=${region}&gameId=${gameId}`;
      detailLink.target = "_blank";
      detailLink.rel = "noopener noreferrer";
      detailLink.style.cssText = "color:#2d8cf0;text-decoration:none;";
      name.append(detailLink);
    } else {
      name.textContent = nameText;
    }
    if (appId) {
      const steamLink = document.createElement("a");
      steamLink.textContent = "Steam";
      steamLink.href = `https://store.steampowered.com/app/${appId}/`;
      steamLink.target = "_blank";
      steamLink.rel = "noopener noreferrer";
      steamLink.style.cssText = "margin-left:auto;font-size:.11rem;text-decoration:none;color:#1a9fff;";
      name.append(steamLink);
    }
    const totalReviews = Number(game?.steamApp?.totalReviews);
    const ratingInfo = steamRatingLabel(game?.rating, game?.steamApp?.reviewScoreDesc);
    const rating = document.createElement("td");
    rating.style.cssText = `padding:.06rem .1rem;border:1px solid #e8eaec;color:${ratingInfo.color};font-size:.12rem;white-space:nowrap;font-weight:bold;`;
    rating.textContent = ratingInfo.label;
    if (Number.isFinite(totalReviews) && totalReviews > 0) {
      rating.title = `${totalReviews} 篇评测`;
    }
    const average = document.createElement("td");
    average.style.cssText = "padding:.06rem .1rem;border:1px solid #e8eaec;";
    average.textContent = formatPrice(game?.keyAveAmt);
    const priceNumber = Number(game?.keyTxAmt ?? game?.keyPrice);
    const averageNumber = Number(game?.keyAveAmt);
    const ratioValue = averageNumber > 0 ? priceNumber / averageNumber : NaN;
    const price = document.createElement("td");
    price.style.cssText = `padding:.06rem .1rem;border:1px solid #e8eaec;font-weight:bold;color:${discountColor(ratioValue, priceNumber)};`;
    const priceText = formatPrice(priceNumber);
    price.textContent = result.stock ? `${priceText}（${result.stock}）` : priceText;
    const ratio = document.createElement("td");
    ratio.style.cssText = `padding:.06rem .1rem;border:1px solid #e8eaec;color:${discountColor(ratioValue, priceNumber)};font-weight:bold;`;
    ratio.textContent = formatRatio(priceNumber, averageNumber);
    const status = document.createElement("td");
    status.style.cssText = "padding:.06rem .1rem;border:1px solid #e8eaec;";
    const statusText = document.createElement("div");
    if (result.hit) {
      statusText.textContent = result.scarce ? "✓ 低价·少量" : "✓ 低价";
      statusText.style.color = discountColor(ratioValue, priceNumber);
      if (result.scarce) statusText.style.fontWeight = "bold";
    } else {
      statusText.textContent = result.reason || "未命中";
      statusText.style.color = "#999";
    }
    status.append(statusText);
    if (gameTracker) {
      const actionRow = document.createElement("div");
      actionRow.style.cssText = "margin-top:2px;display:flex;gap:2px;";
      const gameInfo = { appId: game?.appId, gameId: gameIdOf(game), name: gameNameOf(game) };
      const renderActions = () => {
        actionRow.replaceChildren();
        const current = gameTracker.getStatus(gameInfo);
        ["ignored", "owned"].forEach((candidate) => {
          const active = candidate === current;
          const button = document.createElement("button");
          button.type = "button";
          button.textContent = TRACKER_MARK_LABELS[candidate];
          button.title = active ? `取消“${TRACKER_MARK_LABELS[candidate]}”标记` : `标记为${TRACKER_MARK_LABELS[candidate]}`;
          button.style.cssText = `font-size:10px;height:16px;line-height:16px;padding:0 3px;border:1px solid ${active ? "#2d8cf0" : "#c9cdd4"};border-radius:3px;background:${active ? "#2d8cf0" : "#fff"};color:${active ? "#fff" : "#666"};cursor:pointer;`;
          button.addEventListener("click", (event) => {
            event.stopPropagation();
            gameTracker.markGame(gameInfo, active ? null : candidate, { silent: true });
            renderActions();
          });
          actionRow.append(button);
        });
      };
      renderActions();
      status.append(actionRow);
    }
    row.append(name, rating, average, price, ratio, status);
    row.style.display = "";
    if (activeSortColumn) sortTableRows();
  }

  async function queryGame(game, region, config) {
    const gameId = gameIdOf(game);
    if (gameId === null || gameId === undefined || gameId === "") {
      return { hit: false, reason: "缺少 gameId" };
    }
    activeRequestCount += 1;
    const detail = await client.fetchSteamGameDetail({ region, gameId });
    const average = Number(detail?.keyAveAmt);
    const enriched = {
      ...game,
      keyAveAmt: Number.isFinite(average) ? average : null,
    };
    if (!Number.isFinite(average) || average <= 0) {
      return { hit: false, reason: "无历史均价", game: enriched };
    }
    activeRequestCount += 1;
    const saleData = await client.fetchKeySaleList({ region, gameId, pageNumber: 1, pageSize: 20 });
    const listings = saleData?.content ?? saleData?.result?.content ?? [];
    const available = listings
      .filter((item) => Number(item?.stock ?? 1) > 0 && Number(item?.keyPrice) > 0)
      .sort((first, second) => Number(first.keyPrice) - Number(second.keyPrice));
    const lowest = available[0];
    if (!lowest) {
      return { hit: false, reason: "无在售挂单", game: enriched };
    }
    const lowestPrice = Number(lowest.keyPrice);
    const lowestPriceListings = available.filter((item) => Number(item.keyPrice) === lowestPrice);
    const lowestStock = lowestPriceListings.reduce((sum, item) => sum + Number(item.stock ?? 1), 0);
    const higherListings = available.filter((item) => Number(item.keyPrice) > lowestPrice);
    const secondPrice = higherListings.length > 0 ? Number(higherListings[0].keyPrice) : null;
    const scarce = secondPrice !== null && secondPrice > lowestPrice && lowestStock <= 3;
    const withSale = { ...enriched, keyTxAmt: lowestPrice };
    const hit = isBargain(withSale, config);
    return {
      hit,
      reason: hit ? "低价" : "未达低价",
      game: withSale,
      price: lowestPrice,
      average,
      stock: lowestStock,
      secondPrice,
      scarce,
    };
  }

  async function runQuery() {
    if (querying) return;
    const config = parseBargainConfig({
      minNormalPrice: minNormalInput?.value,
      absLowPrice: absLowInput?.value,
      discountRatio: ratioInput?.value,
      amountCap: amountCapInput?.value,
    });
    const region = resolveRegion();
    const generation = ++queryGeneration;
    rateLimited = false;
    const firstPageGames = gameList();
    const firstPageCount = firstPageGames.length;
    const pageCount = Math.max(1, Math.floor(parseThreshold(pageCountInput?.value) ?? 1));
    activePageCount = pageCount;
    activeBasePageNumber = Number(vm?.searchForm?.pageNumber) || 1;
    activeLastCheckedPage = activeBasePageNumber;
    activeRequestCount = 0;
    renderProgress(0, firstPageCount);
    const useFilter = useFilterCheckbox?.checked !== false;
    const activeSpeed = speedSelect?.value || getValue?.(BARGAIN_SCAN_SPEED_KEY, "normal") || "normal";
    const speedPreset = SPEED_PRESETS[activeSpeed] || SPEED_PRESETS.normal;
    let games = firstPageGames;
    if (pageCount > 1 && client?.fetchSteamGameKeyHot) {
      const searchForm = vm?.searchForm || {};
      const pageSize = Number(searchForm.pageSize) || firstPageCount || 30;
      const collected = [...firstPageGames];
      for (let pageNumber = activeBasePageNumber + 1; pageNumber <= activeBasePageNumber + pageCount - 1; pageNumber += 1) {
        try {
          activeRequestCount += 1;
          const pageResponse = await client.fetchSteamGameKeyHot({ ...searchForm, pageNumber, pageSize });
          activeLastCheckedPage = pageNumber;
          const pageGames = pageResponse?.content ?? pageResponse?.result?.content ?? [];
          if (!Array.isArray(pageGames) || pageGames.length === 0) break;
          const usableGames = useFilter && typeof shouldShow === "function"
            ? pageGames.filter((game) => shouldShow(game))
            : pageGames;
          if (usableGames.length > 0) collected.push(...usableGames);
        } catch {
          break;
        }
        await waitFor(speedPreset.min);
      }
      games = collected;
    }
    const total = games.length;
    renderProgress(0, total);
    if (!total) return;
    querying = true;
    closeWaiters = [];
    let completed = 0;
    let nextIndex = 0;

    async function worker() {
      while (querying && generation === queryGeneration && !rateLimited) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= total) return;
        const game = games[index];
        let result;
        if (client?.isTokenInvalid?.()) {
          result = { hit: false, reason: "AccessToken 已失效" };
          querying = false;
        } else {
          const closePromise = new Promise((resolve) => closeWaiters.push(resolve));
          try {
            const outcome = await Promise.race([
              queryGame(game, region, config).then((value) => ({ closed: false, value })),
              closePromise.then(() => ({ closed: true })),
            ]);
            if (outcome.closed) return;
            result = outcome.value;
          } catch (error) {
            if (isRateLimitError(error)) {
              rateLimited = true;
              querying = false;
              result = { hit: false, reason: "疑似被限流" };
            } else {
              result = { hit: false, reason: error?.message || String(error) };
            }
          }
        }
        if (generation !== queryGeneration) return;
        completed += 1;
        renderProgress(completed, total);
        renderRow(index, game, result, region);
        if (index < firstPageCount) renderMarker(index, result);
        if (client?.isTokenInvalid?.()) querying = false;
        if (querying && !rateLimited) {
          const delay = speedPreset.min
            + Math.random() * (speedPreset.max - speedPreset.min);
          await waitFor(delay);
        }
      }
    }

    await Promise.all(Array.from({ length: QUERY_CONCURRENCY }, () => worker()));
    querying = false;
    if (generation !== queryGeneration) return;
    renderProgress(total, total);
    applyHitOnlyFilter();
    if (client?.isTokenInvalid?.()) {
      const element = panel?.querySelector("[data-steam-py-plus-bargain-progress]");
      if (element) element.textContent = "已停止：AccessToken 已失效，请重新登录后刷新页面";
    }
    if (rateLimited) {
      const element = panel?.querySelector("[data-steam-py-plus-bargain-progress]");
      if (element) element.textContent = "已停止：疑似被限流，请降低页数或稍后再试";
    }
  }

  let configPanel = null;

  function persistInputs() {
    setValue?.("steamPyPlusBargainMinNormalPrice", minNormalInput?.value ?? "");
    setValue?.("steamPyPlusBargainAbsLowPrice", absLowInput?.value ?? "");
    setValue?.("steamPyPlusBargainDiscountRatio", ratioInput?.value ?? "");
    setValue?.("steamPyPlusBargainAmountCap", amountCapInput?.value ?? "");
    setValue?.("steamPyPlusBargainPageCount", pageCountInput?.value ?? "");
    setValue?.(BARGAIN_SCAN_USE_FILTER_KEY, useFilterCheckbox?.checked ? "1" : "0");
    setValue?.(BARGAIN_SCAN_SPEED_KEY, speedSelect?.value || "normal");
  }

  function restoreInputs() {
    const minNormal = getValue?.("steamPyPlusBargainMinNormalPrice", String(DEFAULT_MIN_NORMAL_PRICE));
    const absLow = getValue?.("steamPyPlusBargainAbsLowPrice", String(DEFAULT_ABS_LOW_PRICE));
    const ratio = getValue?.("steamPyPlusBargainDiscountRatio", String(DEFAULT_DISCOUNT_RATIO));
    const amountCap = getValue?.("steamPyPlusBargainAmountCap", "");
    const pageCount = getValue?.("steamPyPlusBargainPageCount", "1");
    if (minNormalInput) minNormalInput.value = String(minNormal ?? "");
    if (absLowInput) absLowInput.value = String(absLow ?? "");
    if (ratioInput) ratioInput.value = String(ratio ?? "");
    if (amountCapInput) amountCapInput.value = String(amountCap ?? "");
    if (pageCountInput) pageCountInput.value = String(pageCount ?? "");
    if (useFilterCheckbox) useFilterCheckbox.checked = getValue?.(BARGAIN_SCAN_USE_FILTER_KEY, "1") !== "0";
    if (speedSelect) speedSelect.value = getValue?.(BARGAIN_SCAN_SPEED_KEY, "normal") || "normal";
  }

  function createConfigInput(id, type, placeholder, title, style) {
    const input = document.createElement("input");
    input.id = id;
    input.type = type;
    input.placeholder = placeholder;
    input.title = title;
    input.style.cssText = style;
    return input;
  }

  function openConfigPanel() {
    if (configPanel) return;
    const overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;z-index:10000;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.38);";
    const dialog = document.createElement("section");
    dialog.style.cssText = "width:min(5.2rem,92vw);padding:.2rem;border-radius:.08rem;background:#fff;color:#17233d;box-sizing:border-box;";
    const title = document.createElement("h3");
    title.style.cssText = "margin:0 0 .16rem;font-size:.18rem;";
    title.textContent = "捡漏扫描参数";
    const fieldStyle = "display:flex;align-items:center;justify-content:space-between;gap:.1rem;margin-bottom:.1rem;font-size:.13rem;";
    const inputStyle = "width:2.4rem;height:.3rem;padding:0 .08rem;border:1px solid #dcdee2;border-radius:.04rem;font-size:.13rem;color:#17233d;box-sizing:border-box;";
    const fields = document.createElement("div");
    const makeField = (labelText, input) => {
      const label = document.createElement("label");
      label.style.cssText = fieldStyle;
      const span = document.createElement("span");
      span.textContent = labelText;
      label.append(span, input);
      return label;
    };
    minNormalInput = createConfigInput(BARGAIN_SCAN_MIN_NORMAL_INPUT_ID, "number", "0.6", "平时价 = SteamPy 历史平均成交价（keyAveAmt），需达到该金额才扫描（默认 0.6）", inputStyle);
    absLowInput = createConfigInput(BARGAIN_SCAN_ABS_LOW_INPUT_ID, "number", "0.1", "当前最低挂单价（keyTxAmt）低于该金额即命中（默认 0.1）", inputStyle);
    ratioInput = createConfigInput(BARGAIN_SCAN_RATIO_INPUT_ID, "number", "20", "当前最低挂单价不高于历史均价的该百分比即命中（默认 20%）", inputStyle);
    amountCapInput = createConfigInput(BARGAIN_SCAN_AMOUNT_CAP_INPUT_ID, "number", "留空", "当前最低挂单价不高于该金额即命中（可留空）", inputStyle);
    pageCountInput = createConfigInput(BARGAIN_SCAN_PAGE_COUNT_INPUT_ID, "number", "1", "扫描的游戏页数，留空为 1（仅当前页）", inputStyle);
    speedSelect = document.createElement("select");
    speedSelect.id = BARGAIN_SCAN_SPEED_INPUT_ID;
    speedSelect.title = "请求间隔档位：快速较快但有风控风险，标准兼顾速度与安全，保守最安全";
    speedSelect.style.cssText = inputStyle;
    Object.entries(SPEED_PRESETS).forEach(([value, preset]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = `${preset.label}（${preset.min}-${preset.max}ms）`;
      speedSelect.append(option);
    });
    fields.append(
      makeField("平时价下限（元）", minNormalInput),
      makeField("绝对低价（元）", absLowInput),
      makeField("折扣比率（%）", ratioInput),
      makeField("额度上限（元，可空）", amountCapInput),
      makeField("扫描页数", pageCountInput),
      makeField("请求速度", speedSelect),
    );
    const hint = document.createElement("p");
    hint.style.cssText = "margin:.1rem 0 0;font-size:.12rem;color:#999;";
    hint.textContent = "“平时价”指 SteamPy 历史平均成交价（keyAveAmt），来自游戏详情，不是 Steam 原价；“当前价”指 SteamPy 当前最低挂单价（keyTxAmt）。命中条件：keyAveAmt ≥ 平时价下限，且当前价 ≤ 绝对低价，或 ≤ keyAveAmt × 折扣比率，或 ≤ 额度上限（三者满足任一）。";
    const filterOption = document.createElement("label");
    filterOption.style.cssText = "display:flex;align-items:center;gap:.05rem;margin:.08rem 0 0;font-size:.12rem;color:#17233d;cursor:pointer;";
    useFilterCheckbox = document.createElement("input");
    useFilterCheckbox.type = "checkbox";
    useFilterCheckbox.title = "跨页扫描时遵循当前 DLC/价格/已拥有过滤，减少无效请求（默认开启）";
    useFilterCheckbox.style.cssText = "margin:0;cursor:pointer;";
    filterOption.append(useFilterCheckbox, document.createTextNode("遵循当前 DLC/价格筛选（减少请求）"));
    const actions = document.createElement("div");
    actions.style.cssText = "display:flex;align-items:center;gap:.1rem;margin-top:.16rem;";
    const reset = document.createElement("button");
    reset.type = "button";
    reset.className = "ivu-btn ivu-btn-default ivu-btn-sm";
    reset.textContent = "重置默认值";
    reset.title = "将参数恢复为默认：平时价下限 0.6、绝对低价 0.1、折扣比率 20%、额度上限留空、页数 1、请求速度标准";
    reset.style.cssText = "margin-right:auto;";
    reset.addEventListener("click", () => {
      if (minNormalInput) minNormalInput.value = String(DEFAULT_MIN_NORMAL_PRICE);
      if (absLowInput) absLowInput.value = String(DEFAULT_ABS_LOW_PRICE);
      if (ratioInput) ratioInput.value = String(DEFAULT_DISCOUNT_RATIO);
      if (amountCapInput) amountCapInput.value = "";
      if (pageCountInput) pageCountInput.value = "1";
      if (useFilterCheckbox) useFilterCheckbox.checked = true;
      if (speedSelect) speedSelect.value = "normal";
      persistInputs();
    });
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "ivu-btn ivu-btn-default ivu-btn-sm";
    cancel.textContent = "取消";
    cancel.addEventListener("click", closeConfigPanel);
    const start = document.createElement("button");
    start.type = "button";
    start.className = "ivu-btn ivu-btn-primary ivu-btn-sm";
    start.textContent = "开始扫描";
    start.addEventListener("click", runScan);
    actions.append(reset, cancel, start);
    dialog.append(title, fields, hint, filterOption, actions);
    overlay.append(dialog);
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) closeConfigPanel();
    });
    document.body.append(overlay);
    configPanel = overlay;
    restoreInputs();
  }

  function closeConfigPanel() {
    configPanel?.remove();
    configPanel = null;
  }

  function runScan() {
    if (querying) return;
    persistInputs();
    closeConfigPanel();
    clearMarkers();
    panel = createPanel();
    runQuery();
  }

  function mountButton() {
    if (button?.isConnected) return true;
    const anchor = document.querySelector(FILTER_ANCHOR_SELECTOR);
    if (!anchor) return false;
    document.getElementById(BARGAIN_SCAN_BUTTON_ID)?.remove();
    button = document.createElement("button");
    button.id = BARGAIN_SCAN_BUTTON_ID;
    button.type = "button";
    button.className = "ivu-btn ivu-btn-default ivu-btn-sm";
    button.textContent = "捡漏扫描";
    button.title = "找出平时价格不低、但现在出现明显低价挂单的游戏：历史均价需不低于“平时价”，且当前最低挂单价低于绝对价、比率或额度门限之一。";
    button.style.cssText = "margin-left:.08rem;";
    button.addEventListener("click", openConfigPanel);
    anchor.append(button);
    return true;
  }

  function start(nextVm) {
    if (vm && vm !== nextVm) cleanup();
    vm = nextVm;
    if (!vm) return;
    mountButton();
  }

  function cleanup() {
    queryGeneration += 1;
    querying = false;
    clearMarkers();
    closeConfigPanel();
    button?.remove();
    button = null;
    minNormalInput = null;
    absLowInput = null;
    ratioInput = null;
    amountCapInput = null;
    pageCountInput = null;
    vm = null;
  }

  return { cleanup, clearMarkers, start };
}