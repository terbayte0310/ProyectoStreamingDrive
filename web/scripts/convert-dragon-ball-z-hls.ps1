[CmdletBinding()]
param(
  [ValidateSet('Pilot', 'All')]
  [string]$Mode = 'Pilot',
  [int]$StartEpisode = 1,
  [int]$EndEpisode = 291
)

$ErrorActionPreference = 'Stop'

$seriesCode = 'SER-00004'
$sourceRoot = 'I:\DragonBallZ'
$outputRoot = 'I:\_HLS_VALIDATED\DragonBallZ'
$ffmpeg = 'C:\Users\josep\scoop\shims\ffmpeg.exe'
$ffprobe = 'C:\Users\josep\scoop\shims\ffprobe.exe'
$logPath = Join-Path $outputRoot 'conversion-log.jsonl'

function Get-SagaFolder([int]$Episode) {
  if ($Episode -le 35) { return '1 Saga Sayayin' }
  if ($Episode -le 107) { return '2 Saga Freezer' }
  if ($Episode -le 117) { return '3 Saga Garlick Jr' }
  if ($Episode -le 199) { return '4 Saga Androides' }
  return '5 Saga Majin Boo'
}

function Get-EpisodeCode([int]$Episode) {
  return "$seriesCode-S01-E$($Episode.ToString('000'))"
}

function Get-DurationSeconds([string]$Playlist) {
  $duration = & $ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 -- $Playlist
  if ($LASTEXITCODE -ne 0 -or -not $duration) { throw "No se pudo leer la duración HLS: $Playlist" }
  return [double]::Parse(($duration | Select-Object -First 1), [Globalization.CultureInfo]::InvariantCulture)
}

if (-not (Test-Path -LiteralPath $ffmpeg)) { throw "No se encontró ffmpeg en $ffmpeg" }
if (-not (Test-Path -LiteralPath $ffprobe)) { throw "No se encontró ffprobe en $ffprobe" }
if (-not (Test-Path -LiteralPath $sourceRoot)) { throw "No se encontró la fuente $sourceRoot" }

New-Item -ItemType Directory -Force -Path $outputRoot | Out-Null

$episodes = if ($Mode -eq 'Pilot') { @(1) } else { @($StartEpisode..$EndEpisode) }

foreach ($episode in $episodes) {
  if ($episode -lt 1 -or $episode -gt 291) { throw "Episodio fuera de rango: $episode" }
  $code = Get-EpisodeCode $episode
  $sagaFolder = Get-SagaFolder $episode
  $source = Join-Path (Join-Path $sourceRoot $sagaFolder) ($episode.ToString('000') + '.mkv')
  $package = Join-Path (Join-Path $outputRoot $seriesCode) $code
  $videoDirectory = Join-Path $package 'video'
  $audioDirectory = Join-Path $package 'audio\es'
  $videoPlaylist = Join-Path $videoDirectory 'index.m3u8'
  $audioPlaylist = Join-Path $audioDirectory 'index.m3u8'
  $masterPlaylist = Join-Path $package 'master.m3u8'

  if (-not (Test-Path -LiteralPath $source)) { throw "No se encontró el original: $source" }
  if (Test-Path -LiteralPath $package) { throw "El paquete ya existe y no será sobrescrito: $package" }

  New-Item -ItemType Directory -Force -Path $videoDirectory,$audioDirectory | Out-Null
  $audioMode = if ($episode -ge 254 -and $episode -le 263) { 'transcode-aac' } else { 'copy-aac' }

  try {
    & $ffmpeg -hide_banner -n -i $source -map 0:v:0 -c:v copy -an -f hls -hls_time 6 -hls_playlist_type vod -hls_flags independent_segments -hls_segment_filename (Join-Path $videoDirectory 'segment_%05d.ts') $videoPlaylist
    if ($LASTEXITCODE -ne 0) { throw "FFmpeg falló al crear vídeo." }

    if ($audioMode -eq 'transcode-aac') {
      & $ffmpeg -hide_banner -n -i $source -map 0:a:0 -vn -c:a aac -b:a 192k -f hls -hls_time 6 -hls_playlist_type vod -hls_segment_filename (Join-Path $audioDirectory 'segment_%05d.ts') $audioPlaylist
    } else {
      & $ffmpeg -hide_banner -n -i $source -map 0:a:0 -vn -c:a copy -f hls -hls_time 6 -hls_playlist_type vod -hls_segment_filename (Join-Path $audioDirectory 'segment_%05d.ts') $audioPlaylist
    }
    if ($LASTEXITCODE -ne 0) { throw "FFmpeg falló al crear audio." }

    $masterLines = [string[]]@(
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio-es",NAME="Español Latino",LANGUAGE="es",DEFAULT=YES,AUTOSELECT=YES,URI="audio/es/index.m3u8"',
      '#EXT-X-STREAM-INF:BANDWIDTH=6000000,AUDIO="audio-es"',
      'video/index.m3u8'
    )
    [System.IO.File]::WriteAllLines($masterPlaylist, $masterLines, (New-Object System.Text.UTF8Encoding($false)))

    foreach ($requiredPath in @($masterPlaylist, $videoPlaylist, $audioPlaylist)) {
      if (-not (Test-Path -LiteralPath $requiredPath)) { throw "Falta el archivo requerido: $requiredPath" }
    }
    $videoDuration = Get-DurationSeconds $videoPlaylist
    $audioDuration = Get-DurationSeconds $audioPlaylist
    if ([math]::Abs($videoDuration - $audioDuration) -gt 5) { throw "Las duraciones HLS no coinciden (vídeo $videoDuration s, audio $audioDuration s)." }

    [pscustomobject]@{
      code = $code
      source = $source
      package = $package
      convertedAt = (Get-Date).ToString('o')
      audioMode = $audioMode
      videoDurationSeconds = [math]::Round($videoDuration, 3)
      audioDurationSeconds = [math]::Round($audioDuration, 3)
      status = 'Convertido'
    } | ConvertTo-Json -Compress | Add-Content -LiteralPath $logPath -Encoding utf8
    Write-Host "$code listo · vídeo $([math]::Round($videoDuration, 1)) s · audio $([math]::Round($audioDuration, 1)) s"
  } catch {
    [pscustomobject]@{
      code = $code
      source = $source
      package = $package
      convertedAt = (Get-Date).ToString('o')
      status = 'Error'
      error = $_.Exception.Message
    } | ConvertTo-Json -Compress | Add-Content -LiteralPath $logPath -Encoding utf8
    throw
  }
}
