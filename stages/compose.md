# 阶段：compose / render — 合成与渲染

**产物**：`plan/timeline.json`、`public/music/`、`public/sfx/`、`out/<name>.mp4`

## 步骤

```bash
onevideo music        # 程序化 BGM（按时间轴长度）+ 用到的音效
onevideo timeline     # 编译时间轴：场景时长、字幕、cue、旁白区间
onevideo stills       # 每场景一帧（默认 70% 处）→ out/stills/，逐张看
onevideo preview      # 全部场景静帧（默认 30%/70%）铺成 out/qc/preview-*.jpg + plan/preview.json
onevideo approve preview   # 用户看过联系表并同意之后
onevideo render --draft   # 半分辨率快速版（可选，不需要 preview 审批）
onevideo render       # 正式渲染 h264 + aac（需要 preview 已审批且没变）
```

## 预览审批（preview）

整片渲染之前，先让用户看画面：`onevideo preview` 记录当前 `timeline.json` 的哈希。之后时间轴编译结果变了（改分镜、重跑 tts…），preview 变 stale，正式渲染被拦，需重新 preview 并审批。`render --draft`、`--scenes`、`--from/--to` 和其他画幅不受限制，用来迭代。`plan/preview.json` 里的 `layout` 列出当时的 layout / rhythm 问题，给用户看之前先处理掉。

## 水印（`watermark`）

`onevideo.json` 的 `watermark` 可以写一个字符串（旧写法），也可以写对象：

```json
"watermark": { "text": "芒果视频", "sub": "mangoqwq.com", "logo": "brand-logo", "position": "top-right", "style": "badge" }
```

默认 `style: "badge"`：半透明玻璃胶囊，左边圆形 logo（`logo` 是素材 id，或用 `icon`），主文字加一行小字，随画幅缩放并避开字幕区；`style: "text"` 退回纯文字。`null` 关闭。

`onevideo studio` 打开 Remotion Studio 实时预览本工程。

## 时间轴怎么算

- 场景时长 = 旁白时长 + hold（默认 0.5s），不低于 `minDuration`；无旁白场景用 `duration`（默认 4s）。
- 字幕是绝对时间，来自每句的实测起止。
- 音乐在旁白区间自动压低到 `duckTo`，0.35s 渐变。
- 转场音效（`sfx.transition`）放在每个场景开头。

## 渲染前必须

- `validate` 0 error。render 会重新编译并跑门控，有 error 时拒绝渲染（`--force` 可跳过，仅限调试）。
- 看过全部 stills：文字溢出、元素重叠、数字格式、图表刻度。

## 归档到 MangoDrive（archive / restore）

成片、版本、发布包、plan、配音和素材都可以放到 MangoDrive（OpenList 聚合的 Google 云盘），本地只留最近几版。

- 配置只在环境变量（VM 上是 `/etc/onevideo/env`，chmod 600）：`ONEVIDEO_DRIVE_URL`（以 `/api` 结尾；公网入口每个请求 ≤100 MB，内网网关不限）、`ONEVIDEO_DRIVE_USER`、`ONEVIDEO_DRIVE_PASS`（OneVideo 专用的 app 账号，不用管理员账号）、`ONEVIDEO_DRIVE_ROOT`（默认 `/onevideo`）。不写进任何项目文件。
- `onevideo archive`：上传新增或改动的文件到 `<root>/<name>/`，每个文件上传后回读算 sha256，对上了才记进 `plan/archive.json`；`--dry` 只列出要传什么；`--prune` 删掉本地比最近 `--keep`（默认 2）更旧的 `out/versions/vN.mp4`（只删已归档且未改动的）。
- 上传的：`out/versions`、`out/publish`、其他画幅成片、`plan`、`public/assets`、`public/audio`、`onevideo.json`、`state.json`、`out/renders.json`。不上传：帧序列、stills / QC / 预览图（随时可再生成），以及 `public/sfx`、`public/music` 和链到音效库的文件（授权素材不出本机）。
- `publish` 结束后自动 archive（`--no-archive` 跳过；没配环境变量时不做）。
- `onevideo restore`：取回 `archive.json` 里有、本地没有的文件（可指定路径或目录前缀，`--force` 覆盖）；在项目外 `onevideo restore <name> --into <dir>` 从云盘拉回整个项目。

## 音乐（`music`）

预设：`ambient` · `pulse` · `documentary` · `bright`；`seed` 换旋律；`file` 用自带音乐（`public/` 下的相对路径，需有授权），并用 `credit` 写明曲名 · 作者 · 许可。`enabled: false` 关闭。
