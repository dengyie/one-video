# 月面留下的脚印

一支约半分钟的中文纪录片示例：NASA 发射实拍 → NASA 月面靴印照片 → 想象中的月面插画。三幕各自用 `props.asset` 指向对应的素材；发射实拍用全屏的 `footage`，两张静帧都用 `media` 的 `fit: "contain"`，让档案照片里的靴印和插画里的地球在横竖版都不会被裁掉。两处叠化由后一个场景的 `enter` 控制，旁白和字幕不随画面的重叠而移动。旁白用“想象一下”引入非写实插画，和档案画面区分开。

在仓库根目录运行一次 `npm run setup`，再进入本目录。需要 FFmpeg、中文字体和为图片生成及旁白配置的 `MANGO_API_KEY`。

```sh
node ../../cli/onevideo.mjs assets fetch
node ../../cli/onevideo.mjs tts
node ../../cli/onevideo.mjs music
node ../../cli/onevideo.mjs validate
node ../../cli/onevideo.mjs preview
# 查看 out/qc/preview-*.jpg，确认后再继续。
node ../../cli/onevideo.mjs approve preview
node ../../cli/onevideo.mjs render
node ../../cli/onevideo.mjs qc
```

成片在 `out/mixed-source.mp4`。NASA 素材及出处见 [素材清单](plan/assets.json)；首次会下载完整发射档案（约 174 MB），只保留剪出的片段。首次运行也会生成插画，因此每次重新生成的画面可能不同。取回后的素材和成片不提交到仓库。

横版的素材取回后，可以用 `node ../../cli/onevideo.mjs stills --aspect 9:16` 检查竖版构图，再用 `node ../../cli/onevideo.mjs render --aspect 9:16` 输出 `out/mixed-source.9x16.mp4`。
