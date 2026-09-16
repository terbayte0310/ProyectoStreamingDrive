[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$PackageDirectory,

    [Parameter(Mandatory)]
    [double]$DurationSeconds,

    [int]$IntervalSeconds = 300
)

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Windows.Forms
$packageLabel = Split-Path -Leaf $PackageDirectory
$icon = [System.Windows.Forms.NotifyIcon]::new()
$icon.Icon = [System.Drawing.SystemIcons]::Information
$icon.Visible = $true

try {
    $videoDirectory = Join-Path $PackageDirectory 'video'
    $videoPlaylist = Join-Path $videoDirectory 'index.m3u8'
    $logPath = Join-Path $PackageDirectory 'conversion-progress.log'
    $lastSegmentCount = -1
    $idleChecks = 0

    while ($true) {
        $segments = @(Get-ChildItem -LiteralPath $videoDirectory -File -Filter '*.ts' -ErrorAction SilentlyContinue)
        $count = $segments.Count
        # HLS corta en fotogramas clave: los segmentos no son siempre de seis
        # segundos. Sumamos EXTINF para informar el progreso real del vídeo.
        $processedSeconds = 0.0
        if (Test-Path -LiteralPath $videoPlaylist) {
            foreach ($line in Get-Content -LiteralPath $videoPlaylist) {
                if ($line -match '^#EXTINF:([0-9.]+)') { $processedSeconds += [double]$matches[1] }
            }
        } else {
            $processedSeconds = $count * 6
        }
        $percent = [math]::Min(100, [math]::Round(($processedSeconds / $DurationSeconds) * 100, 1))
        $minutes = [math]::Round($processedSeconds / 60, 0)
        $message = "$count segmentos ($percent% · aprox. $minutes min procesados)"
        "$(Get-Date -Format s)  $message" | Add-Content -LiteralPath $logPath -Encoding utf8
        $icon.ShowBalloonTip(10000, "Nébula · $packageLabel", $message, [System.Windows.Forms.ToolTipIcon]::Info)

        if (Test-Path -LiteralPath (Join-Path $PackageDirectory 'master.m3u8')) {
            $icon.ShowBalloonTip(15000, "Nébula · $packageLabel", 'Conversión terminada. El paquete está listo para validación local.', [System.Windows.Forms.ToolTipIcon]::Info)
            break
        }

        $ffmpegRunning = $null -ne (Get-Process -Name ffmpeg -ErrorAction SilentlyContinue)
        if ($count -eq $lastSegmentCount -and -not $ffmpegRunning) {
            $idleChecks += 1
            if ($idleChecks -ge 2) {
                $icon.ShowBalloonTip(15000, "Nébula · $packageLabel", 'La conversión se detuvo antes de crear master.m3u8. Revisa la terminal.', [System.Windows.Forms.ToolTipIcon]::Warning)
                break
            }
        } else {
            $idleChecks = 0
        }
        $lastSegmentCount = $count
        Start-Sleep -Seconds $IntervalSeconds
    }
} finally {
    $icon.Dispose()
}


