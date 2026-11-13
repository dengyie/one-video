---
name: onevideo
description: Use when the user wants a narrated video made — data explainers, documentaries, short-form vertical clips — from a topic, article or dataset. Runs a staged, gated pipeline (research → proposal → script → assets → storyboard → voice → compose → preview → render → review → publish) with sourced facts, sentence-level TTS timing, Remotion rendering, automated QC and a publish kit.
---

# OneVideo

OneVideo 把“做一条视频”拆成 11 个阶段。每个阶段都有一份导演文档（`stages/<id>.md`）、一个落盘的产物（`plan/*.json`），以及机械门控；需要人拍板的阶段要审批，审批会锁定产物的哈希。共享的渲染引擎在 `template/`，项目目录里只放数据。

## 工作方式

1. `onevideo status` 显示每个阶段的状态和下一步该读哪份导演文档。**每进入一个阶段，先读对应的 `stages/<id>.md`，再动手。**
2. 创作阶段（research、proposal、script、assets、storyboard）由你写 JSON / Markdown，然后 `onevideo validate`，再把产物给用户看，用户确认后执行 `onevideo approve <stage>`。**不要替用户审批**，除非用户明确授权。
   - **素材先于分镜**：script 通过后先 `onevideo assets suggest`（按场景找授权候选）→ 挑选 → `assets fetch`，把下载好的素材给用户过目，通过后 `approve assets`，再按手里的素材写分镜。素材少，片子一定单薄：density 门控按“素材/分钟”卡（<4 报错、<8 警告，AI 生成的也计入）。
   - **整片渲染前先过预览**：timeline 之后 `onevideo preview` 把每个场景的静帧铺成 `out/qc/preview-*.jpg`，给用户看，通过后 `approve preview`；未通过时 `render` 只允许 `--draft` / `--scenes`，`build` 停在 preview。layout 门控在这一步之前就会报出贴纸压字幕、出画、重叠、贴纸过小、推镜把字推出画面。
3. 非创作阶段由 CLI 执行：`tts`、`music`、`depth`、`timeline`、`preview`、`render`、`qc`，也可以用 `build` 一次跑到 qc（缺的素材自动下载，有 depth 工具时自动做深度图和亮度网格；preview 未审批时停在 preview）。`publish` 要求 review 已审批；配了 `ONEVIDEO_DRIVE_URL` 时 publish 结束后自动 `archive` 到 MangoDrive。
4. 结构按观众的问题排（proposal 写问题链，script 每个场景写 `question`）；画面按三条线分工：旁白解释、屏幕文字只放关键词、画面给证据（storyboard.md）。
5. 分镜按动效引擎写，不要做成一页一张卡：先读 `references/motion-rules.md`，参考 `examples/spacex-motion`。实拍做主角（`footage` 变速、标题压在主体后），数字进 `canvas` 连续飞行，每个场景都有 `shots`，钩子和结论每句一个 `word` 关键词，有音乐时写 `music.offset: "auto"`。`onevideo timeline` 报出的 rhythm 警告（画面超过 4.5s 没有新东西、连续相同转场）要处理掉，或者向用户说明为什么保留。
6. 渲染后必须执行 `onevideo qc`，并**逐张看** `out/qc/frames/`，确认画面没问题后再 `approve review`。

## 你是导演

节奏由你把控：每个镜头为什么在这里、停多久、怎么切，都由你决定并写进分镜。CLI 和模型只是工具，它们给出的结论要由你核实后再采用。

- **缺画面就自己做**：`assets.json` 里写 `generate`，可以生图（`variants: 2–4` 出多张，由视觉模型按 `brief` 挑一张，所有备选都留在 `public/assets/<id>.take<k>.*`，觉得它挑得不对就写 `pick` 改掉），也可以生视频（`kind: "video"`，`from: <图片 id>` 把一张图做成首帧动起来）。生成失败时会回落到同一条目的 `url` / `query`，所以关键素材最好留一个备选来源。能找到真实素材时优先用真实素材，生成的素材只用来补镜头、做氛围、做概念画面，不能冒充新闻实拍。
- **看片**：`onevideo sheet` 把成片按秒铺成联系表（`out/qc/sheet-NN.jpg`，同时输出每个场景从哪一格开始）。用 Read 看联系表，比逐帧翻快得多。`onevideo look` 再请视觉模型按剪辑标准过一遍，结果写进 `out/qc/look.json`，每条意见带时间点和场景。它只是第二意见：先在联系表或 `stills` 里确认问题确实存在，再改分镜。
- **先做 15 秒样片**：整片渲染之前，先 `render --draft --scenes hook,ipo`（或 `--from 0 --to 15`）把开头渲一段，确认风格、配音、字号、节奏都对，再渲整片。
- **迭代**：改分镜 → `timeline`（处理 rhythm / echo 警告）→ `render --draft [--scenes …] --note "改了什么"` → `sheet --vs prev` 对比上一版 / `look` → 再改。**每一轮只改一件事**，改完对比确认变好了再动下一件；确认过的东西用 `handoff --lock "…"` 记下来，后面不要再碰。
- **交接**：换会话、交给子 agent 之前先跑 `onevideo handoff`，它把阶段、已定参数、素材质检、最近几版渲染、看片意见和待处理警告写进 `plan/handoff.md`，并保留手写的“锁定 / 下一轮只改 / 备注”三节。接手一个已有项目时，先读 `plan/handoff.md`。
- **并行**：调研、找素材、生素材互相独立，可以交给子 agent 并行做。分镜和节奏由你自己写，不要外包。

## 硬规则

- 旁白里的每个数字都要能在 `plan/research.json` 的 facts 里找到，facts 必须有来源（numbers 门控）。不要为了过门控而编造来源。
- 素材只用白名单授权（`references/licensing.md`），CC BY 素材要写作者和来源。
- API key 只从环境变量或本机配置读取，不打印、不写进项目文件。共享 key（`MANGO_API_KEY` 等）只发往 `api.mangoqwq.com`（设了 `ONEVIDEO_API_BASE` 时，默认中继的请求改走该网关，key 只发往它的主机）；换 `baseUrl` 必须配专用 `keyEnv`。`~/.zcode` 的 provider 配置仅在显式 `ONEVIDEO_ZCODE_PROVIDER=1` 时读取。
- 已审批的产物被改动后，该阶段显示 stale，需重新给用户看并 `approve`。改了 script 之后必须重跑 `tts`，否则 timings 门控报错、渲染被拦；不要手改 `timeline.json`。

## 命令

```bash
onevideo init <dir> --pipeline data-explainer|documentary|shorts|promo [--style midnight-data] [--aspect 16:9] [--example spacex-motion|spacex-ipo|promo-demo]
onevideo status | validate [--strict] | approve <stage> [--note …]
onevideo tts [--sample|--dry|--force|--only a,b]   # 逐句合成 → plan/timings.json（含响度归一化）
onevideo music [--preset ambient|pulse|documentary|bright]
onevideo assets suggest [--scene a,b] [--per 3] [--kind image|video|both] [--write [--no-generate]] [--no-llm]   # 按场景出检索词并找授权候选（默认图片+视频，每场景保证一条动态镜头）→ plan/asset-suggestions.json；--write 追加进 assets.json，并给每场景补一张经 API 站生成的 AI 图
onevideo assets search <q> [--provider nasa,wikimedia,openverse,pexels] | assets fetch [--only a,b] [--force] [--jobs 3]   # 含 generate：AI 生图 / 生视频（并发）
onevideo depth [asset ids] [--step N]               # 深度图 + 亮度网格：主体穿越、关键词避让、自动加底、字幕避让
onevideo capture <url> --id x [--device phone|tablet|desktop] [--click sel] [--rects name=sel,…] [--full] [--dark]   # 真实界面截图（自起无头 Chrome）
onevideo screen <asset> [--at s] [--threshold 40]   # 找实拍里黑屏的四角 → footage.screen 片段
onevideo stems                                     # 按 stem 分组导出分轨 wav → out/publish/stems/
onevideo timeline | stills [--scene id] [--at 0.3,0.7] [--aspect 9:16] | studio
onevideo preview [--at 0.3,0.7]                     # 全部场景静帧联系表 → out/qc/preview-*.jpg + plan/preview.json，给用户审批
onevideo render [--draft] [--scenes a,b | --from s --to s] [--note …]   # 每次一个版本 → out/versions/vN
onevideo render --aspect 9:16|1:1|4:5               # 同一剪辑的其他尺寸 → out/<name>.9x16.mp4（字幕按画幅重排，配音复用缓存）
onevideo versions                                   # 渲染记录：版本、范围、时间轴哈希、备注
onevideo handoff [--lock …] [--next …]              # 交接页 → plan/handoff.md
onevideo lib list|search|recipe <name> --id x --set k=v   # 音效 / Lottie / 镜头配方
onevideo sheet [--fps 1] [--from s] [--to s] [--video v3] [--vs prev]   # 联系表 → out/qc/sheet-NN.jpg；--vs 新旧对比
onevideo look [--focus "字幕可读性"] [--models a,b]   # 视觉模型看片 → out/qc/look.json
onevideo qc | publish [--stems] [--formats 9:16,1:1] [--no-archive] | build [--draft] | doctor | decide <category> <subject> --selected X
onevideo archive [--dry] [--prune] [--keep 2]       # 上传到 MangoDrive，逐个回读 sha256 校验 → plan/archive.json；--prune 本地只留最近 2 版
onevideo archive --all [--in dir] [--prune]         # 目录下全部项目（跳过 10 分钟内刚写的文件）；VM 每晚由 systemd timer 跑
onevideo restore [paths…] | restore <name> [--into dir]   # 从 MangoDrive 取回（校验 sha256）
```

未全局安装时，用 `node <repo>/cli/onevideo.mjs …` 调用。

## 参考

- 流水线定义：`pipelines/*.json`；视觉风格：`styles/*.json`
- 写作：`references/writing-zh.md` · 读音：`references/tts-pronunciation.md`
- 场景与动效：`references/motion-rules.md`（先读）· `references/scene-catalog.md`
- 数据与授权：`references/data-integrity.md` · `references/licensing.md`
- 质检：`references/qc-thresholds.md`
- 代码架构（改 CLI 前先读）：`references/architecture.md`
- 示例：`examples/spacex-motion/`（动效引擎示范，36s）· `examples/spacex-ipo/`（数据图表版，85s）· `examples/promo-demo/`（promo 流水线：capture 截图 + device 场景，20s）；`onevideo init demo --example spacex-motion`
