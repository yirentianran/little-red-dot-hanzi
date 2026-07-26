# 汉字追踪小课堂

面向人教版四年级上册语文的离线汉字学习网页，结合拼音、普通话发音、动态笔顺和红点视觉追踪。

## 直接使用

双击 `index.html`，或在浏览器中打开该文件即可使用。页面通过 `file://` 运行，不需要启动服务器。

学习路径为：目录 -> 课文 -> “会写 / 会认” -> 单字。单字页会显示拼音；发音只在点击“听读音”后播放，不会自动播放。米字格内按规范笔顺显示汉字，红点沿当前笔画移动；可播放或暂停、上一笔、下一笔、重新播放，并选择慢速、适中或快速。

打开过单字后，目录页会显示“继续上次学习”。浏览器不允许本地存储时，其余学习功能仍可使用。

## 项目校验

```bash
npm run check
npm run test:browser
```

`npm run check` 运行单元测试、字库校验和运行时数据构建。`npm run test:browser` 直接以 `file://` 检查离线流程、交互和响应式截图；runner 不联网，也不会下载 Playwright 或浏览器。

浏览器测试按以下顺序解析 `playwright-core`：

1. `PLAYWRIGHT_CORE_PATH` 指向的包目录或 `index.mjs` 文件。
2. 当前 Node 环境可直接导入的 `playwright-core` 包。
3. 在 macOS / Linux 上读取 PATH 中的 `playwright` 命令；runner 解析其 shebang，找到对应 Python 环境，再定位 Playwright driver。

Windows 上请使用 `PLAYWRIGHT_CORE_PATH` 显式指定 `playwright-core`，PATH 自动发现不解析 Windows 的 Python 启动器格式。

可用 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` 指定 Chromium 可执行文件；未设置时使用 Playwright 的默认浏览器配置。例如：

```bash
PLAYWRIGHT_CORE_PATH=/absolute/path/to/playwright-core \
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/absolute/path/to/chromium \
npm run test:browser
```

每次运行会在系统临时目录创建 `hanzi-browser-*` 截图目录，并在终端打印绝对路径。离线流程截图和失败诊断截图会保留在该目录中，不会自动清理。

## 数据与许可

项目代码以 MIT License 开源，见 [LICENSE](LICENSE)。

字库对应 2019 年审定的人教版语文四年级上册，共 8 个单元、31 节学习内容、521 条学习记录和 428 个唯一汉字。

汉字几何提取自 `hanzi-writer-data` 2.0.1，依照 ARPHICPL 分发；来源、修改内容和许可说明见 [data/source-data-license.md](data/source-data-license.md) 与 [data/ARPHICPL.TXT](data/ARPHICPL.TXT)。普通话音频来自 `hugolpz/audio-cmn` 的 `64k/syllabs` 子集，来源与许可见 [assets/audio/THIRD_PARTY_NOTICES.md](assets/audio/THIRD_PARTY_NOTICES.md)。
