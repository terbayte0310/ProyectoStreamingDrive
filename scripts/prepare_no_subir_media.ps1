[CmdletBinding()]
param(
    [Parameter()]
    [string]$InventoryPath,

    [Parameter()]
    [string]$SourceRoot = 'D:\NO_SUBIR',

    [Parameter()]
    [string]$OutputRoot = 'D:\PREPARADOS_MEDIA',

    [Parameter()]
    [string]$LogDirectory
)

$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false

if ([string]::IsNullOrWhiteSpace($InventoryPath)) {
    $InventoryPath = Join-Path (Split-Path -Parent $PSScriptRoot) 'outputs\media_inventory\needs_preparation-20260908-120108.csv'
}
if ([string]::IsNullOrWhiteSpace($LogDirectory)) {
    $LogDirectory = Join-Path (Split-Path -Parent $PSScriptRoot) 'outputs\media_inventory\conversion_logs'
}

if (-not (Test-Path -LiteralPath $InventoryPath -PathType Leaf)) { throw "No existe el inventario: $InventoryPath" }
if (-not (Test-Path -LiteralPath $SourceRoot -PathType Container)) { throw "No existe el origen: $SourceRoot" }
if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) { throw 'No se encontró ffmpeg.' }

New-Item -ItemType Directory -Force -Path $OutputRoot, $LogDirectory | Out-Null

$items = foreach ($row in Import-Csv -LiteralPath $InventoryPath) {
    $isTsRemux = $row.extension -eq '.ts' -and $row.video_codecs -eq 'h264' -and $row.audio_codecs -eq 'aac'
    $isMp4Normalize = $row.extension -eq '.mp4' -and $row.video_codecs -eq 'h264;mjpeg' -and $row.audio_codecs -eq 'aac'
    $isAviTranscode = $row.extension -eq '.avi' -and $row.video_codecs -eq 'mpeg4' -and $row.audio_codecs -eq 'mp3'
    if (-not ($isTsRemux -or $isMp4Normalize -or $isAviTranscode)) { continue }

    $relative = $row.relative_path
    $sourcePath = Join-Path $SourceRoot $relative
    $outputRelative = [System.IO.Path]::ChangeExtension($relative, '.mp4')
    $outputPath = Join-Path $OutputRoot $outputRelative
    [pscustomobject]@{
        Operation = if ($isTsRemux) { 'REMUX_TS' } elseif ($isMp4Normalize) { 'NORMALIZE_MP4' } else { 'TRANSCODE_AVI' }
        RelativePath = $relative
        SourcePath = $sourcePath
        OutputPath = $outputPath
    }
}

$excluded = Import-Csv -LiteralPath $InventoryPath | Where-Object {
    -not (($_.extension -eq '.ts' -and $_.video_codecs -eq 'h264' -and $_.audio_codecs -eq 'aac') -or
          ($_.extension -eq '.mp4' -and $_.video_codecs -eq 'h264;mjpeg' -and $_.audio_codecs -eq 'aac') -or
          ($_.extension -eq '.avi' -and $_.video_codecs -eq 'mpeg4' -and $_.audio_codecs -eq 'mp3'))
}
$excluded | Export-Csv -LiteralPath (Join-Path $LogDirectory 'excluded_auxiliary_or_invalid.csv') -NoTypeInformation -Encoding UTF8

$results = foreach ($item in $items) {
    $startedAt = Get-Date
    try {
        if (-not (Test-Path -LiteralPath $item.SourcePath -PathType Leaf)) { throw "No existe el archivo de origen: $($item.SourcePath)" }
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $item.OutputPath) | Out-Null

        if ($item.Operation -eq 'REMUX_TS') {
            & ffmpeg -hide_banner -y -fflags +genpts+discardcorrupt -i $item.SourcePath -map 0:v:0 -map 0:a? -c copy -movflags +faststart $item.OutputPath 2> "$($item.OutputPath).ffmpeg.log"
        }
        elseif ($item.Operation -eq 'NORMALIZE_MP4') {
            & ffmpeg -hide_banner -y -i $item.SourcePath -map 0:v:0 -map 0:a? -c copy -movflags +faststart $item.OutputPath 2> "$($item.OutputPath).ffmpeg.log"
        }
        else {
            & ffmpeg -hide_banner -y -i $item.SourcePath -map 0:v:0 -map 0:a:0? -c:v libx264 -preset medium -crf 20 -c:a aac -b:a 192k -movflags +faststart $item.OutputPath 2> "$($item.OutputPath).ffmpeg.log"
        }
        if ($LASTEXITCODE -ne 0) { throw "ffmpeg terminó con código $LASTEXITCODE" }

        $probe = & ffprobe -v error -show_entries stream=codec_type,codec_name -of json -- $item.OutputPath | ConvertFrom-Json
        $video = @($probe.streams | Where-Object { $_.codec_type -eq 'video' } | Select-Object -First 1)
        $audio = @($probe.streams | Where-Object { $_.codec_type -eq 'audio' } | Select-Object -First 1)
        if ($video.Count -ne 1 -or $video[0].codec_name -ne 'h264') { throw 'El resultado no contiene vídeo H.264.' }
        if ($audio.Count -gt 0 -and $audio[0].codec_name -ne 'aac') { throw 'El resultado no contiene audio AAC.' }

        [pscustomobject]@{ Operation=$item.Operation; RelativePath=$item.RelativePath; SourcePath=$item.SourcePath; OutputPath=$item.OutputPath; Status='OK'; DurationSeconds=[math]::Round(((Get-Date)-$startedAt).TotalSeconds,1); Error='' }
    }
    catch {
        [pscustomobject]@{ Operation=$item.Operation; RelativePath=$item.RelativePath; SourcePath=$item.SourcePath; OutputPath=$item.OutputPath; Status='ERROR'; DurationSeconds=[math]::Round(((Get-Date)-$startedAt).TotalSeconds,1); Error=$_.Exception.Message }
    }
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$results | Export-Csv -LiteralPath (Join-Path $LogDirectory "conversion_results-$stamp.csv") -NoTypeInformation -Encoding UTF8
$ok = @($results | Where-Object Status -eq 'OK').Count
$errors = @($results | Where-Object Status -eq 'ERROR').Count
Write-Host "Preparados: $ok. Errores: $errors. Excluidos: $($excluded.Count)."
if ($errors -gt 0) { exit 2 }
