# 教你炒股票 · 阿娇版静态阅读站

这是《教你炒股票--阿娇版》PDF 的静态网页阅读版。全书 108 课、开篇“股市闲谈”及两篇附录均已逐章编辑和独立复核。

站点同时是可安装的 PWA：移动端可添加到桌面，首次只缓存阅读器骨架；打开某章时，才按章节缓存该章 JSON 和该章图片。阅读进度保存在本机，重新打开会恢复章节和具体阅读位置。点击原书图片可进入支持双指、滚轮缩放和拖动的查看器。

## 本地预览

直接双击 `index.html` 会被浏览器的跨域规则拦截章节 JSON，请在仓库根目录启动静态服务器：

```powershell
python -m http.server 8787 --bind 127.0.0.1
```

然后访问 <http://127.0.0.1:8787/>。

## 结构

- `index.html`：只保留网站骨架与无脚本提示。
- `assets/styles.css`：排版、主题、响应式与打印样式。
- `assets/app.js`：目录、章节渲染、字号、主题、进度与续读功能。
- `manifest.webmanifest`：PWA 安装信息与图标声明。
- `service-worker.js`：阅读器骨架缓存，以及按已访问章节缓存正文和图片。
- `assets/icons/*`：桌面与移动端安装图标。
- `data/book.json`：全书 108 课目录元数据。
- `data/source_manifest.json`：111 篇内容在 PDF 中的精确页内边界。
- `data/chapters/*.json`：按章节拆分的结构化正文数据。
- `docs/editing-progress.md`：逐章编辑、Agent Review、修订和最终状态台账。
- `scripts/validate_site.py`：检查目录、全书内容块和 PWA/缓存契约。

原始 PDF 只作为本地校对来源，已由 `.gitignore` 排除，不会上传到 GitHub Pages。

## GitHub Pages

`.github/workflows/pages.yml` 会在 `main` 更新后先校验结构化数据，再发布纯静态文件；不需要 Node.js 构建步骤或第三方前端依赖。
