// 本地静态预览服务器（UTF-8 友好，正确处理中文路径）
// 用于本地预览古籍书库前端（python -m http.server 在 Windows 上对中文路径会 404）。
//
// 用法：
//   node scripts/devserver.js            # 默认 http://127.0.0.1:8080
//   PORT=9000 node scripts/devserver.js  # 自定义端口
//
// 注意：这是开发预览工具，不属于 Pages 部署产物（已被 .gitignore 忽略构建无关项；
//       本文件随仓库提交，方便本地预览）。

const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, ".."); // 项目根目录
const PORT = process.env.PORT || 8080;

const MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".br": "application/octet-stream",
    ".md": "text/markdown; charset=utf-8"
};

http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split("?")[0]);
    if (p.endsWith("/")) p += "index.html";
    const fp = path.resolve(ROOT, "." + p);

    // 路径穿越防护（归一化后用 ROOT 前缀校验）
    if (fp !== ROOT && !fp.startsWith(ROOT + path.sep)) {
        res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
        return res.end("forbidden");
    }

    fs.readFile(fp, (err, data) => {
        if (err) {
            res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
            return res.end("404 Not Found: " + p);
        }
        const ext = path.extname(fp).toLowerCase();
        res.writeHead(200, {
            "Content-Type": MIME[ext] || "application/octet-stream",
            "Cache-Control": "public, max-age=60"
        });
        res.end(data);
    });
}).listen(PORT, "127.0.0.1", () => {
    console.log("serving " + ROOT + " on http://127.0.0.1:" + PORT);
});
