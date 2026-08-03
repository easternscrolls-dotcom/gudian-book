// Pages Function —— 首页 / 列表页 爬虫快照分流
// 爬虫 UA -> 返回 R2 公开桶里的 snapshot/index.html（全部分类+书目链接，利于 SEO 收录）
// 普通用户 -> 回源 Pages 静态 index.html（原生 Brotli 解压前端）
//
// 运行前提：
//   - 项目根 functions/ 目录存在即自动启用 Pages Functions
//   - R2 桶 gudian-book 已开启公开访问（pub-1d531c028860403c89525486b52a27c2.r2.dev）
//   - 快照已通过 scripts/upload-snapshots.js --bucket gudian-book 上传

const CRAWLER_UA = /(bot|spider|crawl|slurp|mediapartners|baidu|googlebot|bingbot|yandex|sogou|bytespider|applebot|facebookexternalhit|twitterbot|rogerbot|linkedinbot|embedly)/i;
const R2_PUBLIC = "https://pub-1d531c028860403c89525486b52a27c2.r2.dev";

export async function onRequest(context) {
    const { request, env } = context;
    const ua = request.headers.get("User-Agent") || "";

    if (CRAWLER_UA.test(ua)) {
        try {
            const resp = await fetch(R2_PUBLIC + "/snapshot/index.html");
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
            // 快照取不到就回退到正常首页，不影响人类用户
        }
    }
    return env.ASSETS.fetch(request);
}
