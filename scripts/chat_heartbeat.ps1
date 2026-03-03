param(
  [string]$ChatPath = "chat/chat.md",
  [int]$IntervalSec = 60
)

if (-not (Test-Path $ChatPath)) {
  Write-Host "FAIL: chat file not found -> $ChatPath"
  exit 1
}

$lastHash = ""
Write-Host "Heartbeat watcher started. interval=${IntervalSec}s file=$ChatPath"

while ($true) {
  try {
    $hash = (Get-FileHash -Algorithm SHA256 -Path $ChatPath).Hash
    $ts = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")

    if ($lastHash -eq "") {
      Write-Host "[$ts] Kontrol ettim: sira bende, ilerliyorum. (ilk okuma)"
    } elseif ($hash -ne $lastHash) {
      Write-Host "[$ts] Kontrol ettim: sira bende, ilerliyorum. (chat guncel)"
    } else {
      Write-Host "[$ts] Kontrol ettim: bekliyorum."
    }

    $lastHash = $hash
  } catch {
    $ts = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
    Write-Host "[$ts] FAIL: chat kontrol hatasi -> $($_.Exception.Message)"
  }

  Start-Sleep -Seconds $IntervalSec
}
