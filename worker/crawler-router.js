// ============================================================
// Cloudflare Worker —— 搜索引擎爬虫静态快照分流
// 配套方案「第六步：Worker 分流爬虫快照」
//
// 行为：
//   1) 请求 UA 命中搜索引擎爬虫（百度/谷歌/必应/Bytespider 等）
//       且路径为书籍阅读页 read.html?book=library/books/<分类>/<书名>.br
//       → 从 R2 桶直接返回预生成静态 HTML 快照 snapshot/<分类>/<书名>.html
//   2) 其余请求（普通用户 / 非阅读页）→ 回源到 Cloudflare Pages 前端
//
// 绑定（见 wrangler.toml）：
//   env.BOOK_SNAPSHOT : R2Bucket  —— 存放 snapshot/<分类>/<书名>.html
//   env.PAGES_ORIGIN  : string    —— 你的 Pages 地址，如 https://gudian-book.pages.dev
//
// 说明：本文件代码为按方案逻辑全新编写（原方案文档仅描述意图、未提供代码）。
//       生效前提是：R2 桶已建 + snapshot/*.html 已上传（见 upload-snapshots.sh）。
// ============================================================

// 常见搜索引擎爬虫 UA 特征
const CRAWLER_UA = /(bot|spider|crawl|slurp|mediapartners|baidu|googlebot|bingbot|yandex|sogou|bytespider|applebot|facebookexternalhit|twitterbot|rogerbot|linkedinbot|embedly)/i;

function isCrawler(ua) {
    return !!ua && CRAWLER_UA.test(ua);
}

// 列表页快照：爬虫访问站点根（/ 或 /index.html）时返回 snapshot/index.html
function isListingPath(url) {
    const p = url.pathname.replace(/\/+$/, "");
    return p === "" || p === "/index.html";
}

// 从 read.html?book=library/books/<分类>/<书名>.br 推导 R2 快照 key
// 对应快照文件命名：snapshot/<分类>/<书名>.html
function bookSnapshotKeyFromRequest(url) {
    const path = url.pathname.replace(/\/+$/, "");
    if (path !== "/read.html") return null;
    const book = url.searchParams.get("book");
    if (!book) return null;
    const m = book.match(/library\/books\/(.+)\.br$/i);
    if (!m) return null;
    return "snapshot/" + m[1] + ".html";
}

// 综合判断爬虫应返回的 R2 快照 key；非爬虫页面返回 null
function snapshotKeyForCrawler(url) {
    if (isListingPath(url)) return "snapshot/index.html";
    return bookSnapshotKeyFromRequest(url);
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const ua = request.headers.get("User-Agent") || "";

        // —— 爬虫 + 命中快照：直接吐 R2 静态 HTML ——
        if (isCrawler(ua)) {
            const key = snapshotKeyForCrawler(url);
            if (key) {
                try {
                    const obj = await env.BOOK_SNAPSHOT.get(key);
                    if (obj && obj.body) {
                        return new Response(obj.body, {
                            status: 200,
                            headers: {
                                "Content-Type": "text/html; charset=utf-8",
                                "Cache-Control": "public, max-age=3600",
                                "X-Served-By": "worker-snapshot"
                            }
                        });
                    }
                } catch (e) {
                    // R2 读取异常，落到下面的回源逻辑，不影响用户体验
                    console.error("snapshot get failed:", key, e);
                }
            }
        }

        // —— 普通用户 / 列表页等：回源到 Pages 前端 ——
        const origin = (env.PAGES_ORIGIN || "").replace(/^https?:\/\//, "").replace(/\/+$/, "");
        if (!origin) {
            // 未配置回源地址时，直接透传（仅在 Worker 与 Pages 同链路时可用）
            return fetch(request);
        }
        const target = new URL(request.url);
        target.hostname = origin;
        target.protocol = "https:";
        return fetch(new Request(target.toString(), request));
    }
};
