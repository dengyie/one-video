# 代码架构

`cli/onevideo.mjs` 只做命令分发；`cli/commands/*` 是命令（读写项目文件、打印进度）；`cli/lib/<领域>/` 是可测试的逻辑，不打印、不读命令行参数。渲染在 `template/`（Remotion），它只读 `plan/timeline.json`。

## 领域模块（`cli/lib/`）

| 目录 | 管什么 | 主要入口 |
|---|---|---|
| `core/` | 项目加载与路径、参数解析、HTTP（重试、密钥）、ffmpeg、JSON Schema、阶段状态、文本度量（视觉宽度、朗读音节、读音规则、数字提取） | `project.mjs` `http.mjs` `ffmpeg.mjs` `text.mjs` |
| `captions/` | 字幕：旁白切行（`splitLines` `sceneLines` `captionMaxChars`）、字幕带位置与主体避让（`captionBand` `placeCaptions`）、SRT/VTT（`toSrt` `toVtt`）、宽度门禁（`captionGate`） | `index.mjs` |
| `voice/` | 配音：TTS 请求、按停顿对齐字幕行、响度归一 | `tts.mjs` |
| `audio/` | WAV 读写、响度、程序化音乐与音效、节拍检测 | `wav` `loudness` `synth` `beats` |
| `library/` | 本地素材库（音效 / Lottie / 配方）、图标、国家地图 | `catalog` `icons` `geo` |
| `llm/` | 模型客户端：`ask`（文本 + 图片，JSON 回复解析、模型回退） | `client.mjs` |
| `prompts/` | 所有发给模型的提示词，一个提示词一个纯函数（数据进、字符串出） | `index.mjs` |
| `generate/` | 生图（多 take + 视觉挑选）、生视频（提交 / 轮询 / 质检截取）、共用配置与模型回退 | `index.mjs` |
| `assets/` | 素材来源（NASA / Wikimedia / Openverse / Pexels 搜索与排序）、取素材（`fetchAsset`）、媒体文件（剪片、帧序列、深度 / 亮度图路径） | `index.mjs` |
| `vision/` | 画面分析：深度主体与对比度、屏幕检测、UI 截图（自起 Chrome）、联系表、成片 QC | `subject` `screen` `capture` `sheet` `qc` |
| `timeline/` | 时间线编译：`compile.mjs` 编排，各道工序分文件——`cues`（短语 / 节拍定时）、`transitions`、`sfx`、`shots`（镜头轨、硬切、音乐偏移）、`props`（画布 / 设备等的内部时间）、`anchors`（叠层锚点）、`credits` | `index.mjs` |
| `review/` | 门禁（数字核对、分镜、语速、节奏、授权……）与 `checkProject` 汇总 | `gates.mjs` `check.mjs` |
| `publish/` | 发布包（章节、致谢、简介）、交接页、渲染版本记录 | `kit` `handoff` `renders` |

## 依赖方向

自下而上分层，只往下引用（实测 import 关系）：

```
prompts                      （纯字符串，无依赖）
core                         （无领域依赖）
llm · audio · vision         → core
library                      → audio, core
captions                     → vision, core
voice                        → captions, audio, core
generate                     → prompts, llm, vision, assets/media, core
assets                       → generate, core
timeline                     → captions, vision, library, audio, assets/media, core
review                       → timeline, captions, voice, core
publish                      → review, timeline, captions, voice, core
commands                     → 以上任意
```

- 这张表由 `tests/architecture.test.mjs` 守住：新领域、越层引用、`cli/lib/` 下的散文件都会让测试失败。
- `assets` 与 `generate` 互相用到，但只在文件层单向：`assets/fetch.mjs` → `generate/`，`generate/video.mjs` → `assets/media.mjs`，没有循环。
- 领域之外从 `index.mjs` 引入；领域内部、或需要避免循环时，直接引具体文件（如 `generate/video.mjs` 引 `assets/media.mjs`，而不是 `assets/index.mjs`）。
- 加一个提示词：在 `prompts/` 新建 `<名字>.mjs` 导出构造函数，加进 `prompts/index.mjs`，调用方 `ask({ prompt: xxxPrompt({...}) })`。
- 加一种字幕能力（新格式、新排版规则）：放 `captions/`；时间线编译只调用 `placeCaptions`，播放器渲染在 `template/src/engine/Captions.tsx`。
- 加一个生成后端或素材源：生成放 `generate/`（复用 `common.mjs` 的 `genConfig` / `firstModel`），素材源加进 `assets/sources.mjs` 的 `PROVIDERS`。
- 时间线新工序：在 `timeline/` 加文件，导出纯函数，由 `compile.mjs` 调用，并加进 `timeline/index.mjs`。
