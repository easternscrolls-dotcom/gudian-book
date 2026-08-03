// Pages Function —— 阅读页 read.html 爬虫快照分流
// 爬虫 UA -> 解析 ?book=library/books/<分类>/<书名>.br，返回 R2 公开桶里 snapshot/<分类>/<书名>.html 静态快照
// 普通用户 -> 回源 Pages 静态 read.html（原生 Brotli 解压）
//
// 注意：functions/read.js 会匹配 /read.html（含 ?book= 查询参数）；
//       Pages Functions 优先级高于同路径静态文件，故人类用户在此函数内通过 env.ASSETS 回源。

const CRAWLER_UA = /(bot|spider|crawl|slurp|mediapartners|baidu|googlebot|bingbot|yandex|sogou|bytespider|applebot|facebookexternalhit|twitterbot|rogerbot|linkedinbot|embedly)/i;
const R2_PUBLIC = "https://pub-1d531c028860403c89525486b52a27c2.r2.dev";

export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);
    const ua = request.headers.get("User-Agent") || "";

    if (CRAWLER_UA.test(ua)) {
        const book = url.searchParams.get("book");
        if (book) {
            const m = book.match(/library\/books\/(.+)\.br$/i);
            if (m) {
                const key = "snapshot/" + m[1] + ".html";
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
                    // 取不到快照则回退静态页
                }
            }
        }
    }
    return env.ASSETS.fetch(request);
}
