// ==UserScript==
// @name         抖音网页版精简版
// @namespace    https://github.com/Teristans/douyin-pure
// @version      1.5.0
// @description  精简抖音网页版：去顶栏与左侧栏、过滤广告与弹窗；搜索与频道收进贴右边缘的竖排图标列，与作者头像/点赞同列；智能把视频清晰度调到 1080；保留播放控制条、设置、点赞、评论、作者头像等互动元素。
// @author       Teristans
// @license      GPL-3.0-or-later
// @homepage     https://github.com/Teristans/douyin-pure
// @match        *://www.douyin.com/*
// @exclude      *://www.douyin.com/search/*
// @exclude      *://www.douyin.com/user/*
// @grant        GM_addStyle
// @run-at       document-end
// ==/UserScript==

/*
 * 抖音网页版精简版 (douyin-pure)
 * Copyright (C) 2026-present Teristans
 * 选择器参考抖音网页版实测结构（2026）：#douyin-header / #douyin-navigation /
 * #douyin-right-container / #slidelist / .basePlayerContainer .positionBox /
 * data-e2e 系列。许可证：GPL-3.0-or-later
 *
 * 设计原则：
 * 1) 只隐藏「chrome 类界面」（顶栏、左栏）与明确的广告/弹窗，不碰播放器内部任何元素，
 *    因此播放控制条、设置按钮、右侧点赞/评论/作者头像/收藏/分享均原样保留。
 * 2) 搜索栏用原生 DOM 搭建并提交到抖音官方搜索路径，不依赖抖音自身 React 事件，改版更稳。
 * 3) 频道切换【不依赖猜测的 class】。抖音 class 哈希化且频繁改版，.tab-recommend 之类
 *    极易失配。这里改为运行时自适应定位：
 *      a. 文本精确匹配（"推荐"/"精选"等文字，最稳）
 *      b. data-e2e 语义属性匹配
 *      c. 历史 class 兜底
 *    找到后调用原生 element.click() 走抖音自身路由；只有完全找不到入口时才回退 URL。
 * 4) 清晰度智能调到 1080：双保险——(a) 页面播放器读 sessionStorage["MANUAL_SWITCH"]，
 *    写入 1080P 档位 JSON 并轮询保持约 21s，不依赖菜单 DOM；(b) 若清晰度菜单
 *    [data-e2e="quality-selector"] 可见，按文本智能选 1080（没有 1080 就选不超过
 *    1080 的最高档）。用户手动切换后本脚本不再干预。
 * 5) 搜索与频道收进右侧竖排图标列：与抖音自己的作者头像/点赞/评论/收藏/分享同处一条竖线。
 *    整列固定贴右边缘（right:12px、top:76px），不做任何动态测量：不找操作列、不量图标中心、
 *    不随换视频重排，所以位置一次到位后就不会再动。搜索点击后向左展开输入框，回车即搜。
 * 6) 暴露 diagnose() 供排查：在页面控制台运行 DouyinPure.diagnose() 打印真实 DOM 候选。
 */
(function () {
  "use strict";

  var SEARCH_PATH = "https://www.douyin.com/search/";
  var SEARCH_QUERY = "?type=general";
  var RECOMMEND_URL = "https://www.douyin.com/?is_from_mobile_home=1&recommend=1";
  var CHANNEL_MANUAL_KEY = "douyin-pure-channel-manual-v13";
  var CHANNEL_LAST_KEY = "douyin-pure-channel-v13";
  var AUTO_DONE_KEY = "douyin-pure-auto-done-v13";

  // 打开首页时是否自动进入推荐流。改成 false 可保留「打开即精选」。
  var AUTO_RECOMMEND = true;

  // 是否智能把视频清晰度调到 1080。改成 false 可关闭。
  var AUTO_QUALITY_1080 = true;

  // 抖音播放器读取的清晰度手动档位 key（实测）。写入后播放器据此切换。
  var QUALITY_STORAGE_KEY = "MANUAL_SWITCH";
  var QUALITY_MANUAL_KEY = "douyin-pure-quality-manual-v14";

  // 1080P 档位对象（来自抖音实测档位表：gearName "高清 1080P", qualityType 2）。
  var GEAR_1080 = {
    done: 1,
    gearClarity: "5",
    gearName: "高清 1080P",
    gearType: 1,
    qualityType: 2,
  };

  // 清晰度档位识别规则：rank 越大画质越高；target=1080 时优先选 <=1080 的最高档。
  // match 用正则从档位文本里提取档位值（P 前的数字，或 2K/4K）。
  var QUALITY_GEARS = [
    { id: "smart", test: /智能|自动/i, height: 0 },
    { id: "fast", test: /极速|流畅/i, height: 0 },
    { id: "360", test: /360/i, height: 360 },
    { id: "480", test: /480/i, height: 480 },
    { id: "540", test: /540/i, height: 540 },
    { id: "720", test: /720/i, height: 720 },
    { id: "1080", test: /1080/i, height: 1080 },
    { id: "2k", test: /2k|1440/i, height: 1440 },
    { id: "4k", test: /4k|2160/i, height: 2160 },
  ];

  // label 用于文本精确匹配（最稳）；e2e 用于语义属性匹配；classHints 仅作兜底。
  var CHANNELS = [
    {
      id: "recommend", label: "推荐", e2e: ["tab-recommend", "recommend-tab", "nav-recommend"],
      classHints: [".tab-recommend"], href: RECOMMEND_URL,
    },
    {
      id: "jingxuan", label: "精选", e2e: ["tab-discover", "tab-jingxuan", "discover-tab"],
      classHints: [".tab-discover", ".tab-jingxuan"], href: "https://www.douyin.com/jingxuan",
    },
    {
      id: "follow", label: "关注", e2e: ["tab-follow", "follow-tab"],
      classHints: [".tab-follow"], href: "https://www.douyin.com/follow",
    },
    {
      id: "friend", label: "朋友", e2e: ["tab-friend", "friend-tab"],
      classHints: [".tab-friend"], href: "https://www.douyin.com/friend",
    },
  ];

  // 图标集：22px 视区下为清晰起见统一 24 网格、线宽 2。
  // 频道用实心图形（与抖音右侧操作列的心形/评论气泡风格一致），搜索用描边放大镜。
  var SVG_OPEN = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">';
  var ICONS = {
    // 放大镜用实心圆环（外圈 + 内圈 evenodd 挖空 + 手柄），视觉重量才和旁边的实心图标一致；
    // 描边版在深色视频上明显偏淡。同理，外圈与内圈必须在同一条 d 里才会挖空。
    search: SVG_OPEN +
      '<path d="M10.5 2.6a7.9 7.9 0 1 0 4.9 14.1l4.1 4.1 1.4-1.4-4.1-4.1A7.9 7.9 0 0 0 10.5 2.6zm0 3a4.9 4.9 0 1 1 0 9.8 4.9 4.9 0 0 1 0-9.8z" fill="currentColor" fill-rule="evenodd"></path>' +
      "</svg>",
    // 火焰：推荐流的「热」。
    // 注意：evenodd 只在**单个 path 内**算子路径嵌套，外焰 + 内焰必须合并进同一条 d，
    // 拆成两个 <path> 会各自填满（踩过一次，渲染成实心饼）。
    recommend: SVG_OPEN +
      '<path d="M13.5 0.67s0.74 2.65 0.74 4.8c0 2.06-1.35 3.73-3.41 3.73-2.07 0-3.63-1.67-3.63-3.73l0.03-0.36C5.21 7.51 4 10.62 4 14c0 4.42 3.58 8 8 8s8-3.58 8-8C20 8.61 17.41 3.8 13.5 0.67z M11.71 19c-1.78 0-3.22-1.4-3.22-3.14 0-1.62 1.05-2.76 2.81-3.12 1.77-0.36 3.6-1.21 4.62-2.58 0.39 1.29 0.59 2.65 0.59 4.04 0 2.65-2.15 4.8-4.8 4.8z" fill="currentColor" fill-rule="evenodd"></path>' +
      "</svg>",
    // 四宫格：精选合集
    jingxuan: SVG_OPEN +
      '<path d="M4 4h6.6v6.6H4zM13.4 4H20v6.6h-6.6zM4 13.4h6.6V20H4zM13.4 13.4H20V20h-6.6z" fill="currentColor"></path>' +
      "</svg>",
    // 心：关注
    follow: SVG_OPEN +
      '<path d="M12 20.4S3.6 15.1 3.6 9.5A4.8 4.8 0 0 1 12 6.3a4.8 4.8 0 0 1 8.4 3.2c0 5.6-8.4 10.9-8.4 10.9z" fill="currentColor"></path>' +
      "</svg>",
    // 双人：朋友
    friend: SVG_OPEN +
      '<circle cx="9" cy="8.2" r="3.3" fill="currentColor"></circle>' +
      '<path d="M2.9 19.4c0-3.4 2.8-5.8 6.1-5.8s6.1 2.4 6.1 5.8z" fill="currentColor"></path>' +
      '<circle cx="17.1" cy="9.2" r="2.5" fill="currentColor"></circle>' +
      '<path d="M16.2 13.5c2.8 0 4.9 2 4.9 4.6h-3.3c0-1.7-.6-3.2-1.6-4.6z" fill="currentColor"></path>' +
      "</svg>",
  };

  // 精简样式：隐藏项集中在此，便于维护；被保留的播放/互动元素不出现在这里。
  var PURE_STYLE = [
    /* ---------- 1. 去除顶栏与左侧栏 ---------- */
    "#douyin-header,",
    '[id^="douyin-header-"],',
    "#component-header,",
    "#douyin-navigation,",
    '[data-e2e="douyin-navigation"] {',
    "  display: none !important;",
    "}",

    /* ---------- 2. 内容区铺满整屏 ---------- */
    "#douyin-right-container {",
    "  width: 100vw !important;",
    "  max-width: 100vw !important;",
    "  margin-left: 0 !important;",
    "  padding-top: 0 !important;",
    "  --header-height: 0px !important;",
    "}",
    "#slidelist,",
    '[data-e2e="slideList"] {',
    "  width: 100% !important;",
    "  height: 100vh !important;",
    "  height: 100dvh !important;",
    "  margin: 0 !important;",
    "}",

    /* ---------- 3. 过滤广告 / 登录与下载弹窗 / 推广卡 ---------- */
    '[id^="related-video-card-login-guide"],',
    '[class*="login-guide"],',
    '[class*="login-modal"],',
    '[class*="login-popup"],',
    '[class*="login-mask"],',
    '[data-e2e="login-modal"],',
    "#douyin-web-download-guide-container,",
    '[class*="download-guide"],',
    '[class*="app-download"],',
    '[class*="ad-banner"],',
    '[class*="promotion-card"],',
    '[data-is-ad="true"],',
    ".h5-ad-video-card,",
    '.card-item:has(.h5-ad-video-card),',
    '.card-item:has([data-is-ad="true"]),',
    'a[download*="douyin-downloader"] {',
    "  display: none !important;",
    "}",

    /* ---------- 4. 右侧竖排图标列（搜索 + 频道） ----------
       与抖音自己的作者头像/点赞/评论/收藏/分享排在同一条竖线上。
       位置就是这两个数，脚本不做任何测量或二次定位：贴右边缘、距顶 76px。
       align-items: flex-end 让展开搜索时整列只向左长，圆形图标不会跟着位移。 */
    ".douyin-pure-rail {",
    "  position: fixed;",
    "  right: 12px;",
    "  top: 76px;",
    "  z-index: 2147483000;",
    "  display: flex;",
    "  flex-direction: column;",
    "  align-items: flex-end;",
    "  gap: 14px;",
    "  pointer-events: none;",
    "}",
    ".douyin-pure-rail > * {",
    "  pointer-events: auto;",
    "}",

    /* 统一个按钮外观：40x40 圆形、半透明底、图标居中 */
    ".douyin-pure-rail a,",
    ".douyin-pure-rail button {",
    "  display: flex;",
    "  align-items: center;",
    "  justify-content: center;",
    "  width: 40px;",
    "  height: 40px;",
    "  padding: 0;",
    "  border: 0;",
    "  border-radius: 50%;",
    "  background: rgba(0, 0, 0, 0.42);",
    "  color: #fff;",
    "  opacity: 0.82;",
    "  cursor: pointer;",
    "  text-decoration: none;",
    "  box-sizing: border-box;",
    "  box-shadow: 0 1px 6px rgba(0, 0, 0, 0.35);",
    "  transition: opacity 0.18s ease, transform 0.18s ease, background 0.18s ease;",
    "}",
    ".douyin-pure-rail a:hover,",
    ".douyin-pure-rail button:hover {",
    "  opacity: 1;",
    "  transform: scale(1.08);",
    "  background: rgba(0, 0, 0, 0.5);",
    "}",
    ".douyin-pure-rail svg {",
    "  display: block;",
    "  width: 22px;",
    "  height: 22px;",
    "  fill: currentColor;",
    "}",
    /* 当前频道高亮：白底黑图标，和点赞后的实心感一致 */
    '.douyin-pure-rail a[aria-current="page"] {',
    "  background: #fff;",
    "  color: #161823;",
    "  opacity: 1;",
    "}",

    /* 频道组：与搜索同一竖列，纵向排列、居中，间距一致 */
    ".douyin-pure-channels {",
    "  display: flex;",
    "  flex-direction: column;",
    "  align-items: center;",
    "  gap: 14px;",
    "  margin: 0;",
    "  padding: 0;",
    "}",

    /* 纯图标按钮的可读文本：只给读屏与测试用，视觉上不可见 */
    ".douyin-pure-sr {",
    "  position: absolute;",
    "  width: 1px;",
    "  height: 1px;",
    "  margin: -1px;",
    "  padding: 0;",
    "  overflow: hidden;",
    "  clip: rect(0 0 0 0);",
    "  white-space: nowrap;",
    "  border: 0;",
    "}",

    /* ---------- 5. 搜索：收起是圆形图标，点开向左展开输入框 ---------- */
    ".douyin-pure-search {",
    "  display: flex;",
    "  align-items: center;",
    "  width: 40px;",
    "  height: 40px;",
    "  padding: 0;",
    "  overflow: hidden;",
    "  border-radius: 20px;",
    "  background: rgba(0, 0, 0, 0.42);",
    "  opacity: 0.82;",
    "  box-sizing: border-box;",
    "  box-shadow: 0 1px 6px rgba(0, 0, 0, 0.35);",
    "  transition: width 0.22s ease, opacity 0.18s ease, background 0.18s ease;",
    "}",
    ".douyin-pure-search:hover {",
    "  opacity: 1;",
    "  background: rgba(0, 0, 0, 0.5);",
    "}",
    /* 展开态向左生长（整列贴右，容器宽度只增不减在右侧），输入框在左、按钮在右 */
    ".douyin-pure-rail .douyin-pure-search.is-open {",
    "  width: 216px;",
    "  opacity: 1;",
    "  background: rgba(0, 0, 0, 0.62);",
    "  -webkit-backdrop-filter: blur(10px);",
    "  backdrop-filter: blur(10px);",
    "}",
    /* 收起时必须连 padding 一起归零：留着 14px 左内边距会把右侧按钮挤出 36px 的圆圈，
       图标会被 overflow:hidden 裁掉一半（实测踩过，放大镜只剩半个环）。 */
    ".douyin-pure-search input {",
    "  flex: 1 1 0;",
    "  width: 0;",
    "  min-width: 0;",
    "  border: 0;",
    "  outline: 0;",
    "  padding: 0;",
    "  background: transparent;",
    "  color: #fff;",
    "  font-size: 13px;",
    "  opacity: 0;",
    "  pointer-events: none;",
    "  transition: opacity 0.18s ease;",
    "}",
    ".douyin-pure-rail .douyin-pure-search.is-open input {",
    "  padding: 0 0 0 14px;",
    "  opacity: 1;",
    "  pointer-events: auto;",
    "}",
    ".douyin-pure-search input::placeholder {",
    "  color: rgba(255, 255, 255, 0.7);",
    "}",
    /* 收起时按钮占满整个圆圈（宽 100%），图标才是真正居中；
       固定 40px 会在 36/32px 的圆圈里溢出，被 overflow 裁掉右侧、图标偏右。 */
    ".douyin-pure-search button {",
    "  flex: 0 0 100%;",
    "  background: transparent;",
    "}",
    ".douyin-pure-rail .douyin-pure-search.is-open button {",
    "  flex: 0 0 40px;",
    "}",
    ".douyin-pure-search button:hover {",
    "  background: transparent;",
    "  transform: none;",
    "}",
  ].join("\n");

  function log() {
    try {
      if (typeof console !== "undefined" && console.log) {
        console.log.apply(console, ["[douyin-pure]"].concat([].slice.call(arguments)));
      }
    } catch (e) { /* 忽略 */ }
  }

  function injectStyle(css) {
    if (typeof GM_addStyle === "function") {
      GM_addStyle(css);
      return;
    }
    var style = document.createElement("style");
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
  }

  function buildSearchUrl(keyword) {
    return SEARCH_PATH + encodeURIComponent(keyword) + SEARCH_QUERY;
  }

  /* ==================== 右侧竖排图标列 ==================== */

  // 整列容器：搜索 + 4 个频道同处一条竖线，位置固定由 CSS 决定（贴右边缘）。
  function mountRail() {
    var rail = document.getElementById("douyin-pure-rail");
    if (rail) return rail;
    rail = document.createElement("div");
    rail.id = "douyin-pure-rail";
    rail.className = "douyin-pure-rail";
    (document.body || document.documentElement).appendChild(rail);
    return rail;
  }

  function openSearch(form, input) {
    form.classList.add("is-open");
    try {
      input.focus();
      input.select();
    } catch (e) { /* 忽略 */ }
  }

  function closeSearch(form) {
    form.classList.remove("is-open");
  }

  function mountSearch() {
    if (document.getElementById("douyin-pure-search")) return;
    var form = document.createElement("form");
    form.id = "douyin-pure-search";
    form.className = "douyin-pure-search";
    form.setAttribute("autocomplete", "off");
    form.setAttribute("role", "search");
    var input = document.createElement("input");
    input.type = "search";
    input.placeholder = "搜索抖音";
    input.setAttribute("aria-label", "搜索抖音");
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var keyword = input.value.trim();
      if (!keyword) {
        input.focus();
        return;
      }
      window.location.href = buildSearchUrl(keyword);
    });
    var button = document.createElement("button");
    button.type = "submit";
    button.setAttribute("aria-label", "搜索");
    button.setAttribute("title", "搜索");
    button.innerHTML = ICONS.search;
    // 收起状态点一下先展开（不提交空关键词）；展开后再点才真正搜索。
    button.addEventListener("click", function (event) {
      if (!form.classList.contains("is-open")) {
        event.preventDefault();
        openSearch(form, input);
      }
    });
    // 失焦即收起，但把焦点交给自身按钮时不算离开（否则刚点开就被关掉）。
    form.addEventListener("focusout", function (event) {
      var next = event.relatedTarget;
      if (next && form.contains(next)) return;
      var collapse = function () {
        if (!form.contains(document.activeElement)) closeSearch(form);
      };
      if (typeof window.setTimeout === "function") window.setTimeout(collapse, 120);
      else collapse();
    });
    input.addEventListener("keydown", function (event) {
      if (event.key === "Escape" || event.key === "Esc") {
        closeSearch(form);
        input.blur();
      }
    });
    form.appendChild(input);
    form.appendChild(button);
    mountRail().appendChild(form);
  }

  function storageGet(key) {
    try {
      return window.sessionStorage.getItem(key);
    } catch (e) {
      return null;
    }
  }

  function storageSet(key, value) {
    try {
      window.sessionStorage.setItem(key, value);
    } catch (e) {
      /* 隐私模式等禁用 storage 的场景静默跳过 */
    }
  }

  function markManualChannel() {
    storageSet(CHANNEL_MANUAL_KEY, "1");
  }

  function getChannel(id) {
    for (var i = 0; i < CHANNELS.length; i++) {
      if (CHANNELS[i].id === id) return CHANNELS[i];
    }
    return null;
  }

  /* ==================== 自适应定位核心 ==================== */

  function navScope() {
    return document.querySelector('[data-e2e="douyin-navigation"]') ||
      document.getElementById("douyin-navigation") ||
      document.body;
  }

  function isOurUi(el) {
    return !!(el && el.closest && el.closest('[id^="douyin-pure-"]'));
  }

  // 取元素的直接文本（不含子节点），避免父容器 textContent 混入所有 tab 文字。
  function directText(el) {
    var out = "";
    var nodes = el.childNodes || [];
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].nodeType === 3) out += nodes[i].nodeValue;
    }
    return out;
  }

  function walkElements(root, visit) {
    var children = root && root.children ? root.children : [];
    for (var i = 0; i < children.length; i++) {
      if (visit(children[i])) return children[i];
      var found = walkElements(children[i], visit);
      if (found) return found;
    }
    return null;
  }

  // 策略 A：文本精确匹配"推荐"/"精选"等，最抗改版。
  function findByText(label, scope) {
    return walkElements(scope, function (el) {
      if (isOurUi(el)) return false;
      return directText(el).trim() === label;
    });
  }

  // 策略 B：data-e2e 语义属性匹配（抖音相对稳定的测试属性）。
  function findByE2e(tokens, scope) {
    var all = (scope.querySelectorAll ? scope.querySelectorAll("[data-e2e]") : []);
    for (var i = 0; i < all.length; i++) {
      if (isOurUi(all[i])) continue;
      var value = String(all[i].getAttribute("data-e2e") || "").toLowerCase();
      for (var j = 0; j < tokens.length; j++) {
        if (value.indexOf(tokens[j].toLowerCase()) !== -1) return all[i];
      }
    }
    return null;
  }

  // 策略 C：历史 class 兜底。
  function findByClass(hints, scope) {
    for (var i = 0; i < hints.length; i++) {
      var el = null;
      try { el = scope.querySelector(hints[i]); } catch (e) { /* 无效选择器忽略 */ }
      if (!el) {
        try { el = document.querySelector(hints[i]); } catch (e2) { /* 忽略 */ }
      }
      if (el && !isOurUi(el)) return el;
    }
    return null;
  }

  // 依次尝试三种策略定位原生入口。每种策略都先搜导航区，再搜整页
  // （抖音可能把 tab 放在顶栏或其他容器，不能只盯左栏）。
  function findChannelEntry(id) {
    var channel = getChannel(id);
    if (!channel) return null;
    var scope = navScope();
    var doc = document.body || document;
    var scopes = scope === doc ? [doc] : [scope, doc];
    var i;

    for (i = 0; i < scopes.length; i++) {
      var byText = findByText(channel.label, scopes[i]);
      if (byText) {
        log("findChannelEntry(%s) -> text match in scope %d", id, i);
        return byText;
      }
    }
    for (i = 0; i < scopes.length; i++) {
      var byE2e = findByE2e(channel.e2e, scopes[i]);
      if (byE2e) {
        log("findChannelEntry(%s) -> data-e2e match in scope %d", id, i);
        return byE2e;
      }
    }
    for (i = 0; i < scopes.length; i++) {
      var byClass = findByClass(channel.classHints, scopes[i]);
      if (byClass) {
        log("findChannelEntry(%s) -> class fallback in scope %d", id, i);
        return byClass;
      }
    }
    log("findChannelEntry(%s) -> NOT FOUND", id);
    return null;
  }

  // 点击期间临时恢复左栏可见，规避「隐藏元素不响应」的框架逻辑，随后立即还原。
  function temporarilyRevealNav() {
    var nodes = document.querySelectorAll('#douyin-navigation, [data-e2e="douyin-navigation"]');
    var saved = [];
    for (var i = 0; i < nodes.length; i++) {
      saved.push([nodes[i], nodes[i].style.display]);
      nodes[i].style.setProperty("display", "block", "important");
    }
    return function restore() {
      for (var j = 0; j < saved.length; j++) {
        var previous = saved[j][1];
        if (previous) saved[j][0].style.setProperty("display", previous, "important");
        else saved[j][0].style.removeProperty("display");
      }
    };
  }

  // 合成事件序列，作为 element.click() 失败时的兜底。
  function fireEvent(target, type) {
    var event = null;
    try {
      event = document.createEvent("MouseEvents");
      event.initEvent(type, true, true);
      try { event.button = 0; event.buttons = 1; } catch (e) { /* 只读时忽略 */ }
    } catch (e2) {
      try {
        event = document.createEvent("Event");
        event.initEvent(type, true, true);
      } catch (e3) { return; }
    }
    try { target.dispatchEvent(event); } catch (e4) { /* 忽略 */ }
  }

  function fireMouseSequence(target) {
    ["pointerover", "pointermove", "pointerdown", "mouseover", "mousemove",
      "mousedown", "pointerup", "mouseup", "click"].forEach(function (type) {
      fireEvent(target, type);
    });
  }

  // 切换频道：自适应找到原生入口后用 element.click() 触发抖音路由；找不到才回退 URL。
  function activateChannel(id, isAuto) {
    var channel = getChannel(id);
    if (!channel) return "none";
    if (!isAuto) {
      markManualChannel();
      storageSet(CHANNEL_LAST_KEY, id);
    }
    var entry = findChannelEntry(id);
    if (entry) {
      var target = entry.closest ? entry.closest("a") || entry : entry;
      var restore = temporarilyRevealNav();
      var via = "click";
      try {
        // 原生 .click() 最可靠，会触发 React/Next 的 onClick 与内部路由。
        target.click();
      } catch (e) {
        via = "synthetic";
        fireMouseSequence(target);
      }
      restore();
      log("activateChannel(%s) via %s on <%s>", id, via, target.tagName);
      if (isAuto) storageSet(AUTO_DONE_KEY, "1");
      return via;
    }
    log("activateChannel(%s) -> no native entry, fallback URL %s", id, channel.href);
    window.location.href = channel.href;
    return "url";
  }

  function currentChannelId() {
    var href = String(window.location.href || "");
    if (/\/follow(?:[/?#]|$)/.test(href)) return "follow";
    if (/\/friend(?:[/?#]|$)/.test(href)) return "friend";
    if (/\/jingxuan(?:[/?#]|$)/.test(href)) return "jingxuan";
    var saved = storageGet(CHANNEL_LAST_KEY);
    if (saved === "recommend" || saved === "jingxuan" || saved === "follow" || saved === "friend") return saved;
    return "recommend";
  }

  function isHomeLike() {
    var href = String(window.location.href || "");
    return /^https?:\/\/www\.douyin\.com\/(?:jingxuan\/?)?(?:[?#].*)?$/.test(href);
  }

  function shouldAutoEnter() {
    if (!AUTO_RECOMMEND || !isHomeLike()) return false;
    if (storageGet(CHANNEL_MANUAL_KEY) === "1") return false;
    if (storageGet(AUTO_DONE_KEY) === "1") return false;
    return true;
  }

  var autoTimer = null;

  // 首页自动进入推荐：原生入口可能晚于脚本渲染，轮询等待，最多约 10 秒后走兜底 URL。
  function autoEnterRecommend() {
    if (!shouldAutoEnter()) return;
    var tries = 0;
    function attempt() {
      tries++;
      if (findChannelEntry("recommend")) {
        activateChannel("recommend", true);
        refreshHighlight("recommend");
        return true;
      }
      if (tries >= 40) {
        storageSet(AUTO_DONE_KEY, "1");
        log("auto enter: native entry never appeared, fallback URL");
        window.location.href = RECOMMEND_URL;
        return true;
      }
      return false;
    }
    if (attempt()) return;
    autoTimer = setInterval(function () {
      if (attempt()) {
        clearInterval(autoTimer);
        autoTimer = null;
      }
    }, 250);
  }

  function refreshHighlight(id) {
    var nav = document.getElementById("douyin-pure-channels");
    if (!nav) return;
    var links = nav.querySelectorAll("a");
    for (var i = 0; i < links.length; i++) {
      if (links[i].getAttribute("data-channel") === id) links[i].setAttribute("aria-current", "page");
      else links[i].removeAttribute("aria-current");
    }
  }

  function mountChannels() {
    if (document.getElementById("douyin-pure-channels")) return;
    var nav = document.createElement("nav");
    nav.id = "douyin-pure-channels";
    nav.className = "douyin-pure-channels";
    nav.setAttribute("aria-label", "频道切换");
    var active = currentChannelId();
    CHANNELS.forEach(function (item) {
      var link = document.createElement("a");
      link.href = item.href;
      link.setAttribute("data-channel", item.id);
      link.setAttribute("aria-label", item.label);
      link.setAttribute("title", item.label);
      // 图标 + 读屏/悬停文本：视觉上只有图标，可读性靠 title 与 sr-only 文本。
      link.innerHTML = (ICONS[item.id] || "") +
        '<span class="douyin-pure-sr">' + item.label + "</span>";
      if (item.id === active) link.setAttribute("aria-current", "page");
      link.addEventListener("click", function (event) {
        event.preventDefault();
        activateChannel(item.id, false);
        refreshHighlight(item.id);
      });
      nav.appendChild(link);
    });
    mountRail().appendChild(nav);
  }

  /* ==================== 清晰度智能 1080 ==================== */

  // 页面 sessionStorage（油猴沙箱下 window.sessionStorage 指向页面同源存储）。
  function getPageStorage() {
    try {
      return window.sessionStorage || null;
    } catch (e) {
      return null;
    }
  }

  // 用户是否已手动改过清晰度（手动后本脚本不再干预）。
  function isQualityManual() {
    return storageGet(QUALITY_MANUAL_KEY) === "1";
  }

  // 从档位文本解析档位（如"高清 1080P" -> 1080 档）。
  function parseGearFromText(text) {
    var str = String(text || "");
    for (var i = 0; i < QUALITY_GEARS.length; i++) {
      if (QUALITY_GEARS[i].test.test(str)) return QUALITY_GEARS[i];
    }
    return null;
  }

  // 在不超过 1080 的档位里选最高的一档（智能：视频无 1080 时选最接近且不超 1080 的）。
  function pickBestQualityItem(items) {
    var best = null;
    var bestHeight = -1;
    for (var i = 0; i < items.length; i++) {
      var text = items[i].textContent || "";
      var gear = parseGearFromText(text);
      if (!gear) continue;
      if (gear.height > 1080) continue; // 跳过 2K/4K，避免超出目标
      if (gear.height > bestHeight) {
        bestHeight = gear.height;
        best = { el: items[i], gear: gear, text: String(text).trim() };
      }
    }
    return best;
  }

  // 写 MANUAL_SWITCH = 1080 档位 JSON，供抖音播放器读取切换。
  function writeQualityStorage() {
    var store = getPageStorage();
    if (!store) return false;
    try {
      store.setItem(QUALITY_STORAGE_KEY, JSON.stringify(GEAR_1080));
      return true;
    } catch (e) {
      return false;
    }
  }

  var qualityTimer = null;
  var qualityWrites = 0;
  var QUALITY_MAX_WRITES = 84; // 250ms * 84 ≈ 21s，覆盖播放器延迟读取与视频切换

  // 确保 1080：立即写一次，然后有限次数轮询保持；用户手动选择后停止。
  function ensureQuality1080(force) {
    if (!AUTO_QUALITY_1080) return "disabled";
    if (isQualityManual() && !force) return "manual";
    writeQualityStorage();
    // 菜单若可见，按文本智能点选（1080 或不超过 1080 的最高档），双保险。
    var pick = pickQualityFromMenu();
    if (pick) {
      try { pick.el.click(); } catch (e) { /* 忽略 */ }
    }
    if (qualityTimer) return "running";
    qualityWrites = 0;
    qualityTimer = setInterval(function () {
      if (isQualityManual()) {
        clearInterval(qualityTimer);
        qualityTimer = null;
        return;
      }
      qualityWrites++;
      writeQualityStorage();
      if (qualityWrites >= QUALITY_MAX_WRITES) {
        clearInterval(qualityTimer);
        qualityTimer = null;
      }
    }, 250);
    return "started";
  }

  // 从可见的清晰度菜单里找最佳档位元素（按文本匹配，不依赖 class）。
  function pickQualityFromMenu() {
    var selectors = [
      '[data-e2e="quality-selector"] > div',
      '.QualitySwitchNewPlugin [data-e2e="quality-selector"] > div',
      '.xgplayer-playclarity-setting [class*="item"]',
    ];
    for (var s = 0; s < selectors.length; s++) {
      var found = null;
      try { found = document.querySelectorAll(selectors[s]); } catch (e) { continue; }
      if (found && found.length) {
        var pick = pickBestQualityItem(found);
        if (pick) return pick;
      }
    }
    return null;
  }

  // 用户用鼠标操作清晰度菜单时打标记，脚本随即停止写入，保证手动优先。
  function watchManualQuality() {
    function onPointerDown(event) {
      try {
        var target = event.target;
        if (!target || !target.closest) return;
        if (target.closest('[data-e2e="quality-selector"]') ||
            target.closest(".xgplayer-playclarity-setting")) {
          storageSet(QUALITY_MANUAL_KEY, "1");
          if (qualityTimer) {
            clearInterval(qualityTimer);
            qualityTimer = null;
          }
          log("user manually changed quality; auto 1080 disabled this session");
        }
      } catch (e) { /* 忽略 */ }
    }
    document.addEventListener("mousedown", onPointerDown, true);
    document.addEventListener("pointerdown", onPointerDown, true);
  }

  function stopQuality() {
    if (qualityTimer) {
      clearInterval(qualityTimer);
      qualityTimer = null;
    }
  }

  /* ==================== 诊断工具 ==================== */

  function describe(el) {
    if (!el) return null;
    var cls = el.className;
    if (cls && typeof cls !== "string") cls = cls.baseVal || String(cls);
    return {
      tag: el.tagName,
      id: el.id || null,
      class: cls || null,
      e2e: el.getAttribute ? el.getAttribute("data-e2e") : null,
      href: el.getAttribute ? el.getAttribute("href") : null,
      text: directText(el).trim(),
    };
  }

  // 在控制台运行 DouyinPure.diagnose() 可打印真实 DOM 候选，便于精确修复选择器。
  function diagnose() {
    var scope = navScope();
    var report = {
      url: String(window.location.href || ""),
      navScope: describe(scope),
      channelCandidates: {},
      textCandidates: [],
      e2eSamples: [],
      quality: {
        autoEnabled: AUTO_QUALITY_1080,
        manualFlag: isQualityManual(),
        storedManualSwitch: (function () {
          var store = getPageStorage();
          try { return store ? store.getItem(QUALITY_STORAGE_KEY) : null; } catch (e) { return null; }
        })(),
        menuBestPick: describe(pickQualityFromMenu() ? pickQualityFromMenu().el : null),
      },
    };
    CHANNELS.forEach(function (ch) {
      report.channelCandidates[ch.id] = describe(findChannelEntry(ch.id));
    });
    walkElements(document.body, function (el) {
      var text = directText(el).trim();
      if (text && /推荐|精选|关注|朋友/.test(text) && text.length <= 12 && !isOurUi(el)) {
        report.textCandidates.push(describe(el));
      }
      return false;
    });
    var all = document.querySelectorAll("[data-e2e]");
    for (var i = 0; i < Math.min(all.length, 60); i++) {
      report.e2eSamples.push(String(all[i].getAttribute("data-e2e")));
    }
    log("diagnose:", report);
    return report;
  }

  function boot() {
    injectStyle(PURE_STYLE);
    mountSearch();
    mountChannels();
    // 图标列位置由 CSS 决定（贴右边缘），挂载完就结束，不再测量页面布局。
    autoEnterRecommend();
    if (AUTO_QUALITY_1080) {
      watchManualQuality();
      ensureQuality1080(false);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }

  // 暴露给测试、诊断与小工具使用（不影响页面）。
  window.DouyinPure = {
    style: PURE_STYLE,
    buildSearchUrl: buildSearchUrl,
    mountSearch: mountSearch,
    mountChannels: mountChannels,
    mountRail: mountRail,
    icons: ICONS,
    currentChannelId: currentChannelId,
    isHomeLike: isHomeLike,
    shouldAutoEnter: shouldAutoEnter,
    autoEnterRecommend: autoEnterRecommend,
    activateChannel: activateChannel,
    findChannelEntry: findChannelEntry,
    findNativeTab: findChannelEntry, // 兼容旧调用
    diagnose: diagnose,
    // 清晰度模块
    writeQualityStorage: writeQualityStorage,
    ensureQuality1080: ensureQuality1080,
    pickQualityFromMenu: pickQualityFromMenu,
    pickBestQualityItem: pickBestQualityItem,
    parseGearFromText: parseGearFromText,
    isQualityManual: isQualityManual,
    gear1080: GEAR_1080,
    channels: CHANNELS,
    recommendUrl: RECOMMEND_URL,
    autoQualityEnabled: AUTO_QUALITY_1080,
    _stopAuto: function () {
      if (autoTimer) {
        clearInterval(autoTimer);
        autoTimer = null;
      }
    },
    _stopQuality: stopQuality,
  };
})();
