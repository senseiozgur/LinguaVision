param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("Cevher", "Olgun")]
  [string]$AgentName,
  [string]$ChatPath = "chat/chat.md",
  [int]$IntervalSec = 60,
  [int]$StaleSec = 180,
  [switch]$AutoWaitStatus,
  [bool]$EnableAutoWaiting = $false,
  [int]$WaitNotifySec = 180,
  [int]$WaitCooldownSec = 900,
  [switch]$AutoLive,
  [int]$LiveEverySec = 120,
  [string]$Task = "sync",
  [string]$Lock = "none",
  [string]$Next = "check-chat"
)

if (-not (Test-Path $ChatPath)) {
  Write-Host "FAIL: chat file not found -> $ChatPath"
  exit 1
}

$otherAgent = if ($AgentName -eq "Cevher") { "Olgun" } else { "Cevher" }
$coordDir = ".coord/heartbeats"
$selfHeartbeat = Join-Path $coordDir "$AgentName.json"
$otherHeartbeat = Join-Path $coordDir "$otherAgent.json"

New-Item -ItemType Directory -Force -Path $coordDir | Out-Null

$lastHash = ""
$lastLineCount = 0
$lastLiveAt = (Get-Date).AddSeconds(-1 * $LiveEverySec)
$lastStaleAlertAt = Get-Date
$lastTurnAt = Get-Date
$lastWaitNoteAt = (Get-Date).AddSeconds(-1 * $WaitNotifySec)

Write-Host "Heartbeat bridge started: agent=$AgentName other=$otherAgent interval=${IntervalSec}s stale=${StaleSec}s"
Write-Host "Usage: keep this terminal open. AutoWaitStatus=$AutoWaitStatus WaitNotifySec=$WaitNotifySec AutoLive=$AutoLive"
if ($AutoWaitStatus -and -not $EnableAutoWaiting) {
  Write-Host "INFO: AutoWaitStatus requested but blocked by policy (EnableAutoWaiting=false)."
}

function Write-LiveLine([string]$message) {
  $ts = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
  Add-Content -Path $ChatPath -Value "- [$AgentName] $message | TS=$ts"
}

function Has-RecentToken([string[]]$lines, [string]$token, [int]$tail = 60) {
  if (-not $lines -or $lines.Count -eq 0) { return $false }
  $start = [Math]::Max(0, $lines.Count - $tail)
  for ($i = $start; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match $token) { return $true }
  }
  return $false
}

while ($true) {
  try {
    $ts = Get-Date
    $hash = (Get-FileHash -Algorithm SHA256 -Path $ChatPath).Hash
    $lines = Get-Content -Path $ChatPath
    $lineCount = $lines.Count

    $payload = @{
      agent = $AgentName
      ts_utc = $ts.ToUniversalTime().ToString("o")
      chat_hash = $hash
      line_count = $lineCount
      pid = $PID
    } | ConvertTo-Json -Compress
    Set-Content -Path $selfHeartbeat -Value $payload

    if ($lastHash -eq "") {
      Write-Host "[$($ts.ToString('yyyy-MM-dd HH:mm:ss'))] Kontrol: basladi (ilk okuma)."
    } elseif ($hash -ne $lastHash) {
      $newLines = $lines[$lastLineCount..($lineCount - 1)] -join "`n"
      if ($newLines -match "ACTION REQUEST" -or $newLines -match "\[$AgentName\]") {
        $lastTurnAt = Get-Date
        Write-Host "[$($ts.ToString('yyyy-MM-dd HH:mm:ss'))] AKSIYON: chat guncel, sana ilgili satir var."
      } else {
        Write-Host "[$($ts.ToString('yyyy-MM-dd HH:mm:ss'))] Kontrol: chat guncel."
      }
    } else {
      Write-Host "[$($ts.ToString('yyyy-MM-dd HH:mm:ss'))] Kontrol: degisiklik yok."
    }

    if (Test-Path $otherHeartbeat) {
      $other = Get-Content -Raw $otherHeartbeat | ConvertFrom-Json
      $otherTs = [DateTimeOffset]::Parse($other.ts_utc).ToLocalTime()
      $ageSec = [math]::Round(((Get-Date) - $otherTs.DateTime).TotalSeconds)
      if ($ageSec -gt $StaleSec) {
        Write-Host "[$($ts.ToString('yyyy-MM-dd HH:mm:ss'))] ALERT: $otherAgent heartbeat stale (${ageSec}s). STATUS REQUEST yaz."
        if ($AutoLive -and ((Get-Date) - $lastStaleAlertAt).TotalSeconds -ge $LiveEverySec) {
          Write-LiveLine "ALERT: peer-stale=$otherAgent age=${ageSec}s (STATUS REQUEST)"
          $lastStaleAlertAt = Get-Date
        }
      } else {
        Write-Host "[$($ts.ToString('yyyy-MM-dd HH:mm:ss'))] Peer OK: $otherAgent aktif (${ageSec}s)."
      }
    } else {
      Write-Host "[$($ts.ToString('yyyy-MM-dd HH:mm:ss'))] Peer WAIT: $otherAgent heartbeat dosyasi yok."
    }

    $effectiveAutoWait = $AutoWaitStatus -and $EnableAutoWaiting
    if ($effectiveAutoWait) {
      $waitSec = [math]::Round(((Get-Date) - $lastTurnAt).TotalSeconds)
      $recentSelfClaim = Has-RecentToken -lines $lines -token "SELF-CLAIM:" -tail 80
      $recentWaiting = Has-RecentToken -lines $lines -token "WAITING:" -tail 80
      $cooldownOk = ((Get-Date) - $lastWaitNoteAt).TotalSeconds -ge $WaitCooldownSec
      if ($waitSec -ge $WaitNotifySec -and $cooldownOk -and -not $recentSelfClaim -and -not $recentWaiting) {
        Write-LiveLine "WAITING: sirami bekliyorum, onay bekliyorum | WAIT_SEC=$waitSec | BLOCKER=turn_not_assigned (throttled)"
        $lastWaitNoteAt = Get-Date
      }
    }

    $lastHash = $hash
    $lastLineCount = $lineCount

    if ($AutoLive -and ((Get-Date) - $lastLiveAt).TotalSeconds -ge $LiveEverySec) {
      Write-LiveLine "LIVE: $AgentName | TASK=$Task | LOCK=$Lock | ETA=${LiveEverySec}s | NEXT=$Next"
      $lastLiveAt = Get-Date
    }
  } catch {
    $ts = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
    Write-Host "[$ts] FAIL: heartbeat loop -> $($_.Exception.Message)"
  }

  Start-Sleep -Seconds $IntervalSec
}
