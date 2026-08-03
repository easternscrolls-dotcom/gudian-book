// Pages Function —— catch-all 爬虫静态快照分流
// 匹配全站所有路径；仅在请求 UA 命中搜索引擎爬虫时才介入：
//   /read.html?book=library/books/<分类>/<书名>.br  -> 返回 R2 公开桶 snapshot/<分类>/<书名>.html
//   / 或 /index.html                                -> 返回 R2 公开桶 snapshot/index.html（全部分类+书目链接）
// 其余（含普通用户）一律回源 Pages 静态资源（env.ASSETS）。
//
// 运行前提：
//   - 项目根 functions/ 目录存在即自动启用 Pages Functions
//   - R2 桶 gudian-book 已开启公开访问（pub-1d531c028860403c89525486b52a27c2.r2.dev）
//   - 快照已通过 scripts/upload-snapshots.js --bucket gudian-book 上传

const CRAWLER_UA = /(bot|spider|crawl|slurp|mediapartners|baidu|googlebot|bingbot|yandex|sogou|bytespider|applebot|facebookexternalhit|twitterbot|rogerbot|linkedinbot|embedly)/i;
const R2_PUBLIC = "https://pub-1d531c028860403c89525486b52a27c2.r2.dev";

export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);
    const ua = request.headers.get("User-Agent") || "";
    const path = url.pathname;

    if (CRAWLER_UA.test(ua)) {
        let key = null;
        if (path === "/read.html") {
            const book = url.searchParams.get("book");
            if (book) {
                const m = book.match(/library\/books\/(.+)\.br$/i);
                if (m) key = "snapshot/" + m[1] + ".html";
            }
        } else if (path === "/" || path === "/index.html" || path === "") {
            key = "snapshot/index.html";
        }

        if (key) {
            try {
                const resp = await fetch(R2_PUBLIC + "/" + key);
                if (resp.ok) {
                    return new Response(resp.body, {
                        status: 200,
                        headers: {
                            "Content-Type": "text/html; charset=utf-8",
                            "Cache-Control": "public, max-age=3600",
                            "X-Served-By": "pages-fn-snapshot"
                        }
                    });
                }
            } catch (e) {
                // 快照取不到则回退到正常页面，不影响人类用户
            }
        }
    }

    return env.ASSETS.fetch(request);
}
