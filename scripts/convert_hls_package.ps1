[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$SourceFile,

    [Parameter(Mandatory)]
    [ValidatePattern('^(MOV-[0-9]{5,}|SER-[0-9]{5,}-S[0-9]{2}-E[0-9]{2,3})$')]
    [string]$InternalCode,

    [Parameter(Mandatory)]
    [string]$OutputRoot,

    [ValidateSet('auto', 'copy', 'transcode')]
    [string]$VideoMode = 'auto',

    [ValidateSet('software', 'nvenc')]
    [string]$VideoEncoder = 'software',

    # Compensación comprobada en los paquetes piloto. Un valor positivo retrasa
    # los WebVTT respecto al vídeo y sigue siendo configurable por fuente.
    [ValidateRange(-10, 10)]
    [double]$SubtitleDelaySeconds = 1.5,

    # Solo para una decisión humana documentada en la cola. No convierte
    # etiquetas ambiguas como `lat` en español de forma automática.
    [ValidateRange(-1, 999)]
    [int]$AudioStreamIndex = -1,

    [ValidateSet('es', 'en', 'und')]
    [string]$AudioLanguage = 'und',

    [switch]$PlanOnly
)

# Convierte un solo archivo a HLS VOD sin modificar la fuente. El identificador
# debe proceder del catálogo: nunca se deriva del nombre del archivo.
$ErrorActionPreference = 'Stop'
# FFmpeg informa su progreso por stderr aun cuando termina correctamente.
# PowerShell 7 puede tratar ese flujo normal como una excepción; conservamos
# la comprobación explícita de $LASTEXITCODE que sigue a cada llamada.
if ($PSVersionTable.PSVersion.Major -ge 7) { $PSNativeCommandUseErrorActionPreference = $false }

if (-not (Test-Path -LiteralPath $SourceFile -PathType Leaf)) {
    throw "No existe el archivo fuente: $SourceFile"
}

$ffmpeg = Get-Command ffmpeg -ErrorAction Stop
$ffprobe = Get-Command ffprobe -ErrorAction Stop
$seriesCode = if ($InternalCode -match '^(SER-[0-9]{5,})-S[0-9]{2}-E[0-9]{2,3}$') { $Matches[1] } else { $null }
$packageDirectory = if ($seriesCode) {
    Join-Path (Join-Path $OutputRoot $seriesCode) $InternalCode
} else {
    Join-Path $OutputRoot $InternalCode
}

$probeText = & $ffprobe.Source -v error -show_entries `
    format=duration:stream=index,codec_type,codec_name,profile,level,pix_fmt:stream_disposition=forced:stream_tags=language,title,NUMBER_OF_BYTES `
    -of json -- $SourceFile
if ($LASTEXITCODE -ne 0 -or -not $probeText) { throw 'ffprobe no pudo leer la cabecera del archivo.' }
$probe = $probeText | ConvertFrom-Json
$streams = @($probe.streams)
$mediaDuration = [Math]::Max(1, [Math]::Ceiling([double]$probe.format.duration))
$video = @($streams | Where-Object codec_type -eq 'video' | Select-Object -First 1)
if (-not $video) { throw 'El archivo no contiene una pista de vídeo.' }

$audioCandidates = @(
    $streams |
    Where-Object codec_type -eq 'audio' |
    ForEach-Object {
        $sourceLanguage = if ($_.tags -and $_.tags.language) { $_.tags.language.ToLowerInvariant() } else { 'und' }
        $title = if ($_.tags -and $_.tags.title) { [string]$_.tags.title } else { '' }
        $normalized = if ($sourceLanguage -in @('es', 'spa')) { 'es' } elseif ($sourceLanguage -in @('en', 'eng')) { 'en' } elseif ($title -match '(?i)español|latam|latino') { 'es' } elseif ($title -match '(?i)english|inglés|ingles') { 'en' } else { 'und' }
        $priority = if ($normalized -eq 'es' -and $title -match '(?i)oficial') { 2 } elseif ($normalized -in @('es', 'en')) { 1 } else { 0 }
        [pscustomobject]@{ GlobalIndex = [int]$_.index; Language = $normalized; SourceLanguage = $sourceLanguage; Title = $title; Priority = $priority; Codec = [string]$_.codec_name; Profile = if ($_.profile) { [string]$_.profile } else { '' } }
    }
)

# Una rendición por idioma. La primera pista explícitamente etiquetada gana;
# etiquetas como `lat` quedan deliberadamente fuera para revisión humana.
$audioTracks = @()
foreach ($language in 'es', 'en') {
    $track = $audioCandidates | Where-Object Language -eq $language | Sort-Object -Property @{ Expression = 'Priority'; Descending = $true }, GlobalIndex | Select-Object -First 1
    if ($track) { $audioTracks += $track }
}
if ($AudioStreamIndex -ge 0) {
    $forcedTrack = $audioCandidates | Where-Object GlobalIndex -eq $AudioStreamIndex | Select-Object -First 1
    if (-not $forcedTrack) { throw "No existe una pista de audio con índice $AudioStreamIndex para la selección explícita." }
    $audioTracks = @([pscustomobject]@{
        GlobalIndex = $forcedTrack.GlobalIndex
        Language = $AudioLanguage
        SourceLanguage = $forcedTrack.SourceLanguage
        Title = $forcedTrack.Title
        Codec = $forcedTrack.Codec
        Profile = $forcedTrack.Profile
    })
}
if (-not $audioTracks.Count) {
    # Una sola pista sin etiqueta se conserva como "Original"; no se inventa
    # un idioma. Varios audios ambiguos sí requieren revisión humana.
    $unknownTracks = @($audioCandidates | Where-Object Language -eq 'und')
    if ($unknownTracks.Count -eq 1) {
        $audioTracks += $unknownTracks[0]
    } else {
        throw 'No hay pistas de audio etiquetadas explícitamente como Español o Inglés, ni una única pista original identificable. Requiere revisión humana.'
    }
}

$textSubtitleCodecs = @('ass', 'ssa', 'subrip', 'webvtt', 'mov_text')
$subtitleTracks = @(
    $streams |
    Where-Object { $_.codec_type -eq 'subtitle' -and $_.codec_name -in $textSubtitleCodecs } |
    ForEach-Object {
        $language = if ($_.tags -and $_.tags.language) { $_.tags.language.ToLowerInvariant() } else { 'und' }
        $normalized = if ($language -in @('es', 'spa')) { 'es' } elseif ($language -in @('en', 'eng')) { 'en' } else { $null }
        if ($normalized) {
            [pscustomobject]@{
                GlobalIndex = [int]$_.index
                Language = $normalized
                Codec = [string]$_.codec_name
                Forced = [bool]($_.disposition -and $_.disposition.forced -eq 1)
                ByteSize = if ($_.tags -and $_.tags.NUMBER_OF_BYTES) { [int64]$_.tags.NUMBER_OF_BYTES } else { 0 }
            }
        }
    }
)
$selectedSubtitles = @()
foreach ($language in 'es', 'en') {
    # Si hay una pista completa y una forzada, usar la completa. La forzada
    # queda como respaldo cuando es la única disponible.
    $sameLanguage = @($subtitleTracks | Where-Object Language -eq $language)
    $track = $sameLanguage | Where-Object { -not $_.Forced } | Sort-Object ByteSize -Descending | Select-Object -First 1
    if (-not $track) { $track = $sameLanguage | Sort-Object ByteSize -Descending | Select-Object -First 1 }
    if ($track) { $selectedSubtitles += $track }
}
$hasPgs = @($streams | Where-Object { $_.codec_type -eq 'subtitle' -and $_.codec_name -eq 'hdmv_pgs_subtitle' }).Count -gt 0

$copyVideo = $VideoMode -eq 'copy' -or (
    $VideoMode -eq 'auto' -and
    $video[0].codec_name -eq 'h264' -and
    $video[0].profile -in @('Baseline', 'Constrained Baseline', 'Main', 'High') -and
    [int]$video[0].level -le 42
)

# H.264 High 10 (y otras entradas de más de 8 bits) no se decodifica con CUDA.
# Se decodifica por CPU, se reduce a yuv420p y recién se sube a NVENC.
# Así se conserva aceleración en la codificación final.
$nvencNeedsCpuDecode = -not $copyVideo -and $VideoEncoder -eq 'nvenc' -and [string]$video[0].pix_fmt -match 'p(10|12|14|16)'

if (-not $copyVideo -and $VideoEncoder -eq 'nvenc') {
    $nvencAvailable = (& $ffmpeg.Source -hide_banner -encoders 2>$null) -match '^\s*V.*h264_nvenc'
    if (-not $nvencAvailable) { throw 'FFmpeg no detecta el codificador NVIDIA NVENC H.264.' }
}
$plan = [pscustomobject]@{
    codigoInterno = $InternalCode
    video = [pscustomobject]@{ codec = $video[0].codec_name; profile = $video[0].profile; pixelFormat = $video[0].pix_fmt; level = $video[0].level; nvencNeedsCpuDecode = $nvencNeedsCpuDecode; mode = if ($copyVideo) { 'copy' } elseif ($VideoEncoder -eq 'nvenc') { 'transcode-h264-nvenc' } else { 'transcode-h264' } }
    audio = @($audioTracks | ForEach-Object { [pscustomobject]@{ language = $_.Language; sourceLanguage = $_.SourceLanguage; streamIndex = $_.GlobalIndex; codec = $_.Codec; mode = if ($_.Codec -eq 'aac' -and $_.Profile -eq 'LC') { 'copy' } else { 'transcode-aac' } } })
    subtitles = @($selectedSubtitles | ForEach-Object { [pscustomobject]@{ language = $_.Language; streamIndex = $_.GlobalIndex; codec = $_.Codec } })
    subtitleDelaySeconds = $SubtitleDelaySeconds
    pgsReviewRequired = $hasPgs
}
if ($PlanOnly) {
    $plan | ConvertTo-Json -Depth 5
    return
}

if (Test-Path -LiteralPath $packageDirectory) {
    throw "La salida ya existe: $packageDirectory. Revísala o elige otro código; el script nunca la sobrescribe."
}

New-Item -ItemType Directory -Force -Path $packageDirectory | Out-Null
try {
    # En E: el muxer HLS de FFmpeg no puede escribir las variantes en paralelo.
    # Generamos el vídeo y cada idioma de audio por separado: conserva un único
    # vídeo compartido y evita la condición de carrera de Windows.
    $videoDirectory = Join-Path $packageDirectory 'video'
    New-Item -ItemType Directory -Force -Path $videoDirectory | Out-Null
    $videoPath = $videoDirectory.Replace('\', '/')
    $videoArguments = @('-hide_banner', '-y')
    if (-not $copyVideo -and $VideoEncoder -eq 'nvenc' -and -not $nvencNeedsCpuDecode) {
        $videoArguments += @('-hwaccel', 'cuda', '-hwaccel_output_format', 'cuda')
    }
    $videoArguments += @('-i', $SourceFile, '-map', "0:$($video[0].index)", '-an', '-sn')
    if ($copyVideo) {
        $videoArguments += @('-c:v', 'copy')
    } elseif ($VideoEncoder -eq 'nvenc') {
        $nvencFilter = if ($nvencNeedsCpuDecode) { 'format=yuv420p,hwupload_cuda' } else { 'scale_cuda=format=yuv420p' }
        $videoArguments += @('-vf', $nvencFilter, '-c:v', 'h264_nvenc', '-preset', 'p6', '-tune', 'hq', '-rc', 'vbr', '-cq', '19', '-b:v', '12M', '-maxrate', '20M', '-bufsize', '24M', '-profile:v', 'high', '-level:v', '5.1')
    } else {
        $videoArguments += @('-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-level:v', '5.1')
    }
    $videoArguments += @(
        '-f', 'hls',
        '-hls_playlist_type', 'vod',
        '-hls_time', '6',
        '-hls_flags', 'independent_segments+temp_file',
        '-hls_segment_filename', "$videoPath/segment_%05d.ts",
        "$videoPath/index.m3u8"
    )
    & $ffmpeg.Source @videoArguments
    if ($LASTEXITCODE -ne 0) { throw "FFmpeg no pudo generar el vídeo HLS (código $LASTEXITCODE)." }

    foreach ($track in $audioTracks) {
        $audioDirectory = Join-Path $packageDirectory (Join-Path 'audio' $track.Language)
        New-Item -ItemType Directory -Force -Path $audioDirectory | Out-Null
        $audioPath = $audioDirectory.Replace('\', '/')
        $audioArguments = @(
            '-hide_banner', '-y', '-i', $SourceFile,
            '-map', "0:$($track.GlobalIndex)", '-vn', '-sn'
        )
        $copyAudio = $track.Codec -eq 'aac' -and $track.Profile -eq 'LC'
        if ($copyAudio) {
            $audioArguments += @('-c:a', 'copy')
        } else {
            $audioArguments += @('-c:a', 'aac', '-b:a', '192k', '-ac', '2')
        }
        $audioArguments += @(
            '-f', 'hls', '-hls_playlist_type', 'vod', '-hls_time', '6',
            '-hls_flags', 'independent_segments+temp_file',
            '-hls_segment_filename', "$audioPath/segment_%05d.ts",
            "$audioPath/index.m3u8"
        )
        & $ffmpeg.Source @audioArguments
        if ($LASTEXITCODE -ne 0) { throw "FFmpeg no pudo generar el audio $($track.Language) (código $LASTEXITCODE)." }
    }

    $subtitleMediaLines = @()
    foreach ($subtitle in $selectedSubtitles) {
        $subtitleDirectory = Join-Path $packageDirectory (Join-Path 'subtitles' $subtitle.Language)
        New-Item -ItemType Directory -Force -Path $subtitleDirectory | Out-Null
        $subtitlePath = Join-Path $subtitleDirectory 'subtitle.vtt'
        & $ffmpeg.Source -hide_banner -y -itsoffset $SubtitleDelaySeconds -i $SourceFile -map "0:$($subtitle.GlobalIndex)" -c:s webvtt $subtitlePath
        if ($LASTEXITCODE -ne 0) { throw "No se pudo convertir el subtítulo $($subtitle.Language) a WebVTT." }
        $subtitlePlaylist = @(
            '#EXTM3U'
            '#EXT-X-VERSION:3'
            '#EXT-X-PLAYLIST-TYPE:VOD'
            "#EXT-X-TARGETDURATION:$mediaDuration"
            '#EXT-X-MEDIA-SEQUENCE:0'
            "#EXTINF:${mediaDuration}.000,"
            'subtitle.vtt'
            '#EXT-X-ENDLIST'
            ''
        ) -join "`n"
        [System.IO.File]::WriteAllText((Join-Path $subtitleDirectory 'index.m3u8'), $subtitlePlaylist, [System.Text.UTF8Encoding]::new($false))
        $name = if ($subtitle.Language -eq 'es') { 'Espanol' } else { 'English' }
        $default = if ($subtitle.Language -eq 'es') { 'YES' } else { 'NO' }
        $subtitleMediaLines += "#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID=`"subs`",NAME=`"$name`",DEFAULT=$default,AUTOSELECT=YES,LANGUAGE=`"$($subtitle.Language)`",URI=`"subtitles/$($subtitle.Language)/index.m3u8`""
    }

    $audioMediaLines = @()
    foreach ($track in $audioTracks) {
        $name = if ($track.Language -eq 'es') { 'Español' } elseif ($track.Language -eq 'en') { 'English' } else { 'Original' }
        $default = if ($track.Language -eq 'es' -or $audioTracks.Count -eq 1) { 'YES' } else { 'NO' }
        $audioMediaLines += "#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID=`"audio`",NAME=`"$name`",DEFAULT=$default,AUTOSELECT=YES,LANGUAGE=`"$($track.Language)`",URI=`"audio/$($track.Language)/index.m3u8`""
    }
    $profileHex = @{ 'Baseline' = '42'; 'Constrained Baseline' = '42'; 'Main' = '4D'; 'High' = '64' }
    $videoCodec = if ($copyVideo) {
        "avc1.$($profileHex[$video[0].profile])00$('{0:X2}' -f [int]$video[0].level)"
    } else { 'avc1.640029' }
    $streamAttributes = "BANDWIDTH=10000000,CODECS=`"$videoCodec,mp4a.40.2`",AUDIO=`"audio`""
    if ($subtitleMediaLines.Count) { $streamAttributes += ',SUBTITLES="subs"' }
    $masterLines = @('#EXTM3U', '#EXT-X-VERSION:6', '#EXT-X-INDEPENDENT-SEGMENTS') + $audioMediaLines + $subtitleMediaLines + "#EXT-X-STREAM-INF:$streamAttributes" + 'video/index.m3u8'
    $masterPath = Join-Path $packageDirectory 'master.m3u8'
    [System.IO.File]::WriteAllText($masterPath, (($masterLines -join "`n") + "`n"), [System.Text.UTF8Encoding]::new($false))

    $plan | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $OutputRoot "$InternalCode.conversion.json") -Encoding utf8
    Write-Host "Paquete HLS creado: $packageDirectory"
} catch {
    throw
}



