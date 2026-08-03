#!/usr/bin/env bash
# ============================================================
# 批量上传 snapshot/*.html 到 R2 桶（供 Worker 爬虫分流使用）
# 用法：
#   1) 安装并登录 wrangler：  npm i -g wrangler && wrangler login
#   2) 确认桶已建：          wrangler r2 bucket create gudian-book-snapshots
#   3) 修改下方 BUCKET 为本项目桶名，然后运行本脚本
#
# 注意：
#   - 9712 个文件逐个上传，耗时较长，建议在后台运行
#   - 文件名含中文，wrangler 会按 UTF-8 key 写入，Worker 端用相同 key 读取
#   - 如需断点续传，可改用 rclone / aws s3 cli（endpoint 用 R2 的 S3 兼容地址）
# ============================================================
set -euo pipefail

BUCKET="gudian-book-snapshots"
SNAPSHOT_DIR="../snapshot"   # 相对本脚本所在 worker/ 目录

count=0
fail=0
while IFS= read -r -d '' f; do
    # 相对 snapshot/ 的路径，作为 R2 key（如 snapshot/文总集/全卷本.html）
    rel="${f#"$SNAPSHOT_DIR"/}"
    key="snapshot/$rel"
    if wrangler r2 object put "$BUCKET/$key" --file "$f" --remote >/dev/null 2>&1; then
        count=$((count+1))
        if (( count % 200 == 0 )); then
            echo "已上传 $count 个..."
        fi
    else
        fail=$((fail+1))
        echo "失败: $key" >&2
    fi
done < <(find "$SNAPSHOT_DIR" -type f -name '*.html' -print0)

echo "完成：成功 $count，失败 $fail"
