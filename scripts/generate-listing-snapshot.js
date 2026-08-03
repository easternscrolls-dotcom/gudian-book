// 生成列表页 SEO 静态快照 snapshot/index.html
// 供 Cloudflare Worker 在爬虫访问站点根路径（/ 或 /index.html）时直接返回，
// 让搜索引擎爬虫无需执行 JS 即可发现全部书籍链接（Baidu/Yandex/Sogou 等 JS 支持弱）。
//
// 用法：  node scripts/generate-listing-snapshot.js
// 读取：  books.json（根目录，9712 本 / 34 类）
// 写出：  snapshot/index.html
//
// 说明：snapshot/ 已被 .gitignore 排除，不进 Pages 部署；该文件由 upload-snapshots 上传到 R2。

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const books = JSON.parse(fs.readFileSync(path.join(ROOT, "books.json"), "utf-8"));

// 按分类分组
const byCat = new Map();
for (const b of books) {
    const cat = b.category || "未分类";
    if (!byCat.has(cat)) byCat.set(cat, []);
    byCat.get(cat).push(b);
}

function esc(s) {
    return String(s == null ? "" : s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

// 生成每本书的链接（与前端一致：read.html?book=&title=）
function bookHref(b) {
    return "read.html?book=" + encodeURIComponent(b.file) +
        "&title=" + encodeURIComponent(b.title || "");
}

let sections = "";
for (const [cat, list] of [...byCat.entries()].sort((a, b) => a[0].localeCompare(b[0], "zh"))) {
    const items = list.map(b =>
        `<li><a href="${esc(bookHref(b))}">${esc(b.title || "（无名）")}</a>` +
        (b.author ? ` <span class="author">${esc(b.author)}</span>` : "") +
        `</li>`
    ).join("\n      ");
    sections += `    <section class="cat">
      <h2>${esc(cat)}（${list.length}）</h2>
      <ul>
      ${items}
      </ul>
    </section>\n`;
}

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>古籍公版书库 | 书目总览（${books.length} 本）</title>
<style>
  body{background:#f7f3e9;color:#2c2c2c;font-family:"Microsoft Yahei",SimSun,sans-serif;line-height:1.85;margin:0;}
  .container{max-width:900px;margin:0 auto;padding:20px;}
  h1{color:#442e1e;}
  h2{color:#332211;border-bottom:1px solid #d9d2c3;padding-bottom:6px;margin-top:32px;}
  ul{list-style:none;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:8px 20px;}
  li{background:#fff;border:1px solid #e0d9cc;border-radius:6px;padding:8px 12px;}
  a{color:#5a4535;text-decoration:none;}
  a:hover{text-decoration:underline;}
  .author{color:#888;font-size:13px;}
</style>
</head>
<body>
<div class="container">
  <h1>古籍公版书库 · 书目总览</h1>
  <p>收录 ${books.length} 本公版古籍，分 ${byCat.size} 类。以下为全部分册链接，供搜索引擎索引。</p>
${sections}  </div>
</body>
</html>
`;

const outDir = path.join(ROOT, "snapshot");
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, "index.html");
fs.writeFileSync(outFile, html, "utf-8");
console.log("已生成", outFile, "| 字节:", Buffer.byteLength(html, "utf-8"), "| 分类:", byCat.size, "| 书目:", books.length);
