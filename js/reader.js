// 加载Brotli解压库
let brotliInstance = null;
async function initBrotli() {
    if (!brotliInstance) {
        brotliInstance = await BrotliWasm;
    }
    return brotliInstance;
}

/**
 * 加载R2中br章节文件
 * @param {string} filePath 路径格式 book/001/chapter1.br
 */
async function loadChapter(filePath) {
    try {
        const res = await fetch(`/${filePath}`);
        if (!res.ok) {
            throw new Error("章节不存在");
        }
        const arrayBuf = await res.arrayBuffer();
        const brotli = await initBrotli();
        const decompressed = brotli.decompress(new Uint8Array(arrayBuf));
        const text = new TextDecoder("utf-8").decode(decompressed);
        return text;
    } catch (err) {
        console.error(err);
        return null;
    }
}