# 单文件构建输出设计

日期：2026-07-25

## 1. 目标

在现有多文件构建基础上，新增单文件 HTML 输出，将 CSS、JS、笔画数据和音频全部内联到一个 `.html` 文件中，方便传输到平板电脑直接使用。

## 2. 输出物

```
dist/
├── hanzi-grade4.html    ← 单文件版，约 2-5MB，可直接在平板浏览器打开
└── folder/
    ├── index.html
    ├── styles.css
    ├── js/
    ├── data/
    └── assets/audio/    ← 多文件版，方便桌面调试
```

## 3. 构建流程

构建脚本 `scripts/build-single-file.mjs`：

1. 读取 `dist/folder/index.html` 作为模板
2. 把 `<link rel="stylesheet" href="styles.css">` 替换为 `<style>` + CSS 内容
3. 把每个 `<script src="data/library-data.js">` 和 `<script src="js/*.js">` 替换为 `<script>` + JS 内容
4. 修改 library-data 中的音频文件路径为 Base64 data URI（`data:audio/mp4;base64,...`）
5. 写入 `dist/hanzi-grade4.html`

音频 Base64 编码在 library-data 构建时完成。`build-library.mjs` 新增 `--inline-audio` 参数，启用时将每个音频文件读取并编码为 data URI 写入 library-data payload。

## 4. npm scripts 变更

```json
{
  "build:data": "node scripts/build-library.mjs",
  "build:standalone": "node scripts/build-single-file.mjs",
  "build": "npm run build:data",
  "build:all": "npm run build:data && npm run build:standalone"
}
```

- `npm run build`：多文件版，产出 `dist/folder/`
- `npm run build:standalone`：依赖多文件版产物，读取后内联所有 CSS/JS/音频，产出 `dist/hanzi-grade4.html`
- `npm run build:all`：两个都产出

## 5. 注意事项

- 单文件版中不再有网络请求或文件系统依赖
- Base64 编码会使音频体积增大约 33%，预计单文件总体积 2-5MB
- 单文件版的 library-data 与多文件版共用同一构建产物，区别仅在于音频路径格式
- 构建后的单文件可直接通过 AirDrop、USB、邮件等方式传到平板
