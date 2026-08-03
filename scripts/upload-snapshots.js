// 并发上传 snapshot/**/*.html 到 Cloudflare R2 桶
// 利用 CLOUDFLARE_API_TOKEN 环境变量（与 `wrangler deploy` 同一套鉴权）。
//
// 特性：
//   - 进度写入 snapshot-upload-progress.txt（done/ok/fail + 时间戳）
//   - 断点续传：snapshot-uploaded.txt 记录已成功 key，重启时跳过
//   - 失败重试一次，最终失败写入 snapshot-upload-failures.txt
//
// 用法：
//   node scripts/upload-snapshots.js
//   node scripts/upload-snapshots.js --bucket gudian-book-snapshots --dir snapshot --concurrency 12

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
const CONCURRENCY = parseInt(arg("--concurrency", "12"), 10);
const LIMIT = parseInt(arg("--limit", "0"), 10); // 0 = 不限制，便于测试

const WRANGLER_JS = "C:/Users/Administrator/.workbuddy/binaries/node/workspace/node_modules/wrangler/bin/wrangler.js";
const NODE = "C:/Users/Administrator/.workbuddy/binaries/node/versions/22.22.2/node.exe";

const PROGRESS_FILE = path.join(ROOT, arg("--progress-file", "snapshot-upload-progress.txt"));
const DONE_FILE = path.join(ROOT, arg("--done-file", "snapshot-uploaded.txt"));
const FAIL_FILE = path.join(ROOT, "snapshot-upload-failures.txt");

function listHtml(dir) {
    const out = [];
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) out.push(...listHtml(p));
        else if (e.name.toLowerCase().endsWith(".html")) out.push(p);
    }
    return out;
}

function loadSet(file) {
    if (!fs.existsSync(file)) return new Set();
    return new Set(fs.readFileSync(file, "utf-8").split("\n").map(s => s.trim()).filter(Boolean));
}

function writeProgress(done, total, ok, fail) {
    fs.writeFileSync(PROGRESS_FILE,
        `[${new Date().toISOString()}] done=${done}/${total} ok=${ok} fail=${fail}\n`);
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
            resolve({ key, rel, ok: code === 0, err: code === 0 ? "" : err.slice(0, 200) });
        });
    });
}

(async () => {
    if (!fs.existsSync(SNAP_DIR)) {
        console.error("快照目录不存在:", SNAP_DIR);
        process.exit(1);
    }
    const all = listHtml(SNAP_DIR);
    const uploaded = loadSet(DONE_FILE);
    let files = all.filter(f => !uploaded.has("snapshot/" + path.relative(SNAP_DIR, f).split(path.sep).join("/")));
    if (LIMIT > 0 && files.length > LIMIT) files = files.slice(0, LIMIT);
    console.log(`[DEBUG] 文件遍历完成，符合条件的文件数=${files.length}`);
    console.log(`总文件 ${all.length}，已上传 ${uploaded.size}，本次待上传 ${files.length}（并发 ${CONCURRENCY}）`);
    if (files.length === 0) { console.log("全部已上传，无需重复。"); process.exit(0); }

    let done = 0, ok = 0, fail = 0;
    const failures = [];
    const doneKeys = [];
    let idx = 0;

    async function worker() {
        while (idx < files.length) {
            const i = idx++;
            const r = await uploadOne(files[i]);
            done++;
            if (r.ok) { ok++; doneKeys.push(r.key); }
            else { fail++; failures.push(r); }
            if (done % 10 === 0 || done === 1 || done === files.length) {
                writeProgress(done, files.length, ok, fail);
                if (doneKeys.length >= 200) {
                    fs.appendFileSync(DONE_FILE, doneKeys.join("\n") + "\n");
                    doneKeys.length = 0;
                }
                console.log(`进度 ${done}/${files.length}  成功 ${ok}  失败 ${fail}`);
            }
        }
    }

    const pool = Array.from({ length: CONCURRENCY }, () => worker());
    await Promise.all(pool);
    if (doneKeys.length) fs.appendFileSync(DONE_FILE, doneKeys.join("\n") + "\n");

    if (failures.length) {
        console.log(`\n失败 ${failures.length} 个，重试一次……`);
        const retry = [];
        for (const f of failures) {
            const r = await uploadOne(path.join(SNAP_DIR, f.rel));
            if (r.ok) { ok++; fs.appendFileSync(DONE_FILE, r.key + "\n"); }
            else retry.push(f.rel);
        }
        console.log(`重试后剩余失败 ${retry.length} 个`);
        if (retry.length) {
            fs.writeFileSync(FAIL_FILE, retry.join("\n") + "\n");
            console.log("失败清单已写入", path.basename(FAIL_FILE));
        }
    }
    writeProgress(files.length, files.length, ok, fail);
    console.log(`\n完成：本次成功 ${ok}，失败 ${fail - (ok - (files.length - fail))}（总已上传 ${loadSet(DONE_FILE).size}/${all.length}）`);
})();
