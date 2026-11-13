# 阶段：publish — 发布包

**产物**：`plan/publish.json`、`out/publish/`

```bash
onevideo publish
```

前提：QC 不是 FAIL，且 `review` 阶段已审批（`onevideo approve review`）。重跑 qc 会让审批变 stale，需要重新看帧、重新审批。`--force` 只在用户明确同意跳过人工审阅时使用。

生成：

- `captions.srt` / `captions.vtt`：字幕（与成片一致的时间轴）
- `chapters.txt`：章节时间戳（来自脚本 `chapter` 字段，首个章节从 00:00 开始）
- `description.txt`：标题、摘要、章节、资料来源、素材署名
- `plan/publish.json`：上述内容的结构化版本 + 警告
- `--formats 9:16,1:1,4:5`：同一剪辑的其他尺寸（竖屏短视频平台用 9:16，信息流用 1:1 / 4:5），缺的或比时间轴旧的会先渲染成 `out/<name>.9x16.mp4` 等；已渲染过的变体（`onevideo render --aspect 9:16`）不加参数也会收进发布包。每个尺寸带自己的 `captions.9x16.srt/.vtt`——竖屏字幕每行更短，断句和时间点都和横版不同，不能混用。`plan/publish.json` 的 `formats` 记录各尺寸的文件、宽高和字幕
- `--stems`（或单独 `onevideo stems`）：按组导出分轨到 `out/publish/stems/`——`voice.wav`、`music.wav`、`sfx.wav`，以及给音效写了 `stem` 的自定义组；各轨相加等于成片混音，方便在剪辑软件里重新混音

QC 结论为 fail 时拒绝生成。发布到具体平台（B站、YouTube、视频号）由用户操作；本工具不上传。

## 检查

- 简介中的数据来源是否完整、日期是否正确
- CC BY / CC BY-SA 素材的署名是否保留在简介中
- publish 输出里列出的 AI 生成素材：投稿时在平台勾选 AI 内容标识（视频内不标注）
