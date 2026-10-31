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
const QUERY_INTERVAL_MIN_MS = 300;
const QUERY_INTERVAL_MAX_MS = 600;
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
  const price = Number(game?.keyPrice ?? game?.keyTxAmt);
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
  return Number.isFinite(number) ? `￥${number.toFixed(2)}` : "--";
}

function formatRatio(price, average) {
  const priceNumber = Number(price);
  const averageNumber = Number(average);
  if (!Number.isFinite(priceNumber) || !Number.isFinite(averageNumber) || averageNumber <= 0) return "--";
  return `${(priceNumber / averageNumber * 100).toFixed(1)}%`;
}

function waitFor(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function createSteamPyBargainScanController({
  client,
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
  let panel = null;
  let querying = false;
  let queryGeneration = 0;
  let activePageCount = 1;
  let activeLastCheckedPage = 1;
  let activeBasePageNumber = 1;
  let activeRequestCount = 0;
  let activeTotalRequests = 0;
  let closeWaiters = [];

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
      text = `✓ 低价 ${formatPrice(result.price)}`;
      color = "#16a34a";
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
    title.textContent = "低价挂单扫描";
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
    [["游戏", ""], ["平时价", ""], ["当前价", ""], ["折扣", ""], ["状态", ""]].forEach(([text]) => {
      const th = document.createElement("th");
      th.textContent = text;
      th.style.cssText = "padding:.08rem .1rem;border:1px solid #e8eaec;text-align:left;";
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

  function renderProgress(completed, total) {
    const element = panel?.querySelector("[data-steam-py-plus-bargain-progress]");
    if (!element) return;
    const hitCount = panel
      ? [...panel.querySelectorAll("tbody tr[data-hit='1']")].length
      : 0;
    const currentPage = Math.max(1, activeLastCheckedPage - activeBasePageNumber + 1);
    element.textContent = `已处理 ${completed}/${total} · 命中 ${hitCount} · 第 ${currentPage}/${activePageCount} 页 · 请求 ${activeRequestCount}/${activeTotalRequests}`;
  }

  function renderRow(index, game, result, region) {
    if (!panel) return;
    const tbody = panel.querySelector("tbody");
    let row = tbody.children[index];
    if (!row) {
      row = document.createElement("tr");
      tbody.append(row);
    }
    row.replaceChildren();
    row.dataset.hit = result.hit ? "1" : "0";
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
    const average = document.createElement("td");
    average.style.cssText = "padding:.06rem .1rem;border:1px solid #e8eaec;";
    average.textContent = formatPrice(game?.keyAveAmt);
    const price = document.createElement("td");
    price.style.cssText = "padding:.06rem .1rem;border:1px solid #e8eaec;font-weight:bold;";
    price.textContent = formatPrice(game?.keyPrice ?? game?.keyTxAmt);
    const ratio = document.createElement("td");
    ratio.style.cssText = "padding:.06rem .1rem;border:1px solid #e8eaec;";
    ratio.textContent = formatRatio(game?.keyPrice ?? game?.keyTxAmt, game?.keyAveAmt);
    const status = document.createElement("td");
    status.style.cssText = "padding:.06rem .1rem;border:1px solid #e8eaec;";
    if (result.hit) {
      status.textContent = "✓ 低价";
      status.style.color = "#16a34a";
    } else {
      status.textContent = result.reason || "未命中";
      status.style.color = "#999";
    }
    row.append(name, average, price, ratio, status);
    row.style.display = "";
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
    const hit = isBargain(enriched, config);
    return {
      hit,
      reason: hit ? "低价" : "未达低价",
      game: enriched,
      price: Number(enriched.keyPrice ?? enriched.keyTxAmt),
      average,
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
    const firstPageGames = gameList();
    const firstPageCount = firstPageGames.length;
    const pageCount = Math.max(1, Math.floor(parseThreshold(pageCountInput?.value) ?? 1));
    activePageCount = pageCount;
    activeBasePageNumber = Number(vm?.searchForm?.pageNumber) || 1;
    activeLastCheckedPage = activeBasePageNumber;
    activeRequestCount = 0;
    renderProgress(0, firstPageCount);
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
          const usableGames = typeof shouldShow !== "function"
            ? pageGames
            : pageGames.filter((game) => shouldShow(game));
          if (usableGames.length > 0) collected.push(...usableGames);
        } catch {
          break;
        }
        await waitFor(QUERY_INTERVAL_MIN_MS);
      }
      games = collected;
    }
    const total = games.length;
    activeTotalRequests = total + (pageCount > 1 ? pageCount - 1 : 0);
    renderProgress(0, total);
    if (!total) return;
    querying = true;
    closeWaiters = [];
    const tbody = panel?.querySelector("tbody");
    for (let index = 0; index < total; index += 1) {
      const row = document.createElement("tr");
      tbody.append(row);
    }
    let completed = 0;
    let nextIndex = 0;

    async function worker() {
      while (querying && generation === queryGeneration) {
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
            result = { hit: false, reason: error?.message || String(error) };
          }
        }
        if (generation !== queryGeneration) return;
        completed += 1;
        renderProgress(completed, total);
        renderRow(index, game, result, region);
        if (index < firstPageCount) renderMarker(index, result);
        if (client?.isTokenInvalid?.()) querying = false;
        if (querying) {
          const delay = QUERY_INTERVAL_MIN_MS
            + Math.random() * (QUERY_INTERVAL_MAX_MS - QUERY_INTERVAL_MIN_MS);
          await waitFor(delay);
        }
      }
    }

    await Promise.all(Array.from({ length: QUERY_CONCURRENCY }, () => worker()));
    querying = false;
    if (generation !== queryGeneration) return;
    activeTotalRequests = activeRequestCount;
    renderProgress(total, total);
    applyHitOnlyFilter();
    if (client?.isTokenInvalid?.()) {
      const element = panel?.querySelector("[data-steam-py-plus-bargain-progress]");
      if (element) element.textContent = "已停止：AccessToken 已失效，请重新登录后刷新页面";
    }
  }

  function persistInputs() {
    setValue?.("steamPyPlusBargainMinNormalPrice", minNormalInput?.value ?? "");
    setValue?.("steamPyPlusBargainAbsLowPrice", absLowInput?.value ?? "");
    setValue?.("steamPyPlusBargainDiscountRatio", ratioInput?.value ?? "");
    setValue?.("steamPyPlusBargainAmountCap", amountCapInput?.value ?? "");
    setValue?.("steamPyPlusBargainPageCount", pageCountInput?.value ?? "");
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
  }

  function startQuery() {
    if (querying) return;
    persistInputs();
    clearMarkers();
    panel = createPanel();
    runQuery();
  }

  function mountButton() {
    if (button?.isConnected) return true;
    const anchor = document.querySelector(FILTER_ANCHOR_SELECTOR);
    if (!anchor) return false;
    document.getElementById(BARGAIN_SCAN_BUTTON_ID)?.remove();
    document.getElementById(BARGAIN_SCAN_MIN_NORMAL_INPUT_ID)?.remove();
    document.getElementById(BARGAIN_SCAN_ABS_LOW_INPUT_ID)?.remove();
    document.getElementById(BARGAIN_SCAN_RATIO_INPUT_ID)?.remove();
    document.getElementById(BARGAIN_SCAN_AMOUNT_CAP_INPUT_ID)?.remove();
    document.getElementById(BARGAIN_SCAN_PAGE_COUNT_INPUT_ID)?.remove();
    const inputStyle = "width:.7rem;height:.28rem;margin-left:.06rem;padding:0 .04rem;border:1px solid #dcdee2;border-radius:.04rem;font-size:.12rem;color:#17233d;box-sizing:border-box;vertical-align:middle;text-align:center;";
    minNormalInput = document.createElement("input");
    minNormalInput.id = BARGAIN_SCAN_MIN_NORMAL_INPUT_ID;
    minNormalInput.type = "number";
    minNormalInput.min = "0";
    minNormalInput.step = "0.1";
    minNormalInput.placeholder = "平时价≥";
    minNormalInput.title = "历史均价需达到该金额，排除本来就是低价的游戏（默认 0.6）";
    minNormalInput.style.cssText = inputStyle;
    absLowInput = document.createElement("input");
    absLowInput.id = BARGAIN_SCAN_ABS_LOW_INPUT_ID;
    absLowInput.type = "number";
    absLowInput.min = "0";
    absLowInput.step = "0.01";
    absLowInput.placeholder = "绝对价≤";
    absLowInput.title = "当前最低挂单价低于该金额即命中（默认 0.1）";
    absLowInput.style.cssText = inputStyle;
    ratioInput = document.createElement("input");
    ratioInput.id = BARGAIN_SCAN_RATIO_INPUT_ID;
    ratioInput.type = "number";
    ratioInput.min = "0";
    ratioInput.step = "1";
    ratioInput.placeholder = "比率%";
    ratioInput.title = "当前价不高于历史均价的该百分比即命中（默认 20%）";
    ratioInput.style.cssText = inputStyle;
    amountCapInput = document.createElement("input");
    amountCapInput.id = BARGAIN_SCAN_AMOUNT_CAP_INPUT_ID;
    amountCapInput.type = "number";
    amountCapInput.min = "0";
    amountCapInput.step = "0.01";
    amountCapInput.placeholder = "额度≤";
    amountCapInput.title = "当前最低挂单价不高于该金额即命中（可留空）";
    amountCapInput.style.cssText = inputStyle;
    pageCountInput = document.createElement("input");
    pageCountInput.id = BARGAIN_SCAN_PAGE_COUNT_INPUT_ID;
    pageCountInput.type = "number";
    pageCountInput.min = "1";
    pageCountInput.max = "10";
    pageCountInput.step = "1";
    pageCountInput.placeholder = "1";
    pageCountInput.title = "扫描的游戏页数，留空为 1（仅当前页）";
    pageCountInput.style.cssText = "width:.45rem;height:.28rem;margin-left:.06rem;padding:0 .04rem;border:1px solid #dcdee2;border-radius:.04rem;font-size:.12rem;color:#17233d;box-sizing:border-box;vertical-align:middle;text-align:center;";
    button = document.createElement("button");
    button.id = BARGAIN_SCAN_BUTTON_ID;
    button.type = "button";
    button.className = "ivu-btn ivu-btn-default ivu-btn-sm";
    button.textContent = "低价扫描";
    button.title = "找出平时价格不低、但现在出现明显低价挂单的游戏：历史均价需不低于“平时价”，且当前最低挂单价低于绝对价、比率或额度门限之一。";
    button.style.cssText = "margin-left:.08rem;";
    button.addEventListener("click", startQuery);
    anchor.append(minNormalInput, absLowInput, ratioInput, amountCapInput, button, pageCountInput);
    restoreInputs();
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
    button?.remove();
    button = null;
    minNormalInput?.remove();
    minNormalInput = null;
    absLowInput?.remove();
    absLowInput = null;
    ratioInput?.remove();
    ratioInput = null;
    amountCapInput?.remove();
    amountCapInput = null;
    pageCountInput?.remove();
    pageCountInput = null;
    vm = null;
  }

  return { cleanup, clearMarkers, start };
}