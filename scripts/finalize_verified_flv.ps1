[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$Source = 'D:\NO_SUBIR\Excel\EXCEL COMP\Excel Nivel #3 AVANZADO\Curso Excel para Contadores\9430830\media\hilfe.flv',
    [string]$Prepared = 'D:\PREPARADOS_MEDIA\Excel\EXCEL COMP\Excel Nivel #3 AVANZADO\Curso Excel para Contadores\9430830\media\hilfe.mp4',
    [string]$Destination = 'D:\NO_SUBIR\Excel\EXCEL COMP\Excel Nivel #3 AVANZADO\Curso Excel para Contadores\9430830\media\hilfe.mp4',
    [string]$Backup = 'D:\RESPALDOS_MEDIA_ORIGINALES\Excel\EXCEL COMP\Excel Nivel #3 AVANZADO\Curso Excel para Contadores\9430830\media\hilfe.flv',
    [string]$Log = 'C:\Users\josep\Documents\ChatGPT\ProyectoStreamingDrive\outputs\media_inventory\conversion_logs\hilfe-flv.log'
)

$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
if (-not [IO.File]::Exists($Source)) { throw "No existe el FLV original: $Source" }
if ([IO.File]::Exists($Destination)) { throw "Ya existe el destino final: $Destination" }
if ([IO.File]::Exists($Backup)) { throw "Ya existe el respaldo: $Backup" }
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Prepared), (Split-Path -Parent $Backup), (Split-Path -Parent $Log) | Out-Null

$valid = $false
if ([IO.File]::Exists($Prepared)) {
    $probe = & ffprobe -v error -show_entries stream=codec_type,codec_name -of json -- $Prepared | ConvertFrom-Json
    $video = @($probe.streams | Where-Object { $_.codec_type -eq 'video' } | Select-Object -First 1)
    $audio = @($probe.streams | Where-Object { $_.codec_type -eq 'audio' } | Select-Object -First 1)
    $valid = $video.Count -eq 1 -and $video[0].codec_name -eq 'h264' -and $audio.Count -eq 1 -and $audio[0].codec_name -eq 'aac'
}
if (-not $valid) {
    & ffmpeg -hide_banner -y -i $Source -map 0:v:0 -map 0:a:0? -c:v libx264 -preset medium -crf 20 -c:a aac -b:a 192k -movflags +faststart $Prepared 2> $Log
    if ($LASTEXITCODE -ne 0) { throw "ffmpeg terminó con código $LASTEXITCODE" }
    $probe = & ffprobe -v error -show_entries stream=codec_type,codec_name -of json -- $Prepared | ConvertFrom-Json
    $video = @($probe.streams | Where-Object { $_.codec_type -eq 'video' } | Select-Object -First 1)
    $audio = @($probe.streams | Where-Object { $_.codec_type -eq 'audio' } | Select-Object -First 1)
    if ($video.Count -ne 1 -or $video[0].codec_name -ne 'h264' -or $audio.Count -ne 1 -or $audio[0].codec_name -ne 'aac') { throw 'El resultado no es H.264/AAC.' }
}
if ($PSCmdlet.ShouldProcess($Source, 'mover FLV a respaldo y MP4 validado a destino final')) {
    Move-Item -LiteralPath $Source -Destination $Backup -ErrorAction Stop
    try { Move-Item -LiteralPath $Prepared -Destination $Destination -ErrorAction Stop }
    catch { Move-Item -LiteralPath $Backup -Destination $Source -ErrorAction SilentlyContinue; throw }
}
Write-Host "OK: $Destination"
