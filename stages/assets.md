# 阶段：assets — 素材

**产物**：`plan/assets.json`（schema：`schemas/assets.schema.json`） · 所有流水线都在 storyboard **之前**、需审批

所有外部图片/视频都通过清单进入工程，每条带许可证与出处，片尾自动署名。

## 素材先行：找全、下载、给用户看

第一版片子差，多半不是文案，而是画面没东西可看。所以素材在分镜之前定：

1. `onevideo assets suggest`：按 script 的每个场景出 2–3 个英文检索词（场景里写了 `search: [...]` 就用它，其余一次 LLM 调用补齐，回复被截断时只对缺的场景再问一次，仍失败才退回旁白里的英文名词），默认图片和视频一起找（`--kind both`）：图片在 NASA / Wikimedia / Openverse，视频在 NASA / Wikimedia / Internet Archive（有 key 时都加 Pexels），每场景取 `--per` 条且保证至少一条动态镜头，写进 `plan/asset-suggestions.json`（每条带许可、作者、出处、尺寸和命中的检索词）。已在清单里的来源会跳过；某个源 429 时等 20 秒只重试它；被 Cloudflare 挑战拦下（403）的源本次运行内不再请求。
2. 挑：看候选，把要用的写进 `assets.json`（`--write` 直接把全部候选按 `<场景>-<n>` 追加进去，再删掉不要的；并给每个场景补一张经 API 站生成的 AI 图（画面描述由出检索词的那次 LLM 调用另写一句 `still`，只写场景、物件、光线；没有时用 visualIntent；绝不拿检索词凑，检索词点名真人）——当下题材的授权素材常是老胶片或擦边，AI 图给分镜一个贴题的选项，没有授权候选时它就是替身；`--no-generate` 关掉。AI 图不画可辨认的真实人物和公司标志，人物只以背影或虚焦出现，纪实片里以假乱真会误导；也不计入密度门控）。宁多勿少——分镜时用不上的可以不引用。
3. `onevideo assets fetch` 下载，再把 `public/assets/` 里的实物（不是候选列表）给用户看，通过后 `onevideo approve assets`。之后 fetch 改了清单，该阶段会变 stale，需要再给用户看。
4. 分镜按手里的素材写。

**密度目标**：真实素材（照片、实拍、截图、logo；生成图不算）每分钟 ≥8 个；<4 个时 density 门控报错，拦住渲染。超过 6 秒的纯文字场景（title / kinetic / bullets / quote…）没有任何真实素材会被警告。阈值在 `onevideo.json` 的 `gates`：`minAssetsPerMinute`（默认 4，0 关闭）、`goodAssetsPerMinute`（8）、`bareTextMax`（6 秒）。


## 清单条目

```json
{ "items": [
  { "id": "launch", "query": "Falcon 9 launch", "provider": ["nasa", "wikimedia"] },
  { "id": "pad", "url": "https://…/pad.jpg", "license": "CC BY 4.0", "author": "…", "source": "https://…" },
  { "id": "cover", "generate": "深蓝夜空下的火箭剪影，电影感，无文字" }
] }
```

- `query`：按 provider 顺序检索（图片默认 NASA → Wikimedia → Openverse；视频默认 NASA → Wikimedia → Internet Archive，有 `PEXELS_API_KEY` 时再加 Pexels；视频下载后自动裁成无声 H.264 片段，`clip: [起点秒, 时长秒]`，默认前 20 秒，最长 60 秒），按许可开放度、画幅贴合度、分辨率打分取第一（`pick` 可指定第 N 个）。
- `url`：直链，必须手填 `license`/`author`/`source`。
- `generate`：AI 生成，许可记为 `generated`，片尾标注“AI 生成”。可以直接写一句 prompt，也可以写成对象：

  ```json
  { "id": "pad", "generate": { "prompt": "蓝调时刻海边发射台上的火箭，电影感，无文字", "variants": 3, "brief": "开场远景，上方留出标题位置" }, "query": "Falcon 9 launch pad" },
  { "id": "liftoff", "kind": "video", "generate": { "prompt": "缓慢推近，火箭点火升空", "from": "pad", "duration": 6 } }
  ```

  - 图片：模型按 `model` / `models` 的顺序依次尝试，默认 `gpt-image-2.5` → `grok-imagine-image-quality`；尺寸跟随项目画幅。`variants`（1–4）一次出多张，由视觉模型按 `brief` 挑一张；所有备选都保存为 `<id>.take<k>.*`，`picked` / `pickReason` 记录挑选结果，`pick: N` 可以直接指定。
  - 视频：`kind: "video"`，走 `/videos` 任务接口（提交 → 轮询 → 下载），默认 `grok-imagine-video` → `grok-imagine-video-1.5`。`duration` 取 1–15 秒，`resolution` 默认 720p；`from` 指定一个图片素材，把它当首帧做成动态画面（这类条目会排在最后取）。取回后和下载的视频一样，裁成片段并抽出帧序列。生视频失败时（中继常限流 429），带 `from` 的条目先用那张静帧顶上：`kind` 变成 `image`、记一个 `fallback`，footage 场景照样按镜头运动推它（场景里写的变速 `ramp` 会自动换成推镜，静帧不会定住），片子能先渲出来；validate 会警告，下一次 `assets fetch` 自动重试生视频。不想要这个替身就写 `still: false`。
  - 生视频取回后会自动质检：把整段铺成一张联系表，交给视觉模型找人物重复、肢体变形、物体凭空出现、乱码、镜头跳变，再挑出最长的一段干净画面作为片段（`keep: 3` 限制最多保留几秒）。结果写进条目的 `inspect`（分数、问题时间点、保留区间）；评分 ≤4 会警告建议重生成。手写了 `clip` 或 `inspect: false` 时跳过。
  - 生成失败时会回落到同一条目的 `url` / `query`，并给出警告；两者都没有时报错。

  **生成的四条规矩**：

  1. **给字留位置**：prompt 里写清楚构图，比如“主体在右三分之一，左侧留空”“上方留出标题位置”，并写“无文字”，字由分镜叠上去。
  2. **一个镜头、机位固定、只有自然的小动作**：不要在一条 prompt 里写多个镜头、大幅运镜或复杂动作，越复杂越容易变形。需要推拉就在分镜里用 `shots` 做。
  3. **先出一条样片**：同一个风格要批量生成前，先生成一条看效果，满意后再把同样的写法用到其他条目。
  4. **看完整条，只留最稳的 2–3 秒**：生成视频的开头和结尾最容易出问题。自动质检挑的区间要在联系表上确认，必要时手写 `clip` 覆盖。
  - 全局默认写在 `onevideo.json` 的 `image` / `video` / `llm` 段（`baseUrl`、`keyEnv`、`model(s)` 等）。`onevideo doctor` 会显示当前生效的模型顺序。

## 命令

```bash
onevideo assets suggest                                            # 每场景的授权候选 → plan/asset-suggestions.json
onevideo assets suggest --scene hook,ipo --per 5 --kind image --write  # 指定场景、只要图片、直接追加进清单
onevideo assets search "falcon heavy" --provider nasa,wikimedia   # 单个检索词看候选
onevideo assets fetch                                              # 下载缺失项 → public/assets/（默认 3 个并发，--jobs 调）
onevideo assets fetch --only launch --force                        # 重取单个
```

## 真实界面（promo）

```bash
onevideo capture https://example.com/ --id home --device phone --rects card=.card,player=.player
onevideo capture https://example.com/ --id detail --device phone --click ".card:nth-child(2)" --rects chapters=.chapters
```

- 自己起一个无头 Chrome（Remotion 的 chrome-headless-shell，或 `ONEVIDEO_CHROME`），临时 profile、随机端口，截完只关自己那一个；不连用户正在用的浏览器。
- 视口：phone 390×844 @3x（iPhone UA、触屏）、tablet 820×1180 @2x、desktop 1440×900 @2x；`--full` 截整页，`--dark` 用深色模式，`--wait` 等待毫秒，`--click` 依次点选择器（如打开详情）后再截。
- `--rects name=选择器` 量出元素在截图里的位置（0–1），写进条目的 `rects`，分镜里 `tap`/`expand.rect`/`focus` 直接写名字；选择器找不到会警告，分镜引用不存在的名字会报错。
- 条目记为 `via: "capture"`、许可 `own`，截图设置保存在 `capture` 里，`assets fetch --force` 按同样设置重截。
- 实拍里有黑屏的手机/电脑时：`onevideo screen <实拍素材> [--at 秒]` 找出屏幕四角，输出可直接粘进 `footage.props.screen` 的片段。

## 许可（详见 `references/licensing.md`）

允许：PD/CC0、CC BY、CC BY-SA、Pexels/Pixabay License、generated、own。拒绝：NC、ND、未知许可。licensing 门在 validate 时检查。

## 用法

在分镜里用 `media` 场景（`props.asset: "<id>"`）或 `quote`/`compare` 的 `asset` 字段引用。
