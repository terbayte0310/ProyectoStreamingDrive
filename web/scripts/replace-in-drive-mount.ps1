# Sobrescribe, en la unidad de Google Drive para escritorio (G:), los MP4 originales
# con su version reempaquetada (ver faststart-courses.ps1). Al sobrescribir en el
# sitio, Drive sube una nueva version del MISMO archivo y conserva su ID.
#
# Lee un manifiesto JSON { curso: { gRoot, fixedRoot, entries: [{ rel, oldSize, newSize }] } }.
# Antes de tocar un archivo exige que en G: pese exactamente oldSize (o newSize, si ya
# se reemplazo) y que la version reempaquetada pese newSize. Se detiene al primer problema.
[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$Manifest,
  [Parameter(Mandatory)][string]$Course,
  [string]$LogPath = 'D:\_FASTSTART_CURSOS\drive-replace-log.jsonl'
)

$ErrorActionPreference = 'Stop'

$data = Get-Content -LiteralPath $Manifest -Raw -Encoding UTF8 | ConvertFrom-Json
$node = $data.$Course
if (-not $node) { throw "El curso '$Course' no esta en el manifiesto." }

function Write-Log($Entry) {
  ($Entry | ConvertTo-Json -Compress) | Add-Content -LiteralPath $LogPath -Encoding UTF8
}

$stats = @{ replaced = 0; already = 0 }
foreach ($entry in $node.entries) {
  $gPath = Join-Path $node.gRoot $entry.rel
  $fixedPath = Join-Path $node.fixedRoot $entry.rel

  if (-not (Test-Path -LiteralPath $gPath)) { throw "No existe en G: $($entry.rel)" }
  if (-not (Test-Path -LiteralPath $fixedPath)) { throw "No existe la version reempaquetada: $($entry.rel)" }

  $gSize = (Get-Item -LiteralPath $gPath).Length
  $fixedSize = (Get-Item -LiteralPath $fixedPath).Length
  if ($fixedSize -ne $entry.newSize) { throw "La version reempaquetada pesa $fixedSize y se esperaba $($entry.newSize): $($entry.rel)" }

  if ($gSize -eq $entry.newSize) { $stats.already++; continue }
  if ($gSize -ne $entry.oldSize) { throw "El archivo de G: pesa $gSize y se esperaba $($entry.oldSize): $($entry.rel)" }

  Copy-Item -LiteralPath $fixedPath -Destination $gPath -Force
  $after = (Get-Item -LiteralPath $gPath).Length
  if ($after -ne $entry.newSize) { throw "Tras copiar, G: pesa $after y se esperaba $($entry.newSize): $($entry.rel)" }

  $stats.replaced++
  Write-Log ([ordered]@{ course = $Course; file = $entry.rel; driveId = $entry.driveId; oldSize = $entry.oldSize; newSize = $entry.newSize; at = (Get-Date).ToString('s') })
}

Write-Host ("{0}: reemplazados={1} ya_estaban={2}" -f $Course, $stats.replaced, $stats.already)
