const LOWEST_LISTING_BUTTON_ID = "steamPyPlusLowestListingPriceButton";
const LOWEST_LISTING_THRESHOLD_INPUT_ID = "steamPyPlusLowestListingPriceThreshold";
const LOWEST_LISTING_MAX_OUT_OF_POCKET_INPUT_ID = "steamPyPlusLowestListingPriceMaxOutOfPocket";
const LOWEST_LISTING_PAGE_COUNT_INPUT_ID = "steamPyPlusLowestListingPageCount";
const LOWEST_LISTING_THRESHOLD_STORAGE_KEY = "steamPyPlusLowestListingThreshold";
const LOWEST_LISTING_MAX_OUT_OF_POCKET_STORAGE_KEY = "steamPyPlusLowestListingMaxOutOfPocket";
const LOWEST_LISTING_QUALIFY_ONLY_STORAGE_KEY = "steamPyPlusLowestListingQualifyOnly";
const LOWEST_LISTING_PAGE_COUNT_STORAGE_KEY = "steamPyPlusLowestListingPageCount";
const LOWEST_LISTING_FILTER_EXTRA_PAGES_STORAGE_KEY = "steamPyPlusLowestListingFilterExtraPages";
const LOWEST_LISTING_FILTER_EXTRA_PAGES_MENU_ID = "steam-py-plus-lowest-filter-extra-pages";
const DEFAULT_FILTER_EXTRA_PAGES = true;
const STEAM_LINK_CLASS = "steamPyPlusVisitedSteamLink";
const LOWEST_LISTING_STYLE_ID = "steamPyPlusLowestListingStyle";
const LOWEST_LISTING_EXTRA_PAGES_STORAGE_KEY = "steamPyPlusLowestListingExtraPages";
const LOWEST_LISTING_PANEL_ID = "steamPyPlusLowestListingPricePanel";
const LOWEST_LISTING_MARKER_ATTR = "data-steam-py-plus-lowest-price";
const FILTER_ANCHOR_SELECTOR = ".tag.flex-row.align-items-center";
const GAME_BLOCK_SELECTOR = ".gameblock";
const SUPPORTED_REGIONS = new Set(["cn", "ru", "us", "tl"]);
const QUERY_CONCURRENCY = 2;
const QUERY_INTERVAL_MIN_MS = 300;
const QUERY_INTERVAL_MAX_MS = 600;
const EXTRA_PAGES = 3;

export function isAllBelowThreshold(games, threshold) {
  if (threshold === null || threshold === undefined) return false;
  if (!Array.isArray(games) || games.length === 0) return false;
  return games.every((game) => Number(game?.keyPrice) < Number(threshold));
}

export function normalizeSteamPyRegion(value) {
  const region = String(value ?? "").trim().toLowerCase();
  return SUPPORTED_REGIONS.has(region) ? region : "cn";
}

export function parseThreshold(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

export function isPriceInRange(price, threshold, maxPrice) {
  const number = Number(price);
  return (
    Number.isFinite(number)
    && number >= Number(threshold)
    && number <= Number(maxPrice)
  );
}

export function parseInRangeListing(content, threshold, maxPrice) {
  if (!Array.isArray(content)) return null;
  const found = content
    .filter((item) => Number(item?.stock ?? 1) > 0)
    .map((item) => ({ price: Number(item?.keyPrice), stock: Number(item?.stock ?? 1) }))
    .filter((item) => Number.isFinite(item.price) && isPriceInRange(item.price, threshold, maxPrice))
    .sort((first, second) => first.price - second.price);
  return found[0] || null;
}

export function parseLowestInStockListing(content) {
  if (!Array.isArray(content)) return null;
  const available = content
    .filter((item) => Number(item?.keyPrice) > 0 && Number(item?.stock ?? 1) > 0)
    .sort((first, second) => Number(first.keyPrice) - Number(second.keyPrice));
  const lowest = available[0];
  if (!lowest) return null;
  return {
    lowestPrice: Number(lowest.keyPrice),
    stock: Number(lowest.stock ?? 1),
    sold: Number(lowest.sold ?? 0),
  };
}

function formatPrice(value) {
  const number = Number(value);
  return Number.isFinite(number) ? `￥${number.toFixed(2)}` : "--";
}

function waitFor(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function createSteamPyLowestListingPriceController({
  client,
  shouldShow = null,
  getValue = GM_getValue,
  setValue = GM_setValue,
} = {}) {
  let vm = null;
  let button = null;
  let thresholdInput = null;
  let maxOutOfPocketInput = null;
  let pageCountInput = null;
  let qualifyOnlyCheckbox = null;
  let panel = null;
  let querying = false;
  let queryGeneration = 0;
  let menusRegistered = false;
  let activePageCount = 1;
  let activeFilterExtraPages = true;
  let activeLastCheckedPage = 1;
  let activeBasePageNumber = 1;
  let activeRequestCount = 0;
  let activeTotalRequests = 0;

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

  function isFilterExtraPagesEnabled() {
    return Boolean(getValue?.(LOWEST_LISTING_FILTER_EXTRA_PAGES_STORAGE_KEY, DEFAULT_FILTER_EXTRA_PAGES));
  }

  function registerMenu() {
    if (menusRegistered || typeof GM_registerMenuCommand !== "function") return;
    menusRegistered = true;
    const enabled = isFilterExtraPagesEnabled();
    GM_registerMenuCommand(
      `跨页套用价格筛选：${enabled ? "已开启（点击关闭）" : "已关闭（点击开启）"}`,
      () => {
        const next = !isFilterExtraPagesEnabled();
        setValue?.(LOWEST_LISTING_FILTER_EXTRA_PAGES_STORAGE_KEY, next);
        if (typeof GM_notification === "function") {
          GM_notification(`跨页套用价格筛选已${next ? "开启" : "关闭"}`);
        }
        menusRegistered = false;
        registerMenu();
      },
      { id: LOWEST_LISTING_FILTER_EXTRA_PAGES_MENU_ID },
    );
  }

  let closeWaiters = [];

  function closePanel() {
    queryGeneration += 1;
    querying = false;
    const waiters = closeWaiters;
    closeWaiters = [];
    waiters.forEach((resolve) => resolve());
    panel?.remove();
    panel = null;
    qualifyOnlyCheckbox = null;
  }

  function clearMarkers() {
    closePanel();
    document.querySelectorAll(`[${LOWEST_LISTING_MARKER_ATTR}]`).forEach((marker) => marker.remove());
  }

  function renderMarker(index, result) {
    const block = gameBlocks()[index];
    if (!block) return;
    const existing = block.querySelector(`[${LOWEST_LISTING_MARKER_ATTR}]`);
    existing?.remove();
    const marker = document.createElement("div");
    marker.setAttribute(LOWEST_LISTING_MARKER_ATTR, "true");
    let text;
    let color;
    if (result.ok) {
      text = `✓ 可用 ${formatPrice(result.price)}`;
      color = "#16a34a";
    } else if (result.skip) {
      text = "页面价过高";
      color = "#999";
    } else {
      text = result.error || "查询失败";
      color = "#f59e0b";
    }
    marker.textContent = text;
    marker.style.cssText = `font-size:.12rem;line-height:.16rem;color:${color};padding:0 .04rem;`;
    const priceContainer = block.querySelector(".gameFoot");
    (priceContainer || block).append(marker);
  }

  function createPanel() {
    document.getElementById(LOWEST_LISTING_STYLE_ID)?.remove();
    const style = document.createElement("style");
    style.id = LOWEST_LISTING_STYLE_ID;
    style.textContent = `.${STEAM_LINK_CLASS} { color: #1a9fff; } .${STEAM_LINK_CLASS}:visited { color: #9a9a9a; }`;
    document.head.appendChild(style);
    const overlay = document.createElement("div");
    overlay.id = LOWEST_LISTING_PANEL_ID;
    overlay.style.cssText = "position:fixed;z-index:10000;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.38);";
    const dialog = document.createElement("section");
    dialog.style.cssText = "width:min(8rem,94vw);height:min(80vh,8.5rem);display:flex;flex-direction:column;gap:.12rem;padding:.2rem;border-radius:.08rem;background:#fff;color:#17233d;box-sizing:border-box;";
    const header = document.createElement("div");
    header.style.cssText = "display:flex;align-items:center;justify-content:space-between;";
    const title = document.createElement("h3");
    title.style.cssText = "margin:0;font-size:.18rem;";
    title.textContent = "满减可用挂单";
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
    progress.dataset.steamPyPlusLowestProgress = "true";
    progress.style.cssText = "font-size:.13rem;color:#666;";
    const qualifyOnly = document.createElement("label");
    qualifyOnly.style.cssText = "display:flex;align-items:center;gap:.05rem;font-size:.13rem;color:#17233d;cursor:pointer;";
    const savedQualifyOnly = getValue?.(LOWEST_LISTING_QUALIFY_ONLY_STORAGE_KEY, true);
    const qualifyCheckbox = document.createElement("input");
    qualifyCheckbox.type = "checkbox";
    qualifyCheckbox.checked = savedQualifyOnly !== false;
    qualifyCheckbox.dataset.steamPyPlusLowestQualifyOnly = "true";
    qualifyCheckbox.style.cssText = "margin:0;cursor:pointer;";
    qualifyCheckbox.addEventListener("change", () => {
      setValue?.(LOWEST_LISTING_QUALIFY_ONLY_STORAGE_KEY, qualifyCheckbox.checked);
      applyQualifyFilter();
    });
    qualifyOnlyCheckbox = qualifyCheckbox;
    qualifyOnly.append(qualifyCheckbox, document.createTextNode("仅显示可用"));
    progressRow.append(progress, qualifyOnly);

    const tableWrap = document.createElement("div");
    tableWrap.style.cssText = "flex:1;overflow:auto;min-height:0;";
    const table = document.createElement("table");
    table.style.cssText = "width:100%;border-collapse:collapse;font-size:.13rem;";
    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    headRow.style.cssText = "background:#f5f7fa;";
    [["游戏", "1"], ["可用挂单价", "0.9"], ["状态", "1"]].forEach(([text]) => {
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

  function renderProgress(completed, total) {
    const element = panel?.querySelector("[data-steam-py-plus-lowest-progress]");
    if (!element) return;
    const qualifyCount = panel
      ? [...panel.querySelectorAll("tbody tr[data-qualify='1']")].length
      : 0;
    const currentPage = Math.max(1, activeLastCheckedPage - activeBasePageNumber + 1);
    const filterLabel = activeFilterExtraPages ? "开" : "关";
    element.textContent = `已处理 ${completed}/${total} · 可用 ${qualifyCount} · 第 ${currentPage}/${activePageCount} 页 · 筛选 ${filterLabel} · 请求 ${activeRequestCount}/${activeTotalRequests}`;
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
    const qualify = result.ok;
    row.dataset.qualify = qualify ? "1" : "0";
    row.style.display = qualifyOnlyCheckbox?.checked && !qualify ? "none" : "";
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
      detailLink.title = "打开 SteamPy 详情页";
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
      steamLink.title = "打开 Steam 商店页";
      steamLink.className = STEAM_LINK_CLASS;
      steamLink.style.cssText = "margin-left:auto;font-size:.11rem;text-decoration:none;";
      name.append(steamLink);
    }
    const price = document.createElement("td");
    price.style.cssText = "padding:.06rem .1rem;border:1px solid #e8eaec;font-weight:bold;";
    const status = document.createElement("td");
    status.style.cssText = "padding:.06rem .1rem;border:1px solid #e8eaec;";
    if (result.ok) {
      price.textContent = formatPrice(result.price);
      status.textContent = "✓ 可用";
      status.style.color = "#16a34a";
    } else if (result.skip) {
      price.textContent = "--";
      status.textContent = "页面价过高";
      status.style.color = "#999";
    } else {
      const lowest = result.lowestPrice !== null && result.lowestPrice !== undefined
        ? formatPrice(result.lowestPrice)
        : null;
      const qualifying = result.lowestQualifyingPrice !== null && result.lowestQualifyingPrice !== undefined
        ? formatPrice(result.lowestQualifyingPrice)
        : null;
      if (lowest && qualifying) {
        price.textContent = `最低 ${lowest} · 达门槛最低价 ${qualifying}`;
      } else if (lowest) {
        price.textContent = `最低 ${lowest}`;
      } else {
        price.textContent = "--";
      }
      status.textContent = result.error || "查询失败";
      status.style.color = "#f59e0b";
    }
    row.append(name, price, status);
  }

  function applyQualifyFilter() {
    if (!panel) return;
    const onlyQualify = qualifyOnlyCheckbox?.checked;
    panel.querySelectorAll("tbody tr").forEach((row) => {
      const qualify = row.dataset.qualify === "1";
      row.style.display = onlyQualify && !qualify ? "none" : "";
    });
  }

  async function queryGame(game, region, threshold, maxPrice) {
    const gameId = gameIdOf(game);
    if (gameId === null || gameId === undefined || gameId === "") {
      return { ok: false, error: "缺少 gameId" };
    }
    activeRequestCount += 1;
    const firstResponse = await client.fetchKeySaleList({ region, gameId });
    const firstContent = firstResponse?.content ?? firstResponse?.result?.content ?? firstResponse?.result ?? firstResponse;
    const firstListings = Array.isArray(firstContent) ? firstContent : [];
    const foundInFirst = parseInRangeListing(firstListings, threshold, maxPrice);
    if (foundInFirst) {
      return { ok: true, price: foundInFirst.price, stock: foundInFirst.stock, source: "listSale" };
    }
    const listings = [...firstListings];
    const hasQualifyingPrice = firstListings.some((item) => Number(item?.keyPrice) >= threshold);
    if (hasQualifyingPrice) {
      for (let pageNumber = 2; pageNumber <= EXTRA_PAGES; pageNumber += 1) {
        try {
          activeRequestCount += 1;
          const pageResponse = await client.fetchKeySaleList({ region, gameId, pageNumber });
          const pageContent = pageResponse?.content ?? pageResponse?.result?.content ?? pageResponse?.result ?? pageResponse;
          const pageListings = Array.isArray(pageContent) ? pageContent : [];
          if (!pageListings.length) break;
          listings.push(...pageListings);
          const found = parseInRangeListing(pageListings, threshold, maxPrice);
          if (found) {
            return { ok: true, price: found.price, stock: found.stock, source: "listSale" };
          }
        } catch {
          break;
        }
        await waitFor(QUERY_INTERVAL_MIN_MS);
      }
    }
    const lowest = parseLowestInStockListing(listings);
    const qualifying = parseInRangeListing(listings, threshold, Infinity);
    return {
      ok: false,
      error: "无达标挂单",
      lowestPrice: lowest?.lowestPrice ?? null,
      lowestQualifyingPrice: qualifying?.price ?? null,
    };
  }

  async function runQuery() {
    if (querying) return;
    const threshold = parseThreshold(thresholdInput?.value);
    const maxOutOfPocket = parseThreshold(maxOutOfPocketInput?.value);
    const maxPrice = maxOutOfPocket === null ? Infinity : (threshold ?? 0) + maxOutOfPocket;
    const region = resolveRegion();
    const generation = ++queryGeneration;
    const firstPageGames = gameList();
    const firstPageCount = firstPageGames.length;
    if (threshold === null) {
      const element = panel?.querySelector("[data-steam-py-plus-lowest-progress]");
      if (element) element.textContent = "请先输入满减门槛金额";
      return;
    }
    const pageCount = Math.max(1, Math.floor(parseThreshold(pageCountInput?.value) ?? 1));
    activePageCount = pageCount;
    activeFilterExtraPages = isFilterExtraPagesEnabled();
    const currentPageNumber = Number(vm?.searchForm?.pageNumber) || 1;
    activeBasePageNumber = currentPageNumber;
    activeLastCheckedPage = currentPageNumber;
    activeRequestCount = 0;
    renderProgress(0, firstPageCount);
    let games = firstPageGames;
    if (pageCount > 1 && client?.fetchSteamGameKeyHot) {
      const searchForm = vm?.searchForm || {};
      const pageSize = Number(searchForm.pageSize) || firstPageCount || 30;
      const collected = [...firstPageGames];
      for (let pageNumber = currentPageNumber + 1; pageNumber <= currentPageNumber + pageCount - 1; pageNumber += 1) {
        try {
          activeRequestCount += 1;
          const pageResponse = await client.fetchSteamGameKeyHot({ ...searchForm, pageNumber, pageSize });
          activeLastCheckedPage = pageNumber;
          const pageGames = pageResponse?.content ?? pageResponse?.result?.content ?? [];
          if (!Array.isArray(pageGames) || pageGames.length === 0) break;
          const usableGames = !activeFilterExtraPages || typeof shouldShow !== "function"
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
    activeTotalRequests = total * EXTRA_PAGES + (pageCount > 1 ? pageCount - 1 : 0);
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
          result = { ok: false, error: "AccessToken 已失效" };
          querying = false;
        } else {
          const closePromise = new Promise((resolve) => closeWaiters.push(resolve));
          try {
            const outcome = await Promise.race([
              queryGame(game, region, threshold, maxPrice).then((value) => ({ closed: false, value })),
              closePromise.then(() => ({ closed: true })),
            ]);
            if (outcome.closed) return;
            result = outcome.value;
          } catch (error) {
            result = { ok: false, error: error?.message || String(error) };
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
    applyQualifyFilter();
    if (client?.isTokenInvalid?.()) {
      const element = panel?.querySelector("[data-steam-py-plus-lowest-progress]");
      if (element) element.textContent = "已停止：AccessToken 已失效，请重新登录后刷新页面";
    }
  }

  function persistInputs() {
    setValue?.(LOWEST_LISTING_THRESHOLD_STORAGE_KEY, thresholdInput?.value ?? "");
    setValue?.(LOWEST_LISTING_MAX_OUT_OF_POCKET_STORAGE_KEY, maxOutOfPocketInput?.value ?? "");
    setValue?.(LOWEST_LISTING_PAGE_COUNT_STORAGE_KEY, pageCountInput?.value ?? "");
  }

  function restoreInputs() {
    const threshold = getValue?.(LOWEST_LISTING_THRESHOLD_STORAGE_KEY, "");
    const maxOutOfPocket = getValue?.(LOWEST_LISTING_MAX_OUT_OF_POCKET_STORAGE_KEY, "");
    const pageCount = getValue?.(LOWEST_LISTING_PAGE_COUNT_STORAGE_KEY, "");
    if (thresholdInput) thresholdInput.value = String(threshold ?? "");
    if (maxOutOfPocketInput) maxOutOfPocketInput.value = String(maxOutOfPocket ?? "");
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
    if (button?.isConnected && thresholdInput?.isConnected && maxOutOfPocketInput?.isConnected && pageCountInput?.isConnected) return true;
    const anchor = document.querySelector(FILTER_ANCHOR_SELECTOR);
    if (!anchor) return false;
    document.getElementById(LOWEST_LISTING_BUTTON_ID)?.remove();
    document.getElementById(LOWEST_LISTING_THRESHOLD_INPUT_ID)?.remove();
    document.getElementById(LOWEST_LISTING_MAX_OUT_OF_POCKET_INPUT_ID)?.remove();
    document.getElementById(LOWEST_LISTING_PAGE_COUNT_INPUT_ID)?.remove();
    thresholdInput = document.createElement("input");
    thresholdInput.id = LOWEST_LISTING_THRESHOLD_INPUT_ID;
    thresholdInput.type = "number";
    thresholdInput.min = "0";
    thresholdInput.step = "0.01";
    thresholdInput.placeholder = "满减门槛";
    thresholdInput.title = "挂单价格需达到该金额才能使用满减券";
    thresholdInput.style.cssText = "width:.9rem;height:.28rem;margin-left:.08rem;padding:0 .06rem;border:1px solid #dcdee2;border-radius:.04rem;font-size:.13rem;color:#17233d;box-sizing:border-box;vertical-align:middle;";
    maxOutOfPocketInput = document.createElement("input");
    maxOutOfPocketInput.id = LOWEST_LISTING_MAX_OUT_OF_POCKET_INPUT_ID;
    maxOutOfPocketInput.type = "number";
    maxOutOfPocketInput.min = "0";
    maxOutOfPocketInput.step = "0.01";
    maxOutOfPocketInput.placeholder = "自付≤";
    maxOutOfPocketInput.title = "用券后自付金额上限（挂单价上限 = 满减门槛 + 自付上限）";
    maxOutOfPocketInput.style.cssText = "width:.9rem;height:.28rem;margin-left:.08rem;padding:0 .06rem;border:1px solid #dcdee2;border-radius:.04rem;font-size:.13rem;color:#17233d;box-sizing:border-box;vertical-align:middle;";
    pageCountInput = document.createElement("input");
    pageCountInput.id = LOWEST_LISTING_PAGE_COUNT_INPUT_ID;
    pageCountInput.type = "number";
    pageCountInput.min = "1";
    pageCountInput.max = "10";
    pageCountInput.step = "1";
    pageCountInput.placeholder = "1";
    pageCountInput.title = "查询的游戏页数，留空为 1（仅当前页）；大于1时，若第一页并非全是超低价，会自动继续查后续页游戏（后续页为未筛选列表）。";
    pageCountInput.style.cssText = "width:.5rem;height:.28rem;margin-left:.08rem;padding:0 .04rem;border:1px solid #dcdee2;border-radius:.04rem;font-size:.13rem;color:#17233d;box-sizing:border-box;vertical-align:middle;text-align:center;";
    button = document.createElement("button");
    button.id = LOWEST_LISTING_BUTTON_ID;
    button.type = "button";
    button.className = "ivu-btn ivu-btn-default ivu-btn-sm";
    button.textContent = "查看低价";
    button.title = "查看游戏是否有符合条件的有库存挂单：挂单价需不低于“满减门槛”，且不超过“门槛+自付上限”（自付可留空表示不设上限）。结果标注在卡片上并以面板列出。";
    button.style.cssText = "margin-left:.08rem;";
    button.addEventListener("click", startQuery);
    anchor.append(thresholdInput, maxOutOfPocketInput, button, pageCountInput);
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
    thresholdInput?.remove();
    thresholdInput = null;
    maxOutOfPocketInput?.remove();
    maxOutOfPocketInput = null;
    pageCountInput?.remove();
    pageCountInput = null;
    qualifyOnlyCheckbox = null;
    vm = null;
  }

  return { cleanup, clearMarkers, registerMenu, start };
}