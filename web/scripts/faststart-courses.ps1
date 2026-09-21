# Reempaqueta (sin recodificar) los MP4 de cursos cuyo indice `moov` esta al final
# o cuyo video viene troceado en muchos bloques `mdat`. Chrome recorre esos bloques
# con una peticion a Drive por cada uno (~1-2 s cada una), asi que un curso puede
# tardar 25-90 s en arrancar. El resultado tiene un solo `mdat` y `moov` al inicio.
#
# Solo LEE de $SourceRoot. Escribe en $OutputRoot y verifica cada archivo antes de
# darlo por bueno. Se puede volver a ejecutar: los ya verificados se omiten.
# Los MP4 que ya tienen buena estructura se omiten: solo se reempaquetan los que la necesitan.
#
# Uso con un curso nuevo (antes de subirlo a Drive):
#   .\faststart-courses.ps1 -CoursePath 'D:\Subidos\Categoria\Curso' -CheckOnly   # solo revisa, no escribe
#   .\faststart-courses.ps1 -CoursePath 'D:\Subidos\Categoria\Curso' -Mode All    # reempaqueta los que hagan falta
# Detalles y motivo: docs/planificacion/08-preparacion-de-biblioteca-para-drive.md
[CmdletBinding()]
param(
  [ValidateSet('Pilot', 'All')]
  [string]$Mode = 'Pilot',
  [string]$SourceRoot = 'D:\Subidos',
  [string]$OutputRoot = 'D:\_FASTSTART_CURSOS',
  [string]$Course = '',
  [string]$CoursePath = '',
  [switch]$CheckOnly
)

$ErrorActionPreference = 'Stop'

$ffmpeg = 'C:\Users\josep\scoop\shims\ffmpeg.exe'
$ffprobe = 'C:\Users\josep\scoop\shims\ffprobe.exe'
$logPath = Join-Path $OutputRoot 'faststart-log.jsonl'
$maxDurationDelta = 0.5

# Cursos con estructura lenta detectada en Drive (rutas relativas a $SourceRoot).
$coursePatterns = @(
  'Cocina\Corissants*',
  'SOLID\Vibe Coding*',
  'Spring\Spring Boot 4*',
  'React\React+Sockets*',
  'Joyas\DI334*',
  'Joyas\DI337*'
)

function Get-TopLevelBoxes([string]$Path) {
  $stream = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
  try {
    $boxes = New-Object System.Collections.Generic.List[object]
    $header = New-Object byte[] 16
    $offset = [uint64]0
    $total = [uint64]$stream.Length
    while ($offset -lt $total -and $boxes.Count -lt 5000) {
      $stream.Seek([int64]$offset, [IO.SeekOrigin]::Begin) | Out-Null
      $read = $stream.Read($header, 0, 16)
      if ($read -lt 8) { break }
      $size = ([uint64]$header[0] -shl 24) -bor ([uint64]$header[1] -shl 16) -bor ([uint64]$header[2] -shl 8) -bor [uint64]$header[3]
      $type = [Text.Encoding]::ASCII.GetString($header, 4, 4)
      if ($size -eq 1 -and $read -ge 16) {
        $size = [uint64]0
        for ($i = 8; $i -lt 16; $i++) { $size = ($size -shl 8) -bor [uint64]$header[$i] }
      } elseif ($size -eq 0) {
        $size = $total - $offset
      }
      if ($size -lt 8) { break }
      $boxes.Add([pscustomobject]@{ Type = $type; Offset = $offset })
      $offset += $size
    }
    return $boxes
  } finally { $stream.Dispose() }
}

# 'ok' = un solo mdat con moov antes. Cualquier otra cosa hace lento el arranque en Drive.
function Get-Layout([string]$Path) {
  $boxes = Get-TopLevelBoxes $Path
  $mdat = @($boxes | Where-Object { $_.Type -eq 'mdat' })
  $moov = @($boxes | Where-Object { $_.Type -eq 'moov' })
  if ($mdat.Count -eq 0 -or $moov.Count -eq 0) { return 'no-mp4-estandar' }
  if ($mdat.Count -gt 1) { return 'varios-mdat' }
  if ($moov[0].Offset -gt $mdat[0].Offset) { return 'moov-al-final' }
  return 'ok'
}

function Get-ProbeInfo([string]$Path) {
  $json = & $ffprobe -v error -show_entries 'format=duration:stream=codec_type' -of json -- $Path
  if ($LASTEXITCODE -ne 0 -or -not $json) { throw "ffprobe no pudo leer: $Path" }
  $info = ($json -join "`n") | ConvertFrom-Json
  $duration = [double]::Parse([string]$info.format.duration, [Globalization.CultureInfo]::InvariantCulture)
  $streams = ($info.streams | ForEach-Object { $_.codec_type } | Sort-Object) -join ','
  return [pscustomobject]@{ Duration = $duration; Streams = $streams }
}

# Devuelve $null si el archivo es correcto, o el motivo del rechazo.
function Test-Faststart([string]$Source, [string]$Candidate) {
  $boxes = Get-TopLevelBoxes $Candidate
  $mdat = @($boxes | Where-Object { $_.Type -eq 'mdat' })
  $moov = @($boxes | Where-Object { $_.Type -eq 'moov' })
  if ($mdat.Count -ne 1) { return "mdat=$($mdat.Count), se esperaba 1" }
  if ($moov.Count -ne 1) { return "moov=$($moov.Count), se esperaba 1" }
  if ($moov[0].Offset -gt $mdat[0].Offset) { return 'moov quedo despues de mdat' }
  $a = Get-ProbeInfo $Source
  $b = Get-ProbeInfo $Candidate
  if ($a.Streams -ne $b.Streams) { return "pistas distintas: [$($a.Streams)] vs [$($b.Streams)]" }
  if ([math]::Abs($a.Duration - $b.Duration) -gt $maxDurationDelta) { return "duracion distinta: $($a.Duration) vs $($b.Duration)" }
  return $null
}

function Write-Log($Entry) {
  ($Entry | ConvertTo-Json -Compress) | Add-Content -LiteralPath $logPath -Encoding UTF8
}

if (-not (Test-Path -LiteralPath $ffmpeg)) { throw "No se encontro ffmpeg en $ffmpeg" }
if (-not (Test-Path -LiteralPath $ffprobe)) { throw "No se encontro ffprobe en $ffprobe" }
if (-not (Test-Path -LiteralPath $SourceRoot)) { throw "No se encontro la fuente $SourceRoot" }

$sourceFull = [IO.Path]::GetFullPath($SourceRoot).TrimEnd('\') + '\'
$outputFull = [IO.Path]::GetFullPath($OutputRoot).TrimEnd('\') + '\'
if ($outputFull.StartsWith($sourceFull, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'La carpeta de salida no puede estar dentro de la fuente.'
}

if (-not $CheckOnly) { New-Item -ItemType Directory -Force -Path $OutputRoot | Out-Null }

if ($CoursePath) {
  if (-not (Test-Path -LiteralPath $CoursePath -PathType Container)) { throw "No existe la carpeta: $CoursePath" }
  $courseFolders = @(Get-Item -LiteralPath $CoursePath)
  $coursePathFull = [IO.Path]::GetFullPath($CoursePath).TrimEnd('\') + '\'
  if ($outputFull.StartsWith($coursePathFull, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'La carpeta de salida no puede estar dentro del curso.'
  }
} else {
  $courseFolders = foreach ($pattern in $coursePatterns) {
    $found = @(Get-Item -Path (Join-Path $SourceRoot $pattern) -ErrorAction SilentlyContinue | Where-Object { $_.PSIsContainer })
    if ($found.Count -ne 1) { throw "El patron '$pattern' debia coincidir con 1 carpeta y coincidio con $($found.Count)." }
    $found[0]
  }
  if ($Course) { $courseFolders = @($courseFolders | Where-Object { $_.Name -like "*$Course*" }) }
  if (-not $courseFolders) { throw "Ningun curso coincide con '$Course'." }
}

$stats = @{ ok = 0; skipped = 0; failed = 0 }
$layouts = @{}
foreach ($folder in $courseFolders) {
  # Get-ChildItem -LiteralPath ignora -Include, por eso se filtra la extension aparte.
  $videos = @(Get-ChildItem -LiteralPath $folder.FullName -Recurse -File | Where-Object { $_.Extension -ieq '.mp4' } | Sort-Object FullName)
  if ($Mode -eq 'Pilot' -and -not $CheckOnly) { $videos = @($videos | Select-Object -First 1) }
  Write-Host "== $($folder.Name): $($videos.Count) video(s)"

  foreach ($video in $videos) {
    $relative = $video.FullName.Substring($folder.FullName.Length).TrimStart('\')
    $target = Join-Path (Join-Path $OutputRoot $folder.Name) $relative
    $partial = "$target.part"
    if (-not $CheckOnly -and (Test-Path -LiteralPath $target)) { $stats.skipped++; continue }

    $layout = Get-Layout $video.FullName
    $layouts[$layout] = 1 + [int]$layouts[$layout]
    if ($layout -eq 'ok') { $stats.skipped++; continue }
    if ($CheckOnly) { Write-Host "  $layout  $relative"; continue }
    if ($layout -eq 'no-mp4-estandar') {
      $stats.failed++
      Write-Host "  REVISAR (no es un MP4 estandar)  $relative"
      Write-Log ([ordered]@{ status = 'failed'; course = $folder.Name; file = $relative; reason = $layout; at = (Get-Date).ToString('s') })
      continue
    }

    New-Item -ItemType Directory -Force -Path (Split-Path $target -Parent) | Out-Null
    if (Test-Path -LiteralPath $partial) { Remove-Item -LiteralPath $partial -Force }

    $reason = $null
    try {
      & $ffmpeg -v error -hide_banner -nostdin -n -i $video.FullName -map 0 -map_metadata 0 -c copy -movflags '+faststart' -f mp4 $partial
      if ($LASTEXITCODE -ne 0) { throw "ffmpeg salio con codigo $LASTEXITCODE" }
      $reason = Test-Faststart $video.FullName $partial
    } catch {
      $reason = $_.Exception.Message
    }

    if ($reason) {
      if (Test-Path -LiteralPath $partial) { Remove-Item -LiteralPath $partial -Force }
      $stats.failed++
      Write-Host "  FALLO  $relative -> $reason"
      Write-Log ([ordered]@{ status = 'failed'; course = $folder.Name; file = $relative; reason = $reason; at = (Get-Date).ToString('s') })
    } else {
      Move-Item -LiteralPath $partial -Destination $target
      $stats.ok++
      Write-Log ([ordered]@{ status = 'ok'; course = $folder.Name; file = $relative; sourceBytes = $video.Length; outputBytes = (Get-Item -LiteralPath $target).Length; at = (Get-Date).ToString('s') })
    }
  }
}

$summary = ($layouts.Keys | Sort-Object | ForEach-Object { "$_=$($layouts[$_])" }) -join ' '
if ($CheckOnly) {
  Write-Host "Revision (no se escribio nada): $summary"
  Write-Host "Cualquier estado distinto de 'ok' necesita reempaquetarse antes de subir a Drive."
  return
}
Write-Host ("Listo: ok={0} omitidos={1} fallidos={2}. Estructura original: {3}. Log: {4}" -f $stats.ok, $stats.skipped, $stats.failed, $summary, $logPath)
if ($stats.failed -gt 0) { exit 1 }
