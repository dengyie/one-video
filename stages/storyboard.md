# 阶段：storyboard — 分镜

**产物**：`plan/storyboard.json`（schema：`schemas/storyboard.schema.json`）

给每个脚本场景选一个场景类型并填数据。类型清单与 props 见 `references/scene-catalog.md`。

## 每个场景

```json
{ "id": "ipo", "type": "stat-cards",
  "header": { "title": "上市当天", "subtitle": "来源：…" },
  "cues": { "price": "发行价", "cap": { "phrase": "市值约", "offset": 0.2 } },
  "sfx": [{ "sound": "pop", "at": "发行价" }],
  "props": { "cards": [{ "value": 135, "format": { "prefix": "$" }, "label": "发行价", "cue": "price" }] } }
```

- **cues** 把画面变化钉在旁白上：值可以是旁白里的短语（取该短语开始说出的时刻）、`{phrase, offset}` 或秒数（负数从场景结尾倒数，如 `-2.5`；没有按比例的写法，`0.8` 就是 0.8 秒）。props 里的 `cue`/`drawCue`/`periodCues` 引用这些名字；引用未定义的 cue 会报错。
- 没写 cue 的元素按默认节奏在场景前 55% 依次出现。
- `enter`/`exit`：fade · slide · push · whip · zoom · punch · iris · wipe · clock · dip · through · cut；不写用风格默认。按语义选（见 motion-rules 的“转场”）。
- `shots`：镜头轨。每个场景至少 `"auto"`，关键场景手写推近/硬切。
- `overlays`：叠层，钩子和结论每句配一个 `word` 关键词；不写 `x` 时编译器按深度图自动避开主体并按背景亮度加底。
- `duration`（无旁白场景）、`minDuration`（数据动画需要的最短时间）、`hold`（旁白结束后额外停留秒数）。
- `captions: false` 关闭本场景字幕（片尾来源页）。
- `sources` 场景的 `props.auto: true` 自动汇总 research 来源与素材署名。

## 三条线，各干各的

同一时刻观众同时接收三样东西，它们要分工，不要重复：

| 线 | 负责 | 写在哪里 |
|---|---|---|
| 旁白 | 解释：为什么、意味着什么 | script 的 `narration` |
| 屏幕文字 | 点题：几个字的关键词、一个数字 | `title` / `label` / `word` 叠层 |
| 画面证据 | 证明：实拍、图表、界面、原始文件 | `footage` / `media` / 图表场景 |

- 屏幕文字不要整句照抄旁白：观众会把同一句话读一遍再听一遍。timeline 之后 echo 门控会把逐字重复旁白的屏幕文字（去标点后 ≥8 个字，`gates.echoMinChars` 可调）报出来；引用场景（quote）读原话是故意的，不检查。
- 结果和证据出现后停 1–1.5 秒再切（`hold` 或下一个 cue 往后放），让观众看清；不要刚出现就清屏换下一页。
- 证据留在画面上，新信息叠上来或镜头移过去，而不是每句话都清空重来。

## 素材怎么用

素材已经在 assets 阶段定好并下载了；分镜要把它们用足，而不是把照片缩成角落里的小图。

- 优先让照片和实拍占满画面：`footage` / `media` 做底，标题压在上面；一个人物或事件有多张照片时用 `photo-stack` 连续翻，比单张图停 6 秒好得多。
- 贴纸（`image` 叠层）尺寸 ≥240（1080 基准），重要的 300 以上；小于 240 时 layout 门控警告，看起来就是缩略图。
- AI 生成的图和视频在画面里不加任何说明：叠层 `label` 不写“AI 生成”“示意”，片尾也不列；视频质量第一，AI 标识由用户投稿时在平台打。
- 文字场景（title / kinetic / bullets / quote）超过 6 秒，背后要有一张素材（授权或 AI 生成均可）（`backdrop` 或 image 叠层），否则 density 门控警告。

## 版面（layout 门控，timeline 时检查）

- 叠层不能压在正在念的字幕上（报错）：横屏放到 y 0.8 以上、竖屏 0.7 以上，或放到两侧。报错里会给出最近的可用高度（`move it up to y 0.68`）：整段推镜里都不进字幕带、也不撞同时在屏的叠层，照填即可。
- 叠层出画、两个叠层同时出现且重叠、贴纸过小：警告。出画警告同样给出建议位置（先拉回画内留 0.02 边距，再按上面的规则避开字幕带和同屏叠层）。
- 文字场景的推镜：左对齐文字被推近裁掉左边，或 zoom 超过 1.25（`gates.maxTextZoom`）：警告。

## 原则（详见 `references/motion-rules.md`）

- 先看 `examples/spacex-motion/plan/storyboard.json`：实拍做主角、数字进画布、关键词跟着旁白。目标是剪辑感，不是一页一张卡。
- 画面每 2–4 秒要有新东西（cue / 机位 / 叠层）。rhythm 门控会在 `onevideo timeline` 后报出超过 4.5s 的空档和连续 3 个相同转场。有镜头轨的场景，编译器会自动用慢推补上这类空档，所以关键场景写 `shots` 也是在给节奏兜底。
- 有音乐时 `onevideo.json` 写 `music.offset: "auto"`。
- 产品宣传（promo）：看 `examples/promo-demo`。界面全部来自 `onevideo capture`，同一台设备贯穿多个 `device` 场景（相邻同种设备自动硬切，不重复入场）；每个时刻写成 点按 → 展开 → 停在结果上（≥1s，deviceGate）→ 收回或换页；点按位置写 capture 量出的 rect 名，不手填坐标。节奏点用 `match-cut`（`every: "beat"`）或 `kinetic`，实拍里有屏幕时用 `footage.screen` 把界面贴进去，并用 `screen.steps` 换页或滚动，别让贴好的屏幕干放着（节奏门控 4.5s）。

- 开场文字场景的主标题 2.5 秒内出现（opening 门控）：旁白先说日期、人名时，把 cue 钉在人名上，而不是后面的动词。
- 连续同类型场景不超过 2 个（variety 门）。
- 静态类（title/quote/bullets/chapter/sources）合计不超过约 40% 的场景（documentary 30%）。
- 图表里的数字必须来自 research 的 `value`；不要在分镜里手算新数字。
- 一屏一个焦点：数字卡 ≤4 张一排，排名竞赛 top ≤10，饼图 ≤6 段。`slam` 关键词落下时，之前出现、没写 `duration` 且还在屏上的贴纸（stamp、image、callout 等）会自动随之退场；聚光、圈注、闪光等强调效果，以及和它同时（0.3 秒内）进来的叠层保留。想让贴纸留下就给它写 `duration`。

## 检查

`onevideo validate` 之后 `onevideo tts`、`onevideo depth`、`onevideo timeline`，处理 rhythm / layout / density 警告，再 `onevideo preview`，自己先看 `out/qc/preview-*.jpg`，再交给用户审批（preview 阶段），通过后才渲染整片。
