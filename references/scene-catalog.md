# 场景目录

25 种场景类型，props 的权威定义在 `schemas/storyboard.schema.json` 的 `props.<type>`；`onevideo validate` 按类型校验。`STATIC_TYPES`（quote、bullets、title、chapter、sources）在整片中占比不超过 40%（`gates.staticRatioMax`），同类型连续不超过 2 个（`gates.maxSameTypeRun`）。

## 何时用哪种

| 类型 | 适合 | 必填 | 关键可选 |
|---|---|---|---|
| `title` | 片头、钩子 | `title` | `kicker`、`subtitle`、`date` |
| `chapter` | 章节转场 | `title` | `index`、`subtitle` |
| `stat-cards` | 1–8 个关键数字 | `cards[{value,label}]` | `columns`、卡片 `from`/`format`/`note`/`color`/`cue`；无 `from` 时数字逐位翻牌落定 |
| `bar-compare` | 同一时点的横向对比 | `items[{label,value}]` | `sort`、`max`、`unit`、`format` |
| `bar-race` | 排名随时间变化 | `periods`、`series[{name,values}]` | `top`、`group`+`groupColors`、`periodCues` |
| `line-chart` | 趋势、增长曲线 | `series[{name,points}]` | `annotations`、`drawCue`、`pointCues`（每个点的 cue 名，旁白逐个报数时线逐段画到对应点）、`yMin`/`yMax` |
| `share` | 构成、占比（环形图） | `segments[{label,value}]` | 每段 `cue`、`unit`、`total{label,cue}`（图例上方的合计大字，旁白先报总数时用） |
| `timeline` | 事件序列 | `events[{date,title}]`（2–10 个） | `note`、`highlight`、`cue` |
| `compare` | A vs B | `left`、`right` | `vs` |
| `quote` | 引语 | `text` | `author`、`source`、`asset`；`text` 与旁白逐字相同（忽略标点）时随朗读逐字点亮，并自动关掉该场景字幕（场景级 `captions: true` 可强制保留） |
| `bullets` | 要点总结 | `items` | `title` |
| `media` | 照片、视频素材 | `asset` | `motion`（in/out/left/right/up/none）、`fit`、`dim`、`caption` |
| `sources` | 片尾来源 | — | `auto`（默认从 research + assets 生成） |
| `kinetic` | 钩子、金句、关键结论：逐行动态排字 | `lines[{text}]`（≤6） | 行 `style`（rise/slam/type/blur）、`emphasis`（手绘下划线）、`size`、`cue`；`kicker`、`number{value,format,label}` 计数 |
| `headline` | 新闻标题/报道截图的“证据”镜头 | `items[{outlet,title}]`（≤4） | `date`、`excerpt`、`highlight`（荧光笔标出的子串）、`cue` |
| `unit-grid` | “每 100 人里有 N 人”式比例 | `groups[{count,label}]` | `total`、`columns`、`icon`（Lucide 名）、组 `color`/`cue`、`note` |
| `scale-compare` | 数量级差距（嵌套圆，对数缩放镜头） | `items[{label,value}]`（2–6） | `shape`（circle/square）、`format`、`note`、`cue` |
| `price-chart` | 股价/币价走势，笔尖带实时价格与涨跌幅 | `points[[x,y]]` 或 `candles[[x,o,h,l,c]]` | `events[{x,label,tone}]` 旗标、`drawCue`、`baseline`、`area`、`label` |
| `map` | 地理：国家高亮、地点、航线、飞镜头；`mode:"globe"` 为旋转地球 | — | `views[{center:[lon,lat],zoom,cue}]`、`highlight[{id}]`（ISO 二位码/中文名/英文名/数字码；中国自动含台湾）、`pins`、`routes[{from,to}]`、`spin`、`fly` |
| `focus` | 一张照片里逐个推近细节并手绘圈出 | `asset`、`regions[{x,y,w,h}]`（0–1 坐标） | 区域 `label`、`shape`（box/circle）、`zoom`、`cue`；`hold` 结尾拉回全图 |
| `split` | 左右（竖屏为上下）对照，或 `mode:"pip"` 画中画 | `left`、`right`（`{asset,title,text,value,format,caption}`） | `ratio`、`corner`、各侧 `cue` |
| `photo-stack` | 多张照片像相纸一样逐张落到桌面 | `items[{asset}]`（≤8） | `caption`、`cue`、`title` |
| `footage` | 实拍做主角：全屏、变速、标题压在主体后面 | `asset` | `startFrom`、`ramp[{at,speed}]`（如 0.35 慢动作再回 1.6 倍；素材是图片——包括生视频失败顶上的静帧——时变速换成镜头：慢放段缓推，超过 3s 分两段，提速处快推，不打断手写 `shots` 正在进行的运动）、`title{text,behind,matte,style,kicker}`（`behind` 需先 `onevideo depth`）、`dim`、`tint`、`screen{asset,corners,t,blend,opacity,occlude,steps}`（把真实界面贴进实拍里的屏幕：四角透视映射，`steps[{at,asset,scroll}]` 让屏里换页（`asset`）或滚动长截图（`scroll` 0–1，配 `capture --full`），不写时间的接在上一步后 1.2s，`blend:"screen"` 保留屏幕反光，`occlude.asset` 黑白遮罩或 `occlude.matte` 深度挡住手指；角点用 `onevideo screen <asset>` 自动找，只适合机位固定的画面）、`windows{asset,count,t,stagger,gap,matte}`（竖条窗口依次打开露出另一张画面，主体按深度压在窗口前，默认 `matte: {mode: "near"}`：阈值取画面自身的远近分界，适合占满画面的人物；细高主体（火箭、塔）用 `subject`） |
| `parallax` | 一张照片做 2.5D 视差推拉 | `asset`（图片） | `move`（dolly-in/dolly-out/truck-left/truck-right/crane-up/orbit）、`amount`、`title`；有深度图时按深度分层，否则按“下近上远”渐变 |
| `canvas` | 无限画布：元素变形 + 镜头连续飞行，代替翻页 | — | `items[{id,type,x,y,w,h,value,label,at,morph[{at,type,…}]}]`（stat/text/bar/dot/image，坐标为布局单位，首屏 0–1920×0–1080）、`path[{at,focus,zoom,cut,fly}]`、`links[{from,to,at}]`、`inherit`（接着上一个 canvas 的世界和镜头）、`floor`（随镜头移动的点阵地面，近层 1:1、远层 0.35 视差；有 backdrop 时默认关）。卡片会随镜头速度惯性倾斜，最多 9°；stat 入场分层：底板从强调色边擦开，标签随后滑入，数字最后升起；数字计数时逐位翻牌（里程表式，低位多转几圈、从左到右依次落定，转得快时纵向拖影） |
| `device` | 产品演示：真实界面装进一台手机/浏览器/笔记本，同一台设备跨场景不离场 | `screens[{id,asset}]`（`onevideo capture` 截的图） | `device`（phone/browser/laptop，默认竖屏 phone、横屏 browser）、`steps[{at,tap,expand{rect,to,asset},collapse,screen,scroll,focus,camera}]`、`url`（地址栏）、`zoom`、`caption`。`tap`/`rect`/`focus` 可以写坐标，也可以写 capture 时 `--rects` 量出的名字；点按出涟漪，`expand` 让卡片从原位弹开、背后压暗，`collapse` 或换页时收回；镜头自动接力：点按前 0.6s 推到页面，展开时推到结果，收回拉回整机。相邻两个同种设备场景默认硬切、不重复入场。点按吸附拍点，没写时间的步骤在 0.6s 到 75% 时长间均匀排开；结果停留不足 1s 时 deviceGate 警告（`gates.deviceHold`） |
| `match-cut` | 剪影/轮廓匹配剪辑：几张图在同一位置按拍点硬切 | `items[{asset}]`（≥2） | `every`（秒、`"beat"`、`"bar"`，从 `from` 起算；拍点不够会报错）、各项 `t`/`x`/`y`/`scale`/`label`、`size`（默认 0.62）、`background`、`flash`（每切一下白闪）、`title`（收尾标题）；每次切换有 1.06 倍冲击 |

## 场景通用字段

- `header: {title, subtitle}`：图表场景的标题条。subtitle 写口径和日期（“2026-11-04 收盘 · StockTitan”）。
- `cues: {name: 时间}`：时间可以是秒（负数从结尾倒数）、0–1 比例、旁白里的短语，或 `{phrase, offset}`。props 用 `cue`、`drawCue`、`periodCues`、`pointCues` 引用 cue 名，引用未定义的 cue 会报错。
- `enter` / `exit`：转场类型 `fade`、`slide`、`push`、`whip`、`zoom`、`punch`、`iris`、`wipe`、`clock`、`dip`、`through`（镜头冲进上一镜的主体，糊开后露出下一场景，下一场景从同一点浮出；主体默认取上一镜素材末帧深度图里最近 8% 像素的重心，没有深度图时取画面中心，也可写 `focus: [x, y]` 指定屏幕点；最适合实拍接画布）、`cut`，或 `{type, duration, direction, sfx}`；相邻两场景重叠播放，边界类型取 `next.enter ?? prev.exit ?? theme.transition`。
- `camera`：`static`、`drift`（默认）、`push`、`pull`、`pan-left`、`pan-right`、`rise`、`handheld`，或 `{move, amount}`。
- 图标：任意 props 里的 `icon` 字段写 Lucide 名（`rocket`、`user-round`）或 `flag:<iso2>`（圆形国旗），编译时只内联用到的 SVG；未知名字会报错。
- `background`：`default`、`plain`、`grid`、`stars`、`media`。
- `hold`：旁白结束后停留的时间（默认 0.5s）；`duration` / `minDuration` 给无旁白或需要更长停留的场景。
- `sfx: [{sound, at}]`：`at` 同 cue 语法。
- `intent`：一句话写明这个画面要让观众记住什么，方便审稿。
- `shots`：场景的镜头轨，作用于内容和叠层（背景以 0.55 倍弱跟随，产生视差）。`"auto"` = 每句字幕一个机位，推/切交替；或写列表 `[{at, zoom, x, y | focus:[x,y,w,h], rotate, cut, ease}]`。运动帧按镜头速度加方向性动态模糊，硬切帧不加。
- 卡点：有音乐时编译器读取 `public/<music>.beats.json`（`onevideo music` 生成：合成乐按 BPM 出网格，外部音轨用 onset 检测），镜头时间吸附到 0.12s 内最近的拍点，硬切镜头（`cut`）、画布路径的硬切停靠点和 speed>1.3 的变速优先吸附到 0.25s 内的小节重拍（downbeat，4/4 下 onset 能量最大的拍位）；单个镜头/停靠点/变速写 `snap: false` 保持原时间；`onevideo.json` 里 `beats.snap: false` 关闭。`at: {beat: n}` 直接指定场景内第 n 拍（shots、canvas、footage 可用）。
- 配乐对齐：`onevideo.json` 的 `music.offset` 写秒数，或写 `"auto"` 让编译器在一小节内找让场景边界、硬切和 slam 关键词最贴近重拍的音乐起点。
- 深度图：`onevideo depth [asset ids] [--step 2]` 在 VM 上用 Depth Anything V2（ONNX，CPU）生成，图片 → `<file>.depth.png`，视频 → `<file>.depth/NNNN.png`，同时生成亮度网格 `<file>.luma.json`；through 定焦、parallax、footage 的 `title.behind`、关键词避让和自动加底、字幕避让都会读取。`onevideo build` 在 depth 工具可用时自动执行。

## 叠层动效 `overlays`

任意场景都可以挂一组叠层，在旁白说到某句时弹出，给静态画面加“动作”。叠层跟随场景转场和 `shots` 镜头轨，但不跟随 `camera` 漂移。

```json
"overlays": [
  { "type": "stamp", "text": "首次", "at": "成功回收", "x": 0.78, "y": 0.3, "sfx": "auto" },
  { "type": "lottie", "src": "rocket", "at": 1.2, "x": 0.2, "y": 0.3, "size": 200 }
]
```

公共字段：`at`（同 cue 语法）、`duration`（缺省持续到场景结束，最后 0.3s 淡出）、`x`/`y`（画面比例 0–1）、`size`（布局单位，默认 160）、`color`、`sfx`（`"auto"` 取下表默认音效；库 id / 类别名 / `synth:名`；`{sound, volume}`；`null` 静音）。

| type | 用途 | 关键字段 | auto 音效 |
|---|---|---|---|
| `lottie` | 矢量动画贴纸（库 40 个：check/cross/rocket/confetti/trophy/warning/globe…） | `src`（库 id 或类别，或 `public/` 下 .json）、`loop`、`speed`、`tint` | ui-pop |
| `icon` | Lucide 图标弹出 + 脉冲环 | `icon`、`label`、`ring` | ui-pop |
| `burst` | 放射线爆点，配合数字/印章 | `count` | ui-pop |
| `confetti` | 彩带 | `origin: top|point`、`count` | success-sting |
| `arrow` | 手绘弧线箭头 | `from`/`to`（[x,y] 比例）、`curve`、`label` | swish |
| `mark` | 马克笔圈/框/下划线/删除线/高亮 | `kind: circle|box|underline|strike|highlight`、`rect: [x,y,w,h]` | marker |
| `callout` | 圆点 + 引线 + 标签 | `text`、`subtitle`、`side` | click |
| `stamp` | 印章砸下 + 抖动 | `text`、`rotate` | impact |
| `lower-third` | 下三分之一字条（人名/地点） | `text`、`subtitle` | whoosh-soft |
| `spotlight` | 聚光压暗四周 | `x`/`y`、`size` | swell |
| `flash` | 闪白 | — | boom |
| `image` | 图片贴纸 | `asset`、`shape`、`rotate` | ui-pop |
| `word` | 关键词弹字（配 `shots` 做每句一个关键词）；不写 `x` 时按深度图避开主体，背景对比度不足时自动加底，被后一个关键词盖住时提前离场 | `text`、`style: slam|rise|type`、`color`、`scrim`（0–1，`0` 关闭自动加底） | ui-pop |

- 项目级 `sfx.overlays: "auto"`：所有没写 `sfx` 的叠层都配默认音效。
- 项目级 `sfx.motion: "auto"`：画面运动自己出声。canvas 飞行配 whoosh-soft，飞行 ≥1.3s 换成 whoosh-cinematic；硬切和 slam 关键词配 impact（slam 词不再配 ui-pop）；镜头推拉（Δzoom ≥0.12）配 whoosh-soft；footage 变速从慢放提回快速时配 whoosh-cinematic。同一类别的音效变体轮换使用。离已有音效不到 0.2s 的运动音效跳过，运动音效之间至少间隔 0.25s。`onevideo music` 会把这些类别的全部变体都放进 `public/sfx/`。
- 字幕 `captions.style: "kinetic"`：在 karaoke 逐字点亮的基础上，数字和英文词用强调色，刚念到的字轻微弹起，整行上浮入场，底板改成浅色毛玻璃。
- Lottie 里的黑色线性图标会自动着色为主题文字色；`tint: "#rrggbb"` 手动指定。用到 CC BY 素材（Noto 动画表情）时，sources 场景和发布文案会自动加署名。
- `on` 把叠层钉在场景元素上（逐帧量位置，换 9:16/1:1/4:5 也跟着内容走，优先用它代替比例坐标）：stat-cards `card1…` 或该卡的 `cue`；compare `left`/`right`/`left-value`/`right-value`；share `ring`/`seg1…`（图例行）或该段 `cue`、`total`（合计行，或它的 `cue`）；bar-compare `bar1…`（按书写顺序）或该项 `cue`。bar-race `bar1…`（该 series 的条本身，按书写顺序，跟着排名移动）、`rank1…`（固定名次的名字槽，钉“当期第一”用 `rank1`）、`period`（大号期数）；line-chart `point1…`/`last`（第一条线的点，线还没画到也有位置），第 n 条线 `s<n>-point1…`/`s<n>-last`，标注 `note1…` 或该标注的 `cue`；canvas 用元素 `id`（跟着镜头飞行和缩放；`inherit` 的场景也能用上一画布的元素；元素在画外时退回 `x`/`y`）。`place`：`center|top|bottom|left|right|top-left|top-right|bottom-left|bottom-right`，stamp/icon/lottie/image 缺省 `top-right`，callout 缺省 `right`，其余居中。`offset: [dx, dy]`（布局单位）从 place 点再挪开，用于贴在小元素旁边而不是盖住它（如折线点下方 `[0, 160]`）。`mark` 直接圈住元素框，`arrow` 指向元素（`from` 仍是比例）。名字写错或场景没有锚点会编译报错。元素移出画面时，叠层跟着淡出（如镜头飞离的 canvas 卡片）；元素不在时，写了 `x`/`y`/`rect` 就用它们兜底，没写就不显示。
- `mark.rect`、`arrow.from/to` 是比例坐标，写完一定跑 `onevideo stills --scene <id> --at 0.7` 核对位置。

## 胶片质感 `look`

`onevideo.json` 里 `"look": {"grain": 0.35, "vignette": 0.6, "leak": 0.4}`（0–1）：颗粒噪点、暗角、漏光。纪录片/实拍素材多的片子开，纯数据图表片可只开 vignette。

## 场景配方 `lib recipe`

`library/recipes/` 存了 14 个经典镜头组合（场景 + 叠层 + 音效），直接取用再填空：

```bash
onevideo lib recipe                                   # 列表：hook-slam、stat-reveal、photo-focus、broll-lower-third、price-shock、versus、success-moment…
onevideo lib recipe photo-focus --id s3 --set asset=landing,region_label=栅格翼   # 输出可粘贴的 storyboard 场景 JSON
```

未填的 `{{槽位}}` 会提示。新沉淀的好镜头写成 `library/recipes/<name>.json`（`name/title/description/tags/scenes`），测试会校验它能通过 storyboard schema。

## 实拍视频素材

`plan/assets.json` 里 `{"id": "landing", "kind": "video", "query": "falcon 9 landing", "clip": [5, 8]}`：默认从 NASA、Wikimedia Commons 免 key 检索（有 `PEXELS_API_KEY` 时加 Pexels），下载后裁成无声 ≤1080p H.264 片段。配 `media`、`split`、`focus` 或背景 `backdrop` 使用。

## 数字格式 `format`

`{prefix, suffix, decimals, compact}`。`compact: "zh"` 输出“亿/万亿”，不指定 `decimals` 时取 3 位有效数字并去掉尾零（1187亿、1.85万亿）。

## bar-race 要点

- `values` 和 `periods` 等长，某期不在榜单用 `null`。
- `periodCues` 把某一期对齐到旁白里的 cue：有 cue 的期是锚点，没 cue 的期在锚点之间均匀插值。最后一期默认出现在场景 72% 处。
- 每次换期只有一段很短的交换动画（≤1.6s），之后停住，让观众读清楚排名。
- 不同时期的数据来源和计价日写进 header subtitle。

## 选型原则

1. 一个场景只讲一件事。两个数字用 stat-cards，十个数字用图表。
2. 能动起来就别静止：用 cue 让卡片、柱子、事件跟着旁白逐个出现；每 2–3 个场景至少一个叠层动作（印章/圈注/箭头/Lottie），关键转折配实拍视频。
3. 图表优先于文字：bullets 是最后的手段，不要用它承载数据。
