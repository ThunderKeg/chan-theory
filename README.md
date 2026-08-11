# 教你炒股票 · 阿娇版静态阅读站

这是《教你炒股票--阿娇版》PDF 的静态网页阅读版。目前只开放第 18 课样章，用于确认排版、目录、配色和阅读功能；其余 107 课只展示目录，不含正文。

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
- `data/book.json`：全书 108 课目录元数据。
- `data/chapters/*.json`：按章节拆分的结构化正文数据。
- `scripts/validate_site.py`：检查目录、样章引用和内容块结构。

原始 PDF 只作为本地校对来源，已由 `.gitignore` 排除，不会上传到 GitHub Pages。

## GitHub Pages

`.github/workflows/pages.yml` 会在 `main` 更新后先校验结构化数据，再发布纯静态文件；不需要 Node.js 构建步骤或第三方前端依赖。
