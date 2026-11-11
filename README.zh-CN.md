<div align="center">

# OneVideo

**阶段化机械门控 AI 视频生产流水线与 Remotion 动效合成引擎**

[![License](https://img.shields.io/badge/license-MIT-green.svg?style=flat-square)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-5FA04E.svg?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0%2B-3178C6.svg?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Remotion](https://img.shields.io/badge/Engine-Remotion%20v4-0B84FF.svg?style=flat-square&logo=remotion&logoColor=white)](https://www.remotion.dev/)
[![FFmpeg](https://img.shields.io/badge/FFmpeg-6.0+-007808.svg?style=flat-square&logo=ffmpeg&logoColor=white)](https://ffmpeg.org/)
[![Tests](https://img.shields.io/badge/tests-passing-brightgreen.svg?style=flat-square)]()

[English](./README.md) · [简体中文](./README.zh-CN.md) · [核心特性](#核心特性) · [安装指南](#环境安装) · [Skill 接入](#作为-claude-code--zcode-skill-使用)

</div>

---

面向 Claude Code / ZCode 生产带旁白视频（数据解说、纪录片、竖屏短视频、产品宣传）的工业级全自动流水线和 Agent Skill。全流程分阶段推进，每一步均受严格的机械门控（Mechanical Gates）约束与校验。

```
research → proposal → script → storyboard → assets → voice → compose → render → review → publish
  事实+来源   方案      逐句脚本    分镜/图表     授权素材   TTS+响度   时间轴     Remotion   自动 QC   字幕/章节/简介
```

---

## 核心特性

- **引擎共享，项目只存数据**：项目目录仅持久化 `onevideo.json`、`plan/*.json`、`public/`、`out/`，多项目统一复用全局 Remotion 动效引擎。
- **阶段状态机**：创作关键节点支持人工审批，审批时锁定产物哈希（基于项目内相对路径计算，跨主机迁移依然有效）。已审批产物变更后状态自动置为 stale，强制重新校验。
- **严格机械门控**：
  - **数字溯源门控**：旁白中出现的每一个统计数字必须精确对应 `research` 中具名来源的 fact id。
  - **语速节奏门控**：基于音节算法严格约束在 3.5–6.2 音节/秒最佳听感区间。
  - **合规审计门控**：字幕单行字符数、分镜最短时长、第三方素材授权合规性全自动前置扫描。
- **逐句精确 TTS 计时**：字幕与画面揭示精确跟随真实语音时间戳推进。全局执行 EBU R128 / ITU-R BS.1770 响度归一化（默认 −16 LUFS）与防削顶软限幅。
- **现代影视级动效引擎**：
  - 每个场景独立运镜轨道（缓慢推拉、跳切、物理动态模糊）。
  - 实拍变速跟随、大标题前景主体遮蔽遮罩（Through 转场）。
  - 无限画布镜头穿越飞行、音乐重拍吸附（`music.offset: "auto"`）与动态音效（SFX）自动对齐。
- **深度与主体画面感知**：通过 `onevideo depth` 提取景深图与网格明度，指引运镜避让前景主体，高对比度字幕智能避障。
- **生产级素材与 AI 生成**：
  - NASA、Wikimedia Commons、Openverse 免 Key 检索集成。
  - OpenAI 兼容文生图、图生视频回落通道，视觉模型自动质检人物畸变与跳帧。
- **发布级质检 (Automated Post-Render QC)**：
  - 自动审查封装编码、分辨率、帧率、有效时长、真峰值电平、静音区间、冻结帧与抽帧质检报告。
  - 导出 SRT/VTT 双语字幕、章节锚点与 YouTube/Bilibili 简介元数据，支持 `--stems` 旁白/配乐/音效分轨分流。

---

## 环境安装

运行要求 Node.js ≥ 20。

```bash
git clone https://github.com/dengyie/one-video.git
cd one-video

npm run setup            # 安装 template/ 下的 Remotion 核心引擎（内置 ffmpeg）
npm link                 # 全局注册 onevideo CLI
export MANGO_API_KEY=…   # OpenAI 兼容中继 key：TTS 必需，生图/生视频/look 审片可选
onevideo doctor          # 诊断依赖与运行环境
```

Linux 服务器环境（Debian/Ubuntu）如需无头渲染，安装 Chrome Headless 依赖与中文字体库：

```bash
apt-get install -y --no-install-recommends \
  libnss3 libdbus-1-3 libatk1.0-0 libatk-bridge2.0-0 libcups2 \
  libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
  libgbm1 libasound2 libpango-1-0-0 libcairo2 fonts-noto-cjk
```

---

## 快速上手

```bash
# 从动效示范项目初始化
onevideo init my-video --example spacex-motion
cd my-video

# 检查流水线阶段状态
onevideo status

# 验证 Schema 与门控契约
onevideo validate

# 单句试听 TTS 语调与语速
onevideo tts --sample

# 全流程编排与渲染 (TTS -> 配乐 -> 素材 -> 时间轴 -> Remotion 渲染 -> 自动 QC)
onevideo build

# 审阅生成的抽帧截图后批准
onevideo approve review

# 生成发布物料包
onevideo publish
```

---

## 作为 Claude Code / ZCode Skill 使用

在本地 Agent 工具链中建立软链接：

```bash
ln -s "$PWD" ~/.claude/skills/onevideo
```

在对话中直接通过自然语言调度：“帮我生成一条关于 SpaceX 最新星舰试飞的解说视频”。

---

## 项目结构

| 目录 | 职责说明 |
|---|---|
| `cli/` | `onevideo` 原生命令行工具，零外部 NPM 依赖 |
| `template/` | Remotion 动效引擎（分镜组件、主题设计系统、动态转场） |
| `pipelines/` | 数据解说、纪录片、短视频等预置流水线阶段编排 |
| `stages/` | 各阶段导演规范与自检清单 |
| `styles/` | 视觉风格设计 Token 与配色资产 |
| `schemas/` | 各阶段产物与项目配置 JSON Schema 强校验契约 |
| `references/` | 语言风格、读音矫正字典、数据合规要求与质检阈值矩阵 |
| `examples/` | 工业级样例工程（动效示范、图表解说、产品界面宣传） |
| `tests/` | 自动化单元与门控测试套件 |

---

## 开源许可证

本项目基于 [MIT License](LICENSE) 开源发布。
