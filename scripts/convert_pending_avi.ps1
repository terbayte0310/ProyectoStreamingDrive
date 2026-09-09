[CmdletBinding()]
param(
    [string]$ResultsPath,
    [string]$LogDirectory,
    [string]$OutputRoot = 'D:\PREPARADOS_MEDIA'
)

$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
if ([string]::IsNullOrWhiteSpace($ResultsPath)) {
    $ResultsPath = Join-Path (Split-Path -Parent $PSScriptRoot) 'outputs\media_inventory\conversion_logs\conversion_results-20260908-134152.csv'
}
if ([string]::IsNullOrWhiteSpace($LogDirectory)) {
    $LogDirectory = Join-Path (Split-Path -Parent $PSScriptRoot) 'outputs\media_inventory\conversion_logs\avi'
}
New-Item -ItemType Directory -Force -Path $LogDirectory | Out-Null

$items = Import-Csv -LiteralPath $ResultsPath | Where-Object { $_.Status -eq 'ERROR' -and $_.Operation -eq 'TRANSCODE_AVI' }
if ($items.Count -eq 0) { throw 'No hay AVI pendientes en el resultado indicado.' }

$results = for ($index = 0; $index -lt $items.Count; $index += 1) {
    $item = $items[$index]
    $startedAt = Get-Date
    $logPath = Join-Path $LogDirectory ('{0:D2}-{1}.log' -f ($index + 1), [System.IO.Path]::GetFileNameWithoutExtension($item.OutputPath))
    try {
        if (-not (Test-Path -LiteralPath $item.SourcePath -PathType Leaf)) { throw "No existe el origen: $($item.SourcePath)" }
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $item.OutputPath) | Out-Null
        & ffmpeg -hide_banner -y -i $item.SourcePath -map 0:v:0 -map 0:a:0? -c:v libx264 -preset medium -crf 20 -c:a aac -b:a 192k -movflags +faststart $item.OutputPath 2> $logPath
        if ($LASTEXITCODE -ne 0) { throw "ffmpeg terminó con código $LASTEXITCODE" }
        $probe = & ffprobe -v error -show_entries stream=codec_type,codec_name -of json -- $item.OutputPath | ConvertFrom-Json
        $video = @($probe.streams | Where-Object { $_.codec_type -eq 'video' } | Select-Object -First 1)
        $audio = @($probe.streams | Where-Object { $_.codec_type -eq 'audio' } | Select-Object -First 1)
        if ($video.Count -ne 1 -or $video[0].codec_name -ne 'h264' -or $audio.Count -ne 1 -or $audio[0].codec_name -ne 'aac') { throw 'Resultado no compatible: se esperaba H.264/AAC.' }
        [pscustomobject]@{ RelativePath=$item.RelativePath; SourcePath=$item.SourcePath; OutputPath=$item.OutputPath; Status='OK'; Seconds=[math]::Round(((Get-Date)-$startedAt).TotalSeconds,1); LogPath=$logPath; Error='' }
    }
    catch {
        [pscustomobject]@{ RelativePath=$item.RelativePath; SourcePath=$item.SourcePath; OutputPath=$item.OutputPath; Status='ERROR'; Seconds=[math]::Round(((Get-Date)-$startedAt).TotalSeconds,1); LogPath=$logPath; Error=$_.Exception.Message }
    }
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$results | Export-Csv -LiteralPath (Join-Path (Split-Path -Parent $LogDirectory) "avi_results-$stamp.csv") -NoTypeInformation -Encoding UTF8
Write-Host "AVI correctos: $(@($results | Where-Object Status -eq 'OK').Count). Errores: $(@($results | Where-Object Status -eq 'ERROR').Count)."
if (@($results | Where-Object Status -eq 'ERROR').Count -gt 0) { exit 2 }
