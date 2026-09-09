[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$SourceRoot = 'D:\NO_SUBIR',
    [string]$DestinationRoot = 'D:\SUBIR',
    [string]$LogDirectory = 'C:\Users\josep\Documents\ChatGPT\ProyectoStreamingDrive\outputs\media_inventory\conversion_logs'
)

$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $SourceRoot -PathType Container)) { throw "No existe: $SourceRoot" }
New-Item -ItemType Directory -Force -Path $DestinationRoot, $LogDirectory | Out-Null

$plan = foreach ($category in Get-ChildItem -LiteralPath $SourceRoot -Directory) {
    foreach ($course in Get-ChildItem -LiteralPath $category.FullName -Directory) {
        $destinationCategory = Join-Path $DestinationRoot $category.Name
        $destination = Join-Path $destinationCategory $course.Name
        if (Test-Path -LiteralPath $destination) { throw "Colisión: ya existe $destination" }
        [pscustomobject]@{ Categoria=$category.Name; Curso=$course.Name; Origen=$course.FullName; Destino=$destination; RutaCategoriaDestino=$destinationCategory }
    }
}
if ($plan.Count -eq 0) { throw 'No hay cursos para mover.' }

$results = foreach ($item in $plan) {
    try {
        if ($PSCmdlet.ShouldProcess($item.Origen, "mover curso completo a $($item.Destino)")) {
            New-Item -ItemType Directory -Force -Path $item.RutaCategoriaDestino | Out-Null
            Move-Item -LiteralPath $item.Origen -Destination $item.Destino -ErrorAction Stop
        }
        [pscustomobject]@{ Categoria=$item.Categoria; Curso=$item.Curso; Origen=$item.Origen; Destino=$item.Destino; Estado='OK'; Error='' }
    }
    catch { [pscustomobject]@{ Categoria=$item.Categoria; Curso=$item.Curso; Origen=$item.Origen; Destino=$item.Destino; Estado='ERROR'; Error=$_.Exception.Message } }
}
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$resultPath = Join-Path $LogDirectory "traslado_cursos_aprobados-$stamp.csv"
$results | Export-Csv -LiteralPath $resultPath -NoTypeInformation -Encoding UTF8
$errors = @($results | Where-Object Estado -eq 'ERROR').Count
Write-Host "Movidos: $(@($results | Where-Object Estado -eq 'OK').Count). Errores: $errors. Resultado: $resultPath"
if ($errors -gt 0) { exit 2 }
