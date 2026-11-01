// ==UserScript==
// @name            SteamPy Plus
// @name:zh-CN      SteamPy Plus
// @name:en         SteamPy Plus
// @namespace       https://github.com/blue-bird1/scriptcat/steampy-lowest-listing-price
// @version         1.1.0.202611011305
// @description     增强购买Steampy密钥的体验：价格筛选、满减可用挂单查看、低价挂单扫描、游戏清单管理，支持鼠标中键打开Steam页面。
// @description:en  Enhance Steampy key purchasing: price filters, coupon-eligible listings, bargain listing scan, game list management, and middle-click to open Steam pages.
// @match           https://steampy.com/*
// @grant           GM_setValue
// @grant           GM_getValue
// @grant           GM_xmlhttpRequest
// @grant           GM_registerMenuCommand
// @grant           GM_notification
// @icon            https://steampy.com/logo.ico
// @require         https://scriptcat.org/lib/637/1.4.8/ajaxHooker.js#sha256=dTF50feumqJW36kBpbf6+LguSLAtLr7CEs3oPmyfbiM=
// @require         https://scriptcat.org/lib/513/2.1.0/ElementGetter.js#sha256=aQF7JFfhQ7Hi+weLrBlOsY24Z2ORjaxgZNoni7pAz5U=
// @require         https://scriptcat.org/lib/532/1.0.2/ajax.js#sha384-oDDglpYUiMPlZ/QOkx2727Nl9Pw5b5BEX7IZ/5sEgbiboYYMDfwqHbMAk7X7bo/k
// @require         https://cdnjs.cloudflare.com/ajax/libs/jquery/3.3.1/jquery.min.js
// @connect         steampy.com
// @connect         store.steampowered.com
// @connect         api.steampowered.com
// @run-at          document-start
// @license         MIT
// ==/UserScript==

/* global ajax, ajaxHooker, elmGetter, $, BigInt */

import { startSteamPyPlus } from "../lib/steampy/steampy-plus.js";

startSteamPyPlus({ ajaxHooker, elmGetter, jQuery: $ });
