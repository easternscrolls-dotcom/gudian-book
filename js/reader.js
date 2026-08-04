// ============================================================
// 古籍公版书库 - 浏览器端 Brotli 解压与书单加载
// 核心：使用浏览器原生 DecompressionStream('brotli') 流式解压 .br 文件
// （替代旧方案的 brotli-wasm CDN，无外部依赖、现代浏览器 2020+ 均支持）
// ============================================================

// ===================== 配置区 =====================
// 章节 .br 文件的基础地址。
// 留空 "" 表示使用本站相对路径（即 library/books/... 下的文件）。
// 若后续把章节迁移到 Cloudflare R2 / Worker，可改为：
//   const BOOK_BASE_URL = "https://your-r2-domain.com/book/";
const BOOK_BASE_URL = "";

// ===================== 能力检测 =====================
// 浏览器是否支持原生 DecompressionStream('brotli')。
// 注意：仅判断 typeof 不够 —— 部分浏览器有 DecompressionStream 但不支持 'brotli'
// 格式，构造时会抛 "Unsupported compression format: 'brotli'"，必须真实试构造。
let _nativeBrotliCache = null;
function nativeBrotliSupported() {
    if (_nativeBrotliCache !== null) return _nativeBrotliCache;
    try {
        new DecompressionStream("brotli");
        _nativeBrotliCache = true;
    } catch (e) {
        _nativeBrotliCache = false;
    }
    return _nativeBrotliCache;
}

// ===================== WASM 兜底解码器（brotli-dec-wasm，本地 vendor） =====================
// 当浏览器不支持原生 brotli 解压时，懒加载本地 vendor 的 WASM 解码器，
// 让老旧浏览器（旧 Firefox / 部分 WebView 等）也能正常阅读，而不是直接报错。
let _wasmBrotli = null;
let _wasmLoading = null;
async function getWasmBrotli() {
    if (_wasmBrotli) return _wasmBrotli;
    if (!_wasmLoading) {
        // index.js 默认导出是 init() 返回的 module（命名空间，含 decompress）
        _wasmLoading = import("/vendor/brotli-dec-wasm/index.js").then((m) => m.default);
    }
    _wasmBrotli = await _wasmLoading; // m.default 是 promise，await 得到命名空间 module
    return _wasmBrotli;
}

// ===================== 核心函数：解压响应流 =====================
// 优先使用浏览器原生 DecompressionStream('brotli') 流式解压（内存友好）；
// 若浏览器不支持 brotli 格式，自动回退到本地 WASM 解码器，保证可用。
async function decompressBrotliResponse(resp) {
    if (nativeBrotliSupported()) {
        try {
            let stream;
            if (resp.body && typeof resp.body.pipeThrough === "function") {
                // 推荐路径：直接对流做流式解压，内存占用小
                stream = resp.body.pipeThrough(new DecompressionStream("brotli"));
            } else {
                // 兜底：个别环境 resp.body 不可用，先取 arrayBuffer 再走流
                const buf = await resp.arrayBuffer();
                stream = new Response(buf).body.pipeThrough(new DecompressionStream("brotli"));
            }
            return await new Response(stream).text();
        } catch (e) {
            console.warn("原生 brotli 解压失败，回退 WASM 解码器：", e);
            // 落到下面的 WASM 兜底
        }
    }
    const brotli = await getWasmBrotli();
    const bytes = new Uint8Array(await resp.arrayBuffer());
    const out = brotli.decompress(bytes);
    return new TextDecoder("utf-8").decode(out);
}

// ===================== 加载书单 =====================
// 优先加载 books.br（Brotli 压缩书单），失败自动降级 books.json
async function loadBookCatalog() {
    try {
        const resp = await fetch("/books.br");
        if (!resp.ok) throw new Error("books.br 不存在（HTTP " + resp.status + "）");
        const text = await decompressBrotliResponse(resp);
        return JSON.parse(text);
    } catch (err) {
        console.warn("books.br 加载失败，降级使用 books.json：", err);
        const resp = await fetch("/books.json");
        if (!resp.ok) throw new Error("books.json 也不存在（HTTP " + resp.status + "）");
        return await resp.json();
    }
}

// ===================== 加载并解压单个章节 =====================
// filePath 为书单里的 file 字段，例如 "library/books/乐经/乐书.br"
// 返回解压后的纯文本；失败时抛错由调用方捕获展示
async function loadChapter(filePath) {
    const clean = String(filePath).replace(/^\/+/, "");      // 去掉开头多余的斜杠
    const url = (BOOK_BASE_URL || "") + "/" + clean;
    const resp = await fetch(encodeURI(url));
    if (!resp.ok) {
        throw new Error("章节文件获取失败（HTTP " + resp.status + "）");
    }
    return await decompressBrotliResponse(resp);
}

// ===================== 章节识别与目录渲染 =====================
// 把整本书纯文本解析为带章节锚点的 HTML，并在容器上方生成可点击目录。
// 支持：第X章 / 第X回 / 第X卷 / 卷X / 序 / 前言 / 引言 / 楔子
const CHAPTER_RE = /^(第[一二三四五六七八九十百千万〇0-9\s]+章|第[一二三四五六七八九十百千万〇0-9\s]+回|第[一二三四五六七八九十百千万〇0-9\s]+卷|卷[一二三四五六七八九十百千万〇0-9\s]+|序[言]?|前言|引言|楔子)([　 \t]|$)/;

function escapeHtml(str) {
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function cleanTitle(str) {
    return str.replace(/\s+/g, " ").trim();
}

function renderBookText(container, text) {
    const lines = text.split(/\r?\n/);
    const chapterIds = new Array(lines.length).fill(null);   // 每行若识别为章节标题，记录 id
    const bodyIdByTitle = new Map();                          // 正文区标题 -> 首个 id
    const toc = [];                                           // 正文区目录项

    let inBody = false;

    // 第一遍：识别章节、判断是否进入正文、分配 id
    // 所有章节标题都进入目录；同时记录每个标题在正文区首次出现的 id，
    // 用于让目录区的同名标题也能点击跳转到正文。
    lines.forEach((raw, idx) => {
        const line = raw.trim();
        if (!line) return;
        const isChapter = CHAPTER_RE.test(line);
        if (isChapter) {
            const id = "ch-" + idx;
            chapterIds[idx] = id;
            const key = cleanTitle(line);
            if (inBody && !bodyIdByTitle.has(key)) bodyIdByTitle.set(key, id);
            toc.push({ id, title: line });
        } else if (!inBody && line.length >= 50) {
            // 出现长段落，认为已离开目录区进入正文
            inBody = true;
        }
    });

    // 兜底：若整本书都没识别到正文区章节（目录即正文、或文件很短），
    // 直接用每个标题自身作为正文锚点。
    if (bodyIdByTitle.size === 0) {
        lines.forEach((raw, idx) => {
            const line = raw.trim();
            if (!line || !chapterIds[idx]) return;
            const key = cleanTitle(line);
            if (!bodyIdByTitle.has(key)) bodyIdByTitle.set(key, chapterIds[idx]);
        });
    }

    // 去重生成目录：同名标题只保留指向正文区的那一项（无正文区则保留自身）
    const tocSeen = new Set();
    const uniqueToc = [];
    toc.forEach(item => {
        const key = cleanTitle(item.title);
        const targetId = bodyIdByTitle.get(key) || item.id;
        if (!tocSeen.has(targetId)) {
            tocSeen.add(targetId);
            uniqueToc.push({ id: targetId, title: item.title });
        }
    });

    // 第二遍：生成正文 HTML
    let bodyHtml = "";
    lines.forEach((raw, idx) => {
        const line = raw.trim();
        if (!line) {
            bodyHtml += "<br>\n";
            return;
        }
        if (chapterIds[idx]) {
            const id = chapterIds[idx];
            const key = cleanTitle(line);
            const bodyId = bodyIdByTitle.get(key);
            // 目录区的同名章节标题做成链接，点击跳转到正文对应位置
            if (bodyId && bodyId !== id) {
                bodyHtml += '<h3 id="' + id + '" class="chapter-title toc-link"><a href="#' + bodyId + '" class="chapter-anchor">' + escapeHtml(line) + "</a></h3>\n";
            } else {
                bodyHtml += '<h3 id="' + id + '" class="chapter-title">' + escapeHtml(line) + "</h3>\n";
            }
        } else {
            bodyHtml += '<p class="para">' + escapeHtml(line) + "</p>\n";
        }
    });

    // 创建/复用目录面板，插入到正文容器之前
    let tocPanel = document.getElementById("toc-panel");
    if (!tocPanel) {
        tocPanel = document.createElement("nav");
        tocPanel.id = "toc-panel";
        container.parentNode.insertBefore(tocPanel, container);
    }

    if (uniqueToc.length) {
        tocPanel.innerHTML =
            '<button id="toc-toggle" type="button" aria-expanded="false">目录</button>' +
            '<div id="toc-list" class="hidden"><ul>' +
            uniqueToc.map(t => '<li><a href="#' + t.id + '">' + escapeHtml(t.title) + "</a></li>").join("") +
            "</ul></div>";
        tocPanel.classList.remove("hidden");

        const toggle = tocPanel.querySelector("#toc-toggle");
        const list = tocPanel.querySelector("#toc-list");
        if (toggle && list) {
            toggle.addEventListener("click", () => {
                const nowHidden = list.classList.toggle("hidden");
                toggle.setAttribute("aria-expanded", String(!nowHidden));
            });
        }
    } else {
        tocPanel.classList.add("hidden");
    }

    container.innerHTML = '<div id="book-body">' + bodyHtml + "</div>";
    container.classList.add("rendered");
}
