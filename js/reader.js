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
