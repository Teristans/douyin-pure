# 抖音网页版精简版 (douyin-pure)

一个油猴脚本：把抖音网页版（`www.douyin.com`）的视频页精简到只剩视频和互动控件。

- 去掉顶栏、左侧导航、登录/下载弹窗与广告卡
- **搜索与频道收进右侧竖排图标列**，与作者头像、点赞、评论、收藏、分享处在同一条竖线上，横向位置按实测的操作列自动对齐，不遮挡视频主体
- 清晰度智能调到 1080（没有 1080 时选不超 1080 的最高档）
- 保留播放控制条、设置、点赞、评论、作者头像、收藏、分享

与 [`pure-live`](https://github.com/Teristans/pure-live-plus)（直播站精简）是两个独立项目，本仓库只做抖音网页版。

## 安装

1. 先安装 [ScriptCat](https://scriptcat.org/) 或 [Tampermonkey](https://www.tampermonkey.net/)
2. 点击安装 → [douyin-pure.user.js v6.0.0](https://github.com/Teristans/douyin-pure/releases/download/douyin-pure-v6.0.0/douyin-pure.user.js)

也可以直接下载仓库里的 [`douyin-pure.user.js`](./douyin-pure.user.js) 拖进脚本管理器。单文件、免构建。

> 脚本管理器不会自动跟进 Release 更新，升级需手动重新导入。若行为仍是旧版，先在管理器里删掉旧脚本再装。

## 右侧竖排图标列（v6.0 新增）

| 图标 | 悬停提示 | 行为 |
|---|---|---|
| 放大镜 | 搜索 | 点击向左展开输入框，回车跳官方搜索页 |
| 火焰 | 推荐 | 切到推荐流（自动点击抖音原生入口，走它自己的路由） |
| 四宫格 | 精选 | 切到精选 |
| 心形 | 关注 | 切到关注 |
| 双人 | 朋友 | 切到朋友 |

当前频道白底高亮，其余为半透明白色，鼠标移入变清晰。

定位不是写死的坐标：

1. 先按「贴右边缘、宽 34–120px、高 ≥220px、纵向完整可见」找到抖音自己的那条操作列；
2. 再量**列内实际图标**（`img` / `svg` / `[aria-label]`）的水平中心，用它当基准——只取容器外框会对不齐，因为容器内的图标往往偏一侧；
3. 把整列放到操作列正上方 16px；纵向空间不够时自动降一档密度（40px→36px→32px，间距同步收紧），保证不会压住作者头像。

实测（1440×900，登录态不可得的匿名环境）：脚本算出的列中心 `1329`，页面上一列原生图标中心实测同为 `1329`。

## 清晰度智能 1080

抖音网页版播放器通过 `sessionStorage["MANUAL_SWITCH"]` 读取手动清晰度档位。脚本双保险：

1. **写存储（主）**：把 1080P 档位对象 `{"gearName":"高清 1080P","qualityType":2,"gearClarity":"5",...}` 写入 `MANUAL_SWITCH`，轮询保持约 21 秒，覆盖播放器延迟读取与换视频。不依赖菜单 DOM，最稳。
2. **菜单选档（辅）**：若 `[data-e2e="quality-selector"]` 可见，按**文本**选档——优先 1080，没有则选不超过 1080 的最高档（如 720P），跳过 2K/4K。不依赖易变的哈希类名。
3. **手动优先**：你动过清晰度菜单后脚本立即打标记并停止写入，本次会话不再干预。

关闭：把源码里的 `AUTO_QUALITY_1080` 改成 `false`。

## 频道切换为什么不靠 class

抖音是 SPA 且 class 高度哈希化。频道切换按以下顺序自适应定位，找到后调用原生 `element.click()` 走抖音自身路由，只有完全找不到入口才回退 URL：

1. 文本精确匹配（「推荐」「精选」「关注」「朋友」）
2. `data-e2e` 语义属性匹配
3. 历史 class 兜底

打开首页会自动进推荐流；手动点过频道后不再干预。改 `AUTO_RECOMMEND = false` 可关闭自动进入。

## 排查

按 F12 → 控制台运行：

```js
DouyinPure.diagnose()
```

会打印 `channelCandidates`（频道入口）、`textCandidates`（页面文字候选）、`e2eSamples`（data-e2e 样本）、`quality`（清晰度状态）。

图标列位置不对时，额外看这两个：

```js
DouyinPure.findActionColumn()   // 有没有认出操作列，列中心算成了多少
DouyinPure.positionRail()       // 重新对齐一次
```

`findActionColumn()` 返回 `null` 说明没找到操作列，此时整列回落到「贴右边缘 + top:76px」的兜底位置。

## 开发

```bash
npm install          # 只为跑测试（jsdom）
npm test             # 38 项
```

## 许可

GPL-3.0-or-later。本项目衍生自 [ljezio/pure-live](https://github.com/ljezio/pure-live)，保留原作者署名。
