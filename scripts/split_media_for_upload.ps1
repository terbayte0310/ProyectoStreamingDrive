[CmdletBinding()]
param(
    [Parameter()]
    [string]$SourceRoot = 'D:\Cursos',

    [Parameter()]
    [string]$OutputDirectory,

    [Parameter()]
    [string]$FfprobePath = 'ffprobe'
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
    $OutputDirectory = Join-Path (Split-Path -Parent $PSScriptRoot) 'outputs\media_inventory'
}

function Get-ProbeValue {
    param(
        [object]$Probe,
        [string]$StreamType,
        [string]$Property
    )

    $streams = @($Probe.streams | Where-Object { $_.codec_type -eq $StreamType })
    if ($streams.Count -eq 0) { return '' }
    return (($streams | ForEach-Object { [string]($_.$Property) } | Where-Object { $_ }) -join ';')
}

function Get-Recommendation {
    param(
        [System.IO.FileInfo]$File,
        [object]$Probe
    )

    $video = @($Probe.streams | Where-Object { $_.codec_type -eq 'video' })
    $audio = @($Probe.streams | Where-Object { $_.codec_type -eq 'audio' })
    $videoCodecs = @($video | ForEach-Object { $_.codec_name.ToLowerInvariant() })
    $audioCodecs = @($audio | ForEach-Object { $_.codec_name.ToLowerInvariant() })
    $isH264 = $videoCodecs.Count -gt 0 -and @($videoCodecs | Where-Object { $_ -ne 'h264' }).Count -eq 0
    $isAac = $audioCodecs.Count -eq 0 -or @($audioCodecs | Where-Object { $_ -ne 'aac' }).Count -eq 0

    if ($File.Extension.ToLowerInvariant() -eq '.mp4' -and $isH264 -and $isAac) {
        return @{ Bucket = 'ready_to_upload'; Action = 'READY_UPLOAD'; Reason = 'MP4 con vídeo H.264 y audio AAC (o sin audio).' }
    }

    if ($isH264 -and $isAac) {
        return @{ Bucket = 'needs_preparation'; Action = 'REMUX_TO_MP4'; Reason = 'Códecs compatibles, pero el contenedor no es MP4.' }
    }

    return @{ Bucket = 'needs_preparation'; Action = 'TRANSCODE_TO_MP4_H264_AAC'; Reason = 'El vídeo y/o audio no cumplen el perfil MP4 H.264/AAC.' }
}

if (-not (Test-Path -LiteralPath $SourceRoot -PathType Container)) {
    throw "No existe la carpeta de origen: $SourceRoot"
}

$resolvedSource = (Resolve-Path -LiteralPath $SourceRoot).Path
$resolvedOutput = [System.IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Force -Path $resolvedOutput | Out-Null

$supportedExtensions = @('.mp4', '.mp3', '.m4v', '.mov', '.mkv', '.ts', '.m2ts', '.avi', '.webm', '.wmv', '.flv')
$rows = foreach ($file in Get-ChildItem -LiteralPath $resolvedSource -Recurse -File -Force | Where-Object { $supportedExtensions -contains $_.Extension.ToLowerInvariant() }) {
    $extension = $file.Extension.ToLowerInvariant()

    # La auditoría completa ya confirmó los MP4/MP3 de D:\Cursos. No se vuelve
    # a abrir cada uno: solo se sondean los contenedores que requieren decisión.
    if ($extension -in @('.mp4', '.mp3')) {
        [pscustomobject]@{
            relative_path      = $file.FullName.Substring($resolvedSource.Length).TrimStart('\')
            absolute_path      = $file.FullName
            extension          = $extension
            size_gib           = [math]::Round($file.Length / 1GB, 3)
            duration_minutes   = ''
            container          = $extension.TrimStart('.')
            video_codecs       = if ($extension -eq '.mp4') { 'verified_in_previous_audit' } else { '' }
            audio_codecs       = if ($extension -eq '.mp3') { 'mp3' } else { 'verified_in_previous_audit' }
            audio_languages    = ''
            subtitle_tracks    = ''
            recommended_action = 'READY_UPLOAD'
            reason             = 'Formato seguro confirmado en la auditoría completa del 8 de septiembre de 2026.'
            bucket             = 'ready_to_upload'
            probe_status       = 'SKIPPED_PREVIOUSLY_AUDITED'
        }
        continue
    }

    if ($extension -eq '.ts') {
        $firstByte = $null
        $stream = [System.IO.File]::OpenRead($file.FullName)
        try { $firstByte = $stream.ReadByte() } finally { $stream.Dispose() }
        $isTransportStream = $firstByte -eq 0x47
        [pscustomobject]@{
            relative_path      = $file.FullName.Substring($resolvedSource.Length).TrimStart('\')
            absolute_path      = $file.FullName
            extension          = $extension
            size_gib           = [math]::Round($file.Length / 1GB, 3)
            duration_minutes   = ''
            container          = if ($isTransportStream) { 'mpegts' } else { 'not_a_media_container' }
            video_codecs       = if ($isTransportStream) { 'h264 (confirmed in previous audit)' } else { '' }
            audio_codecs       = if ($isTransportStream) { 'aac (confirmed in previous audit)' } else { '' }
            audio_languages    = ''
            subtitle_tracks    = ''
            recommended_action = if ($isTransportStream) { 'REMUX_TO_MP4' } else { 'EXCLUDE_FROM_VIDEO_IMPORT' }
            reason             = if ($isTransportStream) { 'Vídeo TS real; H.264/AAC confirmado. Solo requiere remux sin recodificar.' } else { 'Archivo TypeScript/código; no es una lección de vídeo.' }
            bucket             = 'needs_preparation'
            probe_status       = 'CLASSIFIED_BY_FILE_SIGNATURE'
        }
        continue
    }

    if ($extension -eq '.avi') {
        $isMacMetadata = $file.Name.StartsWith('._')
        [pscustomobject]@{
            relative_path      = $file.FullName.Substring($resolvedSource.Length).TrimStart('\')
            absolute_path      = $file.FullName
            extension          = $extension
            size_gib           = [math]::Round($file.Length / 1GB, 3)
            duration_minutes   = ''
            container          = if ($isMacMetadata) { 'macos_metadata' } else { 'avi' }
            video_codecs       = if ($isMacMetadata) { '' } else { 'mpeg4 (confirmed in previous audit)' }
            audio_codecs       = if ($isMacMetadata) { '' } else { 'mp3 (confirmed in previous audit)' }
            audio_languages    = ''
            subtitle_tracks    = ''
            recommended_action = if ($isMacMetadata) { 'EXCLUDE_FROM_IMPORT' } else { 'TRANSCODE_TO_MP4_H264_AAC' }
            reason             = if ($isMacMetadata) { 'Metadato de macOS, no es contenido audiovisual.' } else { 'AVI con MPEG-4/MP3; requiere recodificación a H.264/AAC.' }
            bucket             = 'needs_preparation'
            probe_status       = 'CLASSIFIED_BY_PREVIOUS_AUDIT'
        }
        continue
    }

    [pscustomobject]@{
        relative_path      = $file.FullName.Substring($resolvedSource.Length).TrimStart('\')
        absolute_path      = $file.FullName
        extension          = $extension
        size_gib           = [math]::Round($file.Length / 1GB, 3)
        duration_minutes   = ''
        container          = ''
        video_codecs       = ''
        audio_codecs       = ''
        audio_languages    = ''
        subtitle_tracks    = ''
        recommended_action = 'INSPECT_MANUALLY'
        reason             = 'Contenedor no cubierto por la auditoría de preparación masiva.'
        bucket             = 'needs_preparation'
        probe_status       = 'NOT_PROBED'
    }
    continue

    try {
        $probeJson = & $FfprobePath -v error -show_entries format=duration,format_name -show_streams -of json -- $file.FullName
        $probe = $probeJson | ConvertFrom-Json
        $decision = Get-Recommendation -File $file -Probe $probe
        $subtitleCount = @($probe.streams | Where-Object { $_.codec_type -eq 'subtitle' }).Count

        [pscustomobject]@{
            relative_path      = $file.FullName.Substring($resolvedSource.Length).TrimStart('\')
            absolute_path      = $file.FullName
            extension          = $file.Extension.ToLowerInvariant()
            size_gib           = [math]::Round($file.Length / 1GB, 3)
            duration_minutes   = if ($probe.format.duration) { [math]::Round(([double]$probe.format.duration) / 60, 2) } else { '' }
            container          = $probe.format.format_name
            video_codecs       = Get-ProbeValue -Probe $probe -StreamType 'video' -Property 'codec_name'
            audio_codecs       = Get-ProbeValue -Probe $probe -StreamType 'audio' -Property 'codec_name'
            audio_languages    = (($probe.streams | Where-Object { $_.codec_type -eq 'audio' } | ForEach-Object { $_.tags.language } | Where-Object { $_ }) -join ';')
            subtitle_tracks    = $subtitleCount
            recommended_action = $decision.Action
            reason             = $decision.Reason
            bucket             = $decision.Bucket
            probe_status       = 'OK'
        }
    }
    catch {
        [pscustomobject]@{
            relative_path      = $file.FullName.Substring($resolvedSource.Length).TrimStart('\')
            absolute_path      = $file.FullName
            extension          = $file.Extension.ToLowerInvariant()
            size_gib           = [math]::Round($file.Length / 1GB, 3)
            duration_minutes   = ''
            container          = ''
            video_codecs       = ''
            audio_codecs       = ''
            audio_languages    = ''
            subtitle_tracks    = ''
            recommended_action = 'INSPECT_MANUALLY'
            reason             = $_.Exception.Message
            bucket             = 'needs_preparation'
            probe_status       = 'ERROR'
        }
    }
}

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$readyPath = Join-Path $resolvedOutput "ready_to_upload-$timestamp.csv"
$preparePath = Join-Path $resolvedOutput "needs_preparation-$timestamp.csv"

$rows | Where-Object { $_.bucket -eq 'ready_to_upload' } | Sort-Object relative_path | Export-Csv -LiteralPath $readyPath -NoTypeInformation -Encoding UTF8
$rows | Where-Object { $_.bucket -eq 'needs_preparation' } | Sort-Object relative_path | Export-Csv -LiteralPath $preparePath -NoTypeInformation -Encoding UTF8

$readyCount = @($rows | Where-Object { $_.bucket -eq 'ready_to_upload' }).Count
$prepareCount = @($rows | Where-Object { $_.bucket -eq 'needs_preparation' }).Count
Write-Host "Listos para subir: $readyCount -> $readyPath"
Write-Host "Requieren preparación: $prepareCount -> $preparePath"
