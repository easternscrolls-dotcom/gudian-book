// 并发上传 snapshot/**/*.html 到 Cloudflare R2 桶
// 利用已登录的 wrangler 凭据（与 `wrangler deploy` 同一套鉴权），避免逐文件串行过慢。
//
// 用法：
//   node scripts/upload-snapshots.js
//   node scripts/upload-snapshots.js --bucket gudian-book-snapshots --dir snapshot --concurrency 8
//
// 依赖：本机已可运行 wrangler（即 `wrangler deploy` 能成功）。

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
function arg(name, def) {
    const i = args.indexOf(name);
    return i !== -1 && args[i + 1] ? args[i + 1] : def;
}

const BUCKET = arg("--bucket", "gudian-book-snapshots");
const SNAP_DIR = path.join(ROOT, arg("--dir", "snapshot"));
const CONCURRENCY = parseInt(arg("--concurrency", "8"), 10);

// wrangler 可执行入口（使用与 deploy 相同的本地安装）
const WRANGLER_JS = "C:/Users/Administrator/.workbuddy/binaries/node/workspace/node_modules/wrangler/bin/wrangler.js";
const NODE = "C:/Users/Administrator/.workbuddy/binaries/node/versions/22.22.2/node.exe";

function listHtml(dir) {
    const out = [];
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) out.push(...listHtml(p));
        else if (e.name.toLowerCase().endsWith(".html")) out.push(p);
    }
    return out;
}

function uploadOne(file) {
    const rel = path.relative(SNAP_DIR, file).split(path.sep).join("/");
    const key = BUCKET + "/snapshot/" + rel;
    return new Promise((resolve) => {
        const cp = spawn(NODE, [
            WRANGLER_JS, "r2", "object", "put", key, "--file", file,
            "--config", "worker/wrangler.toml", "--remote"
        ], { cwd: ROOT, stdio: ["ignore", "ignore", "pipe"] });
        let err = "";
        cp.stderr.on("data", (d) => (err += d));
        cp.on("close", (code) => {
            resolve({ file: rel, ok: code === 0, err: code === 0 ? "" : err.slice(0, 200) });
        });
    });
}

(async () => {
    if (!fs.existsSync(SNAP_DIR)) {
        console.error("快照目录不存在:", SNAP_DIR);
        process.exit(1);
    }
    const files = listHtml(SNAP_DIR);
    console.log(`待上传 ${files.length} 个 HTML 到桶 ${BUCKET}（并发 ${CONCURRENCY}）`);

    let done = 0, ok = 0, fail = 0;
    const failures = [];
    let idx = 0;

    async function worker() {
        while (idx < files.length) {
            const i = idx++;
            const r = await uploadOne(files[i]);
            done++;
            if (r.ok) ok++; else { fail++; failures.push(r); }
            if (done % 100 === 0 || done === files.length) {
                console.log(`进度 ${done}/${files.length}  成功 ${ok}  失败 ${fail}`);
            }
        }
    }

    const pool = Array.from({ length: CONCURRENCY }, () => worker());
    await Promise.all(pool);

    if (failures.length) {
        console.log(`\n失败 ${failures.length} 个，重试一次……`);
        const retry = [];
        for (const f of failures) {
            const r = await uploadOne(path.join(SNAP_DIR, f.file));
            if (r.ok) ok++; else retry.push(f.file);
        }
        console.log(`重试后剩余失败 ${retry.length} 个`);
        if (retry.length) {
            fs.writeFileSync(path.join(ROOT, "snapshot-upload-failures.txt"), retry.join("\n") + "\n");
            console.log("失败清单已写入 snapshot-upload-failures.txt");
        }
    }
    console.log(`\n全部完成：总 ${files.length}，成功 ${ok}，失败 ${fail - (ok - (files.length - fail))}`);
})();
