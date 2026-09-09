[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$VerificationCsv,
    [string]$SourceRoot = 'D:\NO_SUBIR',
    [string]$ExcludedBackupRoot = 'D:\RESPALDOS_MEDIA_EXCLUIDOS',
    [string]$OriginalBackupRoot = 'D:\RESPALDOS_MEDIA_ORIGINALES',
    [string]$PreparedRoot = 'D:\PREPARADOS_MEDIA',
    [string]$LogDirectory = 'C:\Users\josep\Documents\ChatGPT\ProyectoStreamingDrive\outputs\media_inventory\conversion_logs'
)

$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($VerificationCsv)) {
    $VerificationCsv = (Get-ChildItem -LiteralPath (Split-Path -Parent $LogDirectory) -Filter 'verificacion_pendientes-*.csv' -File | Sort-Object LastWriteTime -Descending | Select-Object -First 1).FullName
}
if (-not (Test-Path -LiteralPath $VerificationCsv -PathType Leaf)) { throw "No existe el reporte: $VerificationCsv" }

$rows = Import-Csv -LiteralPath $VerificationCsv
$toArchive = @($rows | Where-Object { $_.Clasificacion -in 'METADATO_MACOS', 'VACIO', 'ARCHIVO_INVALIDO' })
$flv = @($rows | Where-Object { $_.Clasificacion -eq 'MEDIO_DETECTADO' -and $_.Extension -eq '.flv' })
if ($flv.Count -ne 1) { throw "Se esperaba exactamente un FLV válido; encontrados: $($flv.Count)." }

# Preflight: no destination is overwritten and all sources still exist.
foreach ($row in $toArchive) {
    $source = Join-Path $SourceRoot $row.RutaRelativa
    $backup = Join-Path $ExcludedBackupRoot $row.RutaRelativa
    if (-not [IO.File]::Exists($source)) { throw "Falta archivo a respaldar: $source" }
    if ([IO.File]::Exists($backup)) { throw "Ya existe respaldo, no se sobrescribe: $backup" }
}
$flvSource = Join-Path $SourceRoot $flv[0].RutaRelativa
$flvRelativeMp4 = [IO.Path]::ChangeExtension($flv[0].RutaRelativa, '.mp4')
$flvPrepared = Join-Path $PreparedRoot $flvRelativeMp4
$flvDestination = Join-Path $SourceRoot $flvRelativeMp4
$flvBackup = Join-Path $OriginalBackupRoot $flv[0].RutaRelativa
if (-not [IO.File]::Exists($flvSource)) { throw "Falta FLV: $flvSource" }
if ([IO.File]::Exists($flvPrepared) -or [IO.File]::Exists($flvDestination) -or [IO.File]::Exists($flvBackup)) { throw 'El destino, temporal o respaldo del FLV ya existe; se cancela para no sobrescribir.' }

$results = @()
foreach ($row in $toArchive) {
    $source = Join-Path $SourceRoot $row.RutaRelativa
    $backup = Join-Path $ExcludedBackupRoot $row.RutaRelativa
    try {
        if ($PSCmdlet.ShouldProcess($row.RutaRelativa, 'mover archivo auxiliar/dañado a respaldo excluido')) {
            New-Item -ItemType Directory -Force -Path (Split-Path -Parent $backup) | Out-Null
            Move-Item -LiteralPath $source -Destination $backup -ErrorAction Stop
        }
        $results += [pscustomobject]@{ Action='ARCHIVE_EXCLUDED'; RelativePath=$row.RutaRelativa; Source=$source; Destination=$backup; Status='OK'; Error='' }
    }
    catch { $results += [pscustomobject]@{ Action='ARCHIVE_EXCLUDED'; RelativePath=$row.RutaRelativa; Source=$source; Destination=$backup; Status='ERROR'; Error=$_.Exception.Message } }
}

try {
    if ($PSCmdlet.ShouldProcess($flv[0].RutaRelativa, 'convertir FLV válido a MP4 y respaldar FLV')) {
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $flvPrepared), (Split-Path -Parent $flvBackup) | Out-Null
        & ffmpeg -hide_banner -y -i $flvSource -map 0:v:0 -map 0:a:0? -c:v libx264 -preset medium -crf 20 -c:a aac -b:a 192k -movflags +faststart $flvPrepared 2> "$flvPrepared.ffmpeg.log"
        if ($LASTEXITCODE -ne 0) { throw "ffmpeg terminó con código $LASTEXITCODE" }
        $probe = & ffprobe -v error -show_entries stream=codec_type,codec_name -of json -- $flvPrepared | ConvertFrom-Json
        $video = @($probe.streams | Where-Object { $_.codec_type -eq 'video' } | Select-Object -First 1)
        $audio = @($probe.streams | Where-Object { $_.codec_type -eq 'audio' } | Select-Object -First 1)
        if ($video.Count -ne 1 -or $video[0].codec_name -ne 'h264' -or $audio.Count -ne 1 -or $audio[0].codec_name -ne 'aac') { throw 'La conversión FLV no produjo H.264/AAC.' }
        Move-Item -LiteralPath $flvSource -Destination $flvBackup -ErrorAction Stop
        try { Move-Item -LiteralPath $flvPrepared -Destination $flvDestination -ErrorAction Stop }
        catch { Move-Item -LiteralPath $flvBackup -Destination $flvSource -ErrorAction SilentlyContinue; throw }
    }
    $results += [pscustomobject]@{ Action='CONVERT_FLV'; RelativePath=$flv[0].RutaRelativa; Source=$flvSource; Destination=$flvDestination; Status='OK'; Error='' }
}
catch { $results += [pscustomobject]@{ Action='CONVERT_FLV'; RelativePath=$flv[0].RutaRelativa; Source=$flvSource; Destination=$flvDestination; Status='ERROR'; Error=$_.Exception.Message } }

New-Item -ItemType Directory -Force -Path $LogDirectory | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$resultPath = Join-Path $LogDirectory "verified_cleanup_results-$stamp.csv"
$results | Export-Csv -LiteralPath $resultPath -NoTypeInformation -Encoding UTF8
$errors = @($results | Where-Object Status -eq 'ERROR').Count
Write-Host "Archivados: $(@($results | Where-Object Action -eq 'ARCHIVE_EXCLUDED' | Where-Object Status -eq 'OK').Count). FLV: $(@($results | Where-Object Action -eq 'CONVERT_FLV' | Where-Object Status -eq 'OK').Count). Errores: $errors. Resultado: $resultPath"
if ($errors -gt 0) { exit 2 }
