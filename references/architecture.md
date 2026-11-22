# 代码架构

`cli/onevideo.mjs` 只做命令分发；`cli/commands/*` 是命令（读写项目文件、打印进度）；`cli/lib/<领域>/` 是可测试的逻辑，不打印、不读命令行参数。渲染在 `template/`（Remotion），它只读 `plan/timeline.json`。两边共用的几何与节奏模型在仓库根的 `shared/`，所以门控预测的就是渲染真正画出来的。

## 共享层（`shared/`）

最底层：纯函数 ESM（`// @ts-check` + JSDoc），只引同目录文件，不碰 node / react / remotion。模板经 `../../../shared/` 引入（tsconfig `allowJs` + `checkJs`），CLI 任意领域都可经 `../../../shared/` 引入。

| 文件 | 内容 | 谁在用 |
|---|---|---|
| `ease.mjs` | `clamp01` `lerp` `easeOut` `easeInOut` | 全部 |
| `camera.mjs` | 镜头轨：`viewAt`（含不出画钳制）、`cameraMoving`、`seenSpan` / `seenBox`（整段窗口里一直在画面内的部分）、`captionBand`、`viewTransform` `viewVelocity` `cutBetween` `farther` | 模板 `engine/camera.ts`、字幕带、layout / rhythm 门控 |
| `boxes.mjs` | 矩形：`meets` `area` `overlap` `shift` | 模板探针、`review/probe` `gates-layout` |
| `labels.mjs` | 地图标签排布：`textEms` `labelWidth` `inFrame` `clearOf` `placePinLabels` `visibleOnGlobe` `mapViewAt` | 模板 `scenes/Map.tsx`、`review/map-model` |
| `tableau.mjs` | 插画场景模型：`KINDS`（元素种类、默认值、景深）`elementAt`（关键帧插值、调色板交叉淡化、入场）`settledElement`（inherit 终态）`PALETTES` `paletteAt` `cameraAt` `layerView`（按景深分摊镜头的视差）`cameraMoving` `waveY` `bandFor`（海面分层、船骑哪层浪）`flashAt` `boltPath` `lampLevel` `hash` `noise` | 模板 `scenes/Tableau.tsx`、`timeline/props` `compile`（inherit） |
| `reveal.mjs` | 出现时刻：`PACE` `paceOf` `revealAt`（具名 cue 优先，否则在前 55% 错开）`cueOr` | 模板 `engine/context` `motion`、`review/map-model` `gates-layout` |

改这里的任何公式，渲染和门控同时变；`tests/shared.test.mjs` 是它们的单测。

## 模板分层（`template/src/`）

```
engine/{types,motion,format,camera,probe}   纯模块：只引 ./types 与 shared/，不引 react / remotion
engine/*（其余） · components/              → 纯模块；components 不引 scenes
scenes/                                     → engine, components
engine/Video · engine/Captions              挂场景的只有 Video；二者只被 Root / Video 引用
```

`../../../` 只许指向 `shared/`（`demo.ts` 引 `styles/` 例外）。由 `tests/architecture.test.mjs` 守住。

## 领域模块（`cli/lib/`）

| 目录 | 管什么 | 主要入口 |
|---|---|---|
| `core/` | 项目加载与路径、参数解析、HTTP（重试、密钥）、ffmpeg、JSON Schema、阶段状态、文本度量（视觉宽度、朗读音节、读音规则、数字提取）、重活派发到 worker（`ONEVIDEO_WORKERS`）、授权白名单（门控与检索共用） | `project.mjs` `http.mjs` `ffmpeg.mjs` `text.mjs` `worker.mjs` `license.mjs` |
| `captions/` | 字幕：旁白切行（`splitLines` `sceneLines` `captionMaxChars`）、字幕带位置与主体避让（`captionBand` `placeCaptions`）、SRT/VTT（`toSrt` `toVtt`）、宽度门禁（`captionGate`） | `index.mjs` |
| `voice/` | 配音：TTS 请求、按停顿对齐字幕行、响度归一；其他画幅的字幕时间（`variant.mjs`：同一段场景音频，窄画幅的短行按主时间轴的停顿与朗读占比重排，无需 key） | `tts.mjs` `variant.mjs` |
| `audio/` | WAV 读写、响度、程序化音乐与音效、节拍检测 | `wav` `loudness` `synth` `beats` |
| `library/` | 本地素材库（音效 / Lottie / 配方）、图标、国家地图 | `catalog` `icons` `geo` |
| `llm/` | 模型客户端：`ask`（文本 + 图片，JSON 回复解析、模型回退） | `client.mjs` |
| `prompts/` | 所有发给模型的提示词，一个提示词一个纯函数（数据进、字符串出） | `index.mjs` |
| `generate/` | 生图（多 take + 视觉挑选）、生视频（提交 / 轮询 / 质检截取）、共用配置与模型回退 | `index.mjs` |
| `assets/` | 素材来源（NASA / Wikimedia / Openverse / Pexels 搜索与排序）、按场景推荐候选（`suggest.mjs`：检索词 → 检索 → 排序 → 清单条目）、取素材（`fetchAsset`）、媒体文件（剪片、帧序列、深度 / 亮度图路径） | `index.mjs` |
| `vision/` | 画面分析：深度主体与对比度、屏幕检测、UI 截图（自起 Chrome）、联系表、成片 QC | `subject` `screen` `capture` `sheet` `qc` |
| `timeline/` | 时间线编译：`compile.mjs` 编排，各道工序分文件——`cues`（短语 / 节拍定时）、`transitions`、`sfx`、`shots`（镜头轨、硬切、音乐偏移）、`props`（画布 / 设备等的内部时间）、`anchors`（叠层锚点）、`credits`、`events`（画面变化时刻，rhythm 门控与 look 复核共用）、`aspect`（`withAspect`：同一剪辑透过另一画幅看的项目——独立的 timeline / timings / 配音目录） | `index.mjs` |
| `review/` | 门禁与 `checkProject` 汇总，`fixPlan` 套用门控自带修法。`gates.mjs` 只是汇总出口，门禁按关注点分文件：`issue`（问题结构、阈值默认值）、`gates-plan`（schema、数字、分镜、drawn（纯代码项目不得引用素材）、cue、timings、语速、素材、时长预算）、`gates-pacing`（开场、节奏、设备停留、问题、回声）、`gates-layout`（贴纸 / 大字排版、密度）、`map-model`（地图钉、标签的预测框，基于 `shared/labels`） | `gates.mjs` `check.mjs` `fixes.mjs` `reveals.mjs`（旁白数字 → 图表元素 cue）`probe.mjs`（stills 实测：贴纸挡字、文字出画——镜头运动中的帧不报出画） |
| `publish/` | 发布包（章节、致谢、简介）、交接页、渲染版本记录 | `kit` `handoff` `renders` |
| `archive/` | 归档到 MangoDrive（OpenList REST）：上传、回读校验 sha256、`plan/archive.json` 记录、裁剪旧渲染、恢复；地址与账号只从环境变量读 | `index.mjs` `drive.mjs` |

## 依赖方向

自下而上分层，只往下引用（实测 import 关系）：

```
shared                       （纯几何 / 节奏，无依赖；模板与任意领域都可引）
prompts                      （纯字符串，无依赖）
core                         （无领域依赖）
llm · audio · vision         → core
library                      → audio, core
captions                     → vision, core
voice                        → captions, audio, core
generate                     → prompts, llm, vision, assets/media, core
assets                       → generate, prompts, core
timeline                     → captions, vision, library, audio, assets/media, core
review                       → timeline, captions, voice, library, core
publish                      → review, timeline, captions, voice, core
archive                      → core
commands                     → 以上任意
```

- 这张表由 `tests/architecture.test.mjs` 守住：新领域、越层引用、`cli/lib/` 下的散文件都会让测试失败。
- `assets` 与 `generate` 互相用到，但只在文件层单向：`assets/fetch.mjs` → `generate/`，`generate/video.mjs` → `assets/media.mjs`，没有循环。
- 领域之外从 `index.mjs` 引入；领域内部、或需要避免循环时，直接引具体文件（如 `generate/video.mjs` 引 `assets/media.mjs`，而不是 `assets/index.mjs`）。
- 加一个提示词：在 `prompts/` 新建 `<名字>.mjs` 导出构造函数，加进 `prompts/index.mjs`，调用方 `ask({ prompt: xxxPrompt({...}) })`。
- 加一种字幕能力（新格式、新排版规则）：放 `captions/`；时间线编译只调用 `placeCaptions`，播放器渲染在 `template/src/engine/Captions.tsx`。
- 加一个生成后端或素材源：生成放 `generate/`（复用 `common.mjs` 的 `genConfig` / `firstModel`），素材源加进 `assets/sources.mjs` 的 `PROVIDERS`。
- 时间线新工序：在 `timeline/` 加文件，导出纯函数，由 `compile.mjs` 调用，并加进 `timeline/index.mjs`。

## 播放站（`web/`）

`npm run web:deploy` = `web/deploy.mjs`：先跑 `web/sync.mjs` 生成目录，再对站点文件和 Worker 代码求哈希，与上次部署（`web/.wrangler/deployed.sha256`）相同就跳过，不同才 `wrangler deploy`（Worker `onevideo-web`，静态资源 `web/site/`，`/v/*`、`/w/*`、`/feed.xml`、`/sitemap.xml`、`/robots.txt` 先过 `worker.mjs`）；`--force` 强制部署。发布节点上 `onevideo-web.timer` 每 10 分钟跑一次，`onevideo publish` 之后几分钟上站，节点之间不用手工搬文件。

| 文件 | 内容 |
|---|---|
| `sync.mjs` | 命令入口：选来源、写 `videos.json`、清掉下架的目录。**drive**（配了 `ONEVIDEO_DRIVE_*` 时默认）交给 `catalog.mjs`。**host**（`ONEVIDEO_WEB_FROM=host`）：从本机或 `ONEVIDEO_HOST` 上的项目复制，成片走静态资源，超 25 MiB 让同步失败 |
| `catalog.mjs` | `driveCatalogue({ drive, root, vdir, previous })`：列出 MangoDrive 根目录下的项目，读 `plan/archive.json`，记录里有 `plan/publish.json` 的才上站；`publish.json` 的 `video`（成片对应的版本文件，如 `out/versions/v4.mp4`）留在 Drive 上由 Worker 播放时拉取，海报 `poster`、字幕、简介下载进 `vdir/<slug>/`，全部按归档记录的 sha256 校验（`.synced` 戳相同则不重下）；日期取 `publish.rendered`；单个项目出错（上传中途、网络）保留 `previous` 里的条目。`drive` 可注入，`tests/web-catalog.test.mjs` 用假 Drive 测 |
| `deploy.mjs` | sync + 变更检测 + 部署，可放进 timer |
| `drive.mjs` | 纯 fetch：`DriveLink`（登录、签名直链缓存 5 分钟、token 过期重登；直链按文件签名，约 30 小时有效，支持 Range、`Access-Control-Allow-Origin: *`）、`directVideo`（302 到签名直链，`Cache-Control: private, max-age=300`，字节由 Drive 直接给浏览器）、`proxyVideo`（`?via=edge` 中转：透传 Range → 206/416，签名失效换链重试一次，Drive 出错 502；GET 时后台把整片灌进边缘缓存，≤200 MiB）。Worker 与 `tests/web-drive.test.mjs` 共用 |
| `worker.mjs` | `/v/<slug>/video.mp4` 且已部署 `videos.json` 里该 slug 是 `source: "drive"` → 按条目的 `drive` 路径 302 到 Drive 直链（`directVideo`）；带 `?via=edge` 时先查边缘缓存，否则 `proxyVideo` 中转；`/w/<slug>` → `share.mjs` 改写的播放页（未知 slug 404）；其余走静态资源（边缘缓存补 206） |
| `share.mjs` | 分享页：`/w/<slug>` 是 `site/index.html` 换上该视频的 `<title>`、description、Open Graph / Twitter 标签（海报、成片绝对地址、时长），贴进聊天能展开成视频卡片。纯字符串替换，`tests/web-share.test.mjs` 测。播放页按路径导航（`pushState`），旧链接 `/#slug@t` 仍可用 |
| `feed.mjs` | `/feed.xml`（RSS 2.0：成片 enclosure、Media RSS 缩略图，guid = 分享页）、`/sitemap.xml`（首页 + 各分享页，Google video sitemap 标签）、`/robots.txt`（指向 sitemap；Cloudflare 区域的托管 robots 内容会被拼在前面）。按请求的 origin 从已部署 `videos.json` 现算，`tests/web-feed.test.mjs` 测 |
| `secrets.mjs` | 把 `ONEVIDEO_DRIVE_USER/PASS` 和公网 API（`ONEVIDEO_WEB_DRIVE_URL`，默认 `https://api-drive.mangoqwq.com/api`）写成 Worker secret（`wrangler secret bulk`，经 stdin，不打印不落盘）；改密码后重跑 |

Drive 成片默认由浏览器直连 MangoDrive 播放（站点只发一次 302）；直链失败（网络到不了 Drive、签名被吊销）时播放页在 `<source>` 的 error 上改用 `?via=edge` 重载一次，保留进度和播放状态。代价：不再用 Cloudflare 边缘缓存，离 Drive 远的观众首字节和吞吐取决于 Drive 出口（新加坡节点实测：直连 1 MB 约 0.9–1.5s，热缓存中转约 0.15s）。

播放器下方「文稿」面板：取 `captions.vtt` 用 `site/vtt.mjs`（`parseVtt` / `cueAt`，`tests/web-vtt.test.mjs` 测）解析，按章节分组，跟随播放高亮、点句跳转、站内搜索高亮。

播放页在 `localStorage`（`onevideo:pos:<slug>`）记每个视频看到哪（10s 到结尾前 15s 之间），回来时续播并给「从头播放」；`?t=` 链接优先。

Worker 只为 `videos.json` 列出的路径签链 / 中转，不接受任意 Drive 路径。`web/site/.assetsignore` 排除点文件（同步戳 `.synced`、`.publish.json`）和 `description.txt`（已内联进 `videos.json`）。

**发布链路**：渲染节点 `onevideo publish` → 写 `plan/publish.json`（`video`、`poster`）和 `out/publish/poster.jpg` → 自动 `archive` 到 Drive → 发布节点的 timer 从 Drive 同步并部署。**一个项目只归一台机器**：归档记录写 `host`，别的机器上的副本 `archive` 时被拒（`archive --all` 跳过并报出），换机器用 `archive --takeover`。
