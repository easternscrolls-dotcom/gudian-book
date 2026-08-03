# 监控 R2 快照上传，传满后自动出核对报告（修正版）。
# 修正：CountDone 读取时若遇并发写锁则重试，避免误读为 0；
#       以"上传进程是否退出"为主判据，退出即跑 verify 生成报告。
#       若退出但还没传满，自动断点续传重启（仅传缺失项，去重已修复）。

$ROOT = "E:\gudian-book-front\gudian-book"
$DONE = Join-Path $ROOT "snapshot-uploaded-public.txt"
$TOTAL = 9713
$NODE = "C:\Users\Administrator\.workbuddy\binaries\node\versions\22.22.2\node.exe"
$LOG = Join-Path $ROOT "monitor-upload.log"

function IsUploadRunning {
    $p = Get-CimInstance Win32_Process -Filter "name='node.exe'" | Where-Object { $_.CommandLine -like '*upload-snapshots*' }
    return ($null -ne $p)
}
function CountDone {
    for ($t = 0; $t -lt 6; $t++) {
        try {
            if (Test-Path $DONE) {
                return (Get-Content $DONE -ErrorAction Stop | Where-Object { $_.Trim() -ne '' } | Measure-Object -Line).Lines
            }
            return 0
        } catch { Start-Sleep -Milliseconds 400 }
    }
    return -1
}
function StartUpload {
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $NODE
    $psi.Arguments = "scripts/upload-snapshots.js --bucket gudian-book --concurrency 12 --done-file snapshot-uploaded-public.txt --progress-file snapshot-upload-progress-public.txt"
    $psi.WorkingDirectory = $ROOT
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    [System.Diagnostics.Process]::Start($psi) | Out-Null
}
function RunVerify {
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Add-Content $LOG ("[$ts] running verification")
    Set-Location $ROOT
    $out = & $NODE scripts/verify-upload.js --bucket gudian-book --done-file snapshot-uploaded-public.txt --total $TOTAL 2>&1
    $out | Add-Content $LOG
    $miss = -1
    foreach ($l in $out) { if ($l -match 'missing=(\d+)') { $miss = [int]$Matches[1] } }
    return $miss
}

Set-Content $LOG ("[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] monitor restarted (robust version)")

$maxPolls = 120
$lastProgress = -1
for ($i = 0; $i -lt $maxPolls; $i++) {
    $running = IsUploadRunning
    $done = CountDone
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Add-Content $LOG ("[$ts] poll#$i done=$done running=$running")
    if (-not $running) {
        Start-Sleep -Seconds 20
        if (-not (IsUploadRunning)) {
            $done = CountDone
            if ($done -ge $TOTAL) {
                RunVerify
                Add-Content $LOG ("[$ts] DONE (done=$done), report generated")
                break
            }
            if ($done -le $lastProgress) {
                RunVerify
                Add-Content $LOG ("[$ts] no progress (done=$done <= $lastProgress), report generated, stop")
                break
            }
            $lastProgress = $done
            Add-Content $LOG ("[$ts] not running, done=$done < total, restarting resume upload")
            StartUpload
            Start-Sleep -Seconds 8
        }
    }
    Start-Sleep -Seconds 30
}
$ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
Add-Content $LOG ("[$ts] monitor finished")
