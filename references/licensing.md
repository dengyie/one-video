# 素材授权

`assetsGate` 用白名单：不在名单上的授权一律阻止渲染。

| 归一化 | 识别的写法 | 要求 |
|---|---|---|
| `pd` | PD、Public Domain、PDM、CC0、PD (NASA) | 无，片尾仍会列出 |
| `cc-by` | CC BY x.x | 必须有 `author` 和 `source` |
| `cc-by-sa` | CC BY-SA x.x | 同上；成片按同协议分享 |
| `pexels` / `pixabay` | Pexels License、Pixabay License | 记录来源链接 |
| `generated` | AI 生成 | 片尾标“AI 生成 · 模型名” |
| `own` | own、self | 自有素材 |

**拒绝**：任何带 NC（非商用）或 ND（禁止演绎）的协议、“editorial use only”、未知或空授权。

## 来源与优先级

`onevideo assets fetch` 的图片按 NASA Images → Wikimedia Commons → Openverse、视频按 NASA → Wikimedia → Internet Archive 搜索（都不需要 key），按“授权开放度 + 画幅贴合度 + 分辨率”打分取第一名。`PEXELS_API_KEY` 存在时可用 Pexels 的图片和视频。

- **NASA**：美国政府作品，通常是公有领域。注意 NASA 标志本身和含人物肖像的照片有额外限制。
- **Wikimedia**：逐张看授权，搜索时已过滤 NC/ND。
- **Openverse**：只请求可商用、可修改的结果。
- **Internet Archive**：只取条目 licenseurl 是公有领域 / CC0 / CC BY / CC BY-SA 的影片（按标题检索），没有 licenseurl 或带 NC/ND 的一律不要；下载 1080p 以内最清晰的版本，mp4 只是 240p 派生件时改取更清晰的 ogv / avi（Remotion 自带的 ffmpeg 读不了 .mpeg 原件）。署名照搬条目的 creator。

## 不要用

- 新闻图片、公司官网图片、截图，除非有明确授权。
- 商标、logo 作为画面主体（指称性使用除外，且不要暗示背书）。
- 可辨认的真人肖像用 AI 生成。
- 带水印的图片。

## 音乐

- 默认背景音乐是 `cli/lib/audio/synth.mjs` 程序化合成的，没有版权负担，片尾标“OneVideo 程序化合成”。
- 自带音乐：`music.file` 指向 `public/` 下的文件，并在 `music.credit` 写明曲名、作者和授权，否则 timeline 会警告，简介里也不会出现音乐署名。

## 署名去向

所有素材的 `credit`（标题 · 作者 · 授权）会同时进入：片尾 sources 场景、`out/publish/description.txt` 的“素材来源”。
