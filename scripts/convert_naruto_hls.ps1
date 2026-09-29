[CmdletBinding()]
param(
    [switch]$PilotOnly,
    [switch]$PrepareOnly,
    [ValidateRange(1, 220)]
    [int]$FromEpisode = 1,
    [ValidateRange(1, 220)]
    [int]$ThroughEpisode = 220
)

$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSVersion.Major -ge 7) { $PSNativeCommandUseErrorActionPreference = $false }

$sourceRoot = 'I:\Entretenimiento\Series\Naruto'
$outputRoot = 'I:\_HLS_VALIDATED\Naruto'
$seriesCode = 'SER-00006'
$inventoryRoot = Join-Path (Split-Path $PSScriptRoot -Parent) 'outputs\media_inventory\naruto_20260924'
$converter = Join-Path $PSScriptRoot 'convert_hls_package.ps1'
$ffprobe = (Get-Command ffprobe -ErrorAction Stop).Source
if ($FromEpisode -gt $ThroughEpisode) { throw 'FromEpisode no puede ser mayor que ThroughEpisode.' }

if (-not (Test-Path -LiteralPath $sourceRoot -PathType Container)) { throw "No existe la fuente: $sourceRoot" }
if (-not (Test-Path -LiteralPath $converter -PathType Leaf)) { throw "No existe el conversor: $converter" }
New-Item -ItemType Directory -Force -Path $inventoryRoot, $outputRoot | Out-Null

$files = @(Get-ChildItem -LiteralPath $sourceRoot -Recurse -File -Filter '*.mp4')
if ($files.Count -ne 220) { throw "Se esperaban 220 MP4; se encontraron $($files.Count). No se inició la conversión." }

$inventory = foreach ($file in $files) {
    if ($file.BaseName -notmatch '(?<!\d)(\d{1,3})$') { throw "No se pudo extraer el número de episodio de $($file.FullName)" }
    $episode = [int]$Matches[1]
    if ($episode -lt 1 -or $episode -gt 220) { throw "Número de episodio fuera del rango esperado: $($file.FullName)" }

    $probeText = & $ffprobe -v error -show_entries 'format=duration:stream=index,codec_type,codec_name,profile,level,pix_fmt,channels' -of json -- $file.FullName
    if ($LASTEXITCODE -ne 0 -or -not $probeText) { throw "ffprobe no pudo leer $($file.FullName)" }
    $probe = $probeText | ConvertFrom-Json
    $videos = @($probe.streams | Where-Object codec_type -eq 'video')
    $audios = @($probe.streams | Where-Object codec_type -eq 'audio')
    if ($videos.Count -ne 1 -or $audios.Count -ne 1) {
        throw "Se esperaba una sola pista de vídeo y una de audio: $($file.FullName) (video=$($videos.Count), audio=$($audios.Count))"
    }
    if ($file.Name -notmatch '(?i)latino') { throw "El nombre no confirma audio Latino; requiere revisión: $($file.FullName)" }

    $code = '{0}-S01-E{1:D3}' -f $seriesCode, $episode
    [pscustomobject]@{
        CodigoInterno = $code
        Tipo = 'SERIE'
        TituloProvisional = 'Naruto - Episodio {0:D3}' -f $episode
        Serie = 'Naruto'
        Temporada = 1
        Episodio = $episode
        ArchivoOrigen = $file.FullName
        Archivo = $file.Name
        CarpetaFuente = $file.Directory.Name
        BytesOrigen = [int64]$file.Length
        DuracionSegundos = [math]::Round([double]$probe.format.duration, 3)
        VideoCodec = [string]$videos[0].codec_name
        VideoProfile = [string]$videos[0].profile
        VideoLevel = [int]$videos[0].level
        AudioCodec = [string]$audios[0].codec_name
        AudioProfile = [string]$audios[0].profile
        AudioStreamIndex = [int]$audios[0].index
        IdiomaAudio = 'es'
        Salida = Join-Path (Join-Path $outputRoot $seriesCode) $code
    }
}

$episodeNumbers = @($inventory | ForEach-Object Episodio | Sort-Object -Unique)
if ($episodeNumbers.Count -ne 220 -or $episodeNumbers[0] -ne 1 -or $episodeNumbers[-1] -ne 220) {
    throw 'La numeración no cubre exactamente los episodios 1 a 220.'
}
if (($inventory | Group-Object Episodio | Where-Object Count -ne 1).Count) { throw 'Hay episodios duplicados en los nombres de fuente.' }
$inventory = @($inventory | Sort-Object Episodio)

$privatePath = Join-Path $inventoryRoot 'inventario_privado.csv'
$catalogPath = Join-Path $inventoryRoot 'catalogo_subida.csv'
$inventory | Export-Csv -LiteralPath $privatePath -NoTypeInformation -Encoding utf8
$inventory | Select-Object CodigoInterno,Tipo,TituloProvisional,Serie,Temporada,Episodio |
    Export-Csv -LiteralPath $catalogPath -NoTypeInformation -Encoding utf8

Write-Output "Inventario verificado: $($inventory.Count) episodios. CSV público: $catalogPath"
if ($PrepareOnly) { return }

function Test-Package([string]$packagePath) {
    $masterPath = Join-Path $packagePath 'master.m3u8'
    if (-not (Test-Path -LiteralPath $masterPath -PathType Leaf)) { throw "Falta master.m3u8: $packagePath" }
    $master = Get-Content -LiteralPath $masterPath -Raw
    if ($master -notmatch 'TYPE=AUDIO[^\r\n]*LANGUAGE="es"[^\r\n]*URI="audio/es/index\.m3u8"') {
        throw "El master no declara la pista de audio español: $packagePath"
    }

    $playlistPaths = @('video/index.m3u8', 'audio/es/index.m3u8')
    foreach ($match in [regex]::Matches($master, 'URI="([^"\r\n]+\.m3u8)"')) { $playlistPaths += $match.Groups[1].Value }
    foreach ($match in [regex]::Matches($master, '(?m)^(?!#)([^\r\n]+\.m3u8)$')) { $playlistPaths += $match.Groups[1].Value }
    foreach ($relative in @($playlistPaths | Select-Object -Unique)) {
        $playlist = Join-Path $packagePath $relative
        if (-not (Test-Path -LiteralPath $playlist -PathType Leaf)) { throw "Falta playlist $relative" }
        $lines = @(Get-Content -LiteralPath $playlist)
        if ($lines[-1] -ne '#EXT-X-ENDLIST') { throw "Playlist sin cierre VOD: $relative" }
        $segments = @($lines | Where-Object { $_ -and -not $_.StartsWith('#') })
        if (-not $segments.Count) { throw "Playlist sin segmentos: $relative" }
        foreach ($segment in $segments) {
            $segmentPath = Join-Path (Split-Path $playlist -Parent) $segment
            if (-not (Test-Path -LiteralPath $segmentPath -PathType Leaf)) { throw "Falta segmento $relative/$segment" }
            if ((Get-Item -LiteralPath $segmentPath).Length -le 0) { throw "Segmento vacío: $relative/$segment" }
        }
    }
    return $true
}

$queue = @($inventory | Where-Object { $_.Episodio -ge $FromEpisode -and $_.Episodio -le $ThroughEpisode })
if ($PilotOnly) { $queue = @($queue | Select-Object -First 1) }
$eventLog = Join-Path $inventoryRoot 'conversion-log.jsonl'
foreach ($item in $queue) {
    $started = Get-Date
    try {
        if (Test-Path -LiteralPath $item.Salida) {
            Test-Package $item.Salida | Out-Null
            $status = 'ya_validado'
        } else {
            $ffmpegLog = Join-Path $inventoryRoot "$($item.CodigoInterno).ffmpeg.log"
            & $converter -SourceFile $item.ArchivoOrigen -InternalCode $item.CodigoInterno `
                -OutputRoot $outputRoot -VideoMode auto -VideoEncoder nvenc `
                -SubtitleDelaySeconds 1.5 -AudioStreamIndex $item.AudioStreamIndex -AudioLanguage es *> $ffmpegLog
            if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) { throw "El conversor terminó con código $LASTEXITCODE" }
            Test-Package $item.Salida | Out-Null
            $status = 'convertido'
        }
        $record = [pscustomobject]@{
            time = (Get-Date).ToString('o')
            code = $item.CodigoInterno
            status = $status
            seconds = [math]::Round(((Get-Date) - $started).TotalSeconds, 1)
        }
    } catch {
        $record = [pscustomobject]@{
            time = (Get-Date).ToString('o')
            code = $item.CodigoInterno
            status = 'error'
            seconds = [math]::Round(((Get-Date) - $started).TotalSeconds, 1)
            error = $_.Exception.Message
        }
    }
    [System.IO.File]::AppendAllText($eventLog, (($record | ConvertTo-Json -Compress) + "`n"), [System.Text.UTF8Encoding]::new($false))
    Write-Output ($record | ConvertTo-Json -Compress)
    if ($record.status -eq 'error') { break }
}
