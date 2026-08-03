// 核对 R2 快照上传结果：对比本地 snapshot 树 与 已上传记录(done 文件)，
// 输出 upload-report.md（覆盖率、分类明细、r2.dev 抽样直连验证）。
//
// 用法：
//   node scripts/verify-upload.js --bucket gudian-book --done-file snapshot-uploaded-public.txt --total 9713

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
function arg(name, def) {
    const i = args.indexOf(name);
    return i !== -1 && args[i + 1] ? args[i + 1] : def;
}
const BUCKET = arg("--bucket", "gudian-book");
const DONE_FILE = path.join(ROOT, arg("--done-file", "snapshot-uploaded-public.txt"));
const TOTAL_EXPECTED = parseInt(arg("--total", "9713"), 10);
const SNAP_DIR = path.join(ROOT, "snapshot");
const PUBLIC_BASE = "https://pub-1d531c028860403c89525486b52a27c2.r2.dev";
const REPORT = path.join(ROOT, "upload-report.md");

function listHtml(dir) {
    const out = [];
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) out.push(...listHtml(p));
        else if (e.name.toLowerCase().endsWith(".html")) out.push(p);
    }
    return out;
}

// 本地相对路径集合
const all = listHtml(SNAP_DIR);
const localRel = new Set(all.map(f => path.relative(SNAP_DIR, f).split(path.sep).join("/")));

// 已上传记录 -> 相对路径（去掉 BUCKET/snapshot/ 前缀；兼容只含 snapshot/ 的情况）
const uploaded = new Set();
if (fs.existsSync(DONE_FILE)) {
    for (const line of fs.readFileSync(DONE_FILE, "utf-8").split("\n")) {
        const k = line.trim();
        if (!k) continue;
        const prefix = BUCKET + "/snapshot/";
        if (k.startsWith(prefix)) uploaded.add(k.slice(prefix.length));
        else if (k.startsWith("snapshot/")) uploaded.add(k.slice("snapshot/".length));
    }
}

const missing = [];
const extra = [];
for (const r of localRel) if (!uploaded.has(r)) missing.push(r);
for (const u of uploaded) if (!localRel.has(u)) extra.push(u);

// 分类统计
const catStats = {};
for (const r of localRel) {
    const cat = r.includes("/") ? r.split("/")[0] : "(root)";
    catStats[cat] = catStats[cat] || { total: 0, up: 0 };
    catStats[cat].total++;
    if (uploaded.has(r)) catStats[cat].up++;
}
for (const u of uploaded) {
    if (!localRel.has(u)) {
        const cat = u.includes("/") ? u.split("/")[0] : "(root)";
        catStats[cat] = catStats[cat] || { total: 0, up: 0 };
        catStats[cat].up++;
    }
}

// 抽样直连 r2.dev 验证
const upArr = [...uploaded];
const samples = [];
if (upArr.length) {
    for (let i = 0; i < 5; i++) samples.push(upArr[Math.floor(Math.random() * upArr.length)]);
}
async function checkOne(rel) {
    const url = PUBLIC_BASE + "/snapshot/" + encodeURI(rel);
    try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 15000);
        const r = await fetch(url, { signal: ctrl.signal });
        clearTimeout(t);
        return { rel, status: r.status, ok: r.ok, len: (r.headers.get("content-length") || "?") };
    } catch (e) {
        return { rel, status: "ERR", ok: false, err: String(e).slice(0, 120) };
    }
}

(async () => {
    const results = await Promise.all(samples.map(checkOne));
    const ts = new Date().toISOString();
    const coverage = (uploaded.size / TOTAL_EXPECTED * 100).toFixed(2);
    let md = `# 快照上传核对报告\n\n`;
    md += `- 生成时间: ${ts}\n`;
    md += `- 桶: \`${BUCKET}\` (公开 r2.dev)\n`;
    md += `- 本地快照总数: ${all.length}\n`;
    md += `- 已成功上传(去重): ${uploaded.size}\n`;
    md += `- 覆盖率: ${coverage}% (${uploaded.size}/${TOTAL_EXPECTED})\n`;
    md += `- 缺失(本地有但未传): ${missing.length}\n`;
    md += `- 多余(传了但本地无): ${extra.length}\n\n`;
    md += `## 分类明细\n\n`;
    md += `| 分类 | 已传/本地 | 覆盖率 |\n|---|---|---|\n`;
    for (const cat of Object.keys(catStats).sort()) {
        const s = catStats[cat];
        const c = (s.up / s.total * 100).toFixed(1);
        md += `| ${cat} | ${s.up}/${s.total} | ${c}% |\n`;
    }
    md += `\n## 抽样验证 (r2.dev 直连)\n\n`;
    md += `| 对象 | HTTP | 长度 |\n|---|---|---|\n`;
    for (const r of results) {
        md += `| ${r.rel} | ${r.status}${r.err ? " (" + r.err + ")" : ""} | ${r.ok ? r.len : "-"} |\n`;
    }
    md += `\n## 结论\n\n`;
    if (missing.length === 0) {
        md += `✅ 全部 ${TOTAL_EXPECTED} 本快照均已成功上传，爬虫分流可对全库生效。\n`;
    } else {
        md += `⚠️ 仍有 ${missing.length} 本未上传，爬虫分流对这部分书目暂不可用。建议重跑上传脚本补齐（脚本已修复去重，仅传缺失项）。\n`;
        md += `\n缺失样例:\n` + missing.slice(0, 20).map(m => `- ${m}`).join("\n") + "\n";
    }
    fs.writeFileSync(REPORT, md);
    console.log(`REPORT_WRITTEN ${REPORT}`);
    console.log(`uploaded=${uploaded.size} missing=${missing.length} extra=${extra.length} coverage=${coverage}%`);
    if (missing.length > 0) console.log("sample missing: " + missing.slice(0, 5).join(" | "));
})();
