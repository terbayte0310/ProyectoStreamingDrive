[CmdletBinding(SupportsShouldProcess)]
param(
    [Parameter()]
    [string]$SourceRoot = 'D:\Cursos',

    [Parameter()]
    [string]$NeedsInventory,

    [Parameter()]
    [string]$DestinationParent = 'D:\',

    [Parameter()]
    [string[]]$ExcludedCategories = @('Pasados'),

    [switch]$Apply
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($NeedsInventory)) {
    $NeedsInventory = Join-Path (Split-Path -Parent $PSScriptRoot) 'outputs\media_inventory\needs_preparation-20260908-120108.csv'
}

if (-not (Test-Path -LiteralPath $SourceRoot -PathType Container)) {
    throw "No existe la biblioteca de origen: $SourceRoot"
}
if (-not (Test-Path -LiteralPath $NeedsInventory -PathType Leaf)) {
    throw "No existe el inventario de preparación: $NeedsInventory"
}
if (-not $Apply) {
    Write-Host 'Vista previa: no se moverá ningún curso. Añade -Apply cuando hayas revisado el plan.'
}

$blockedCourses = @{}
foreach ($row in Import-Csv -LiteralPath $NeedsInventory) {
    $parts = $row.relative_path -split '\\'
    if ($parts.Count -ge 2) {
        $blockedCourses["$($parts[0])\\$($parts[1])"] = $true
    }
}

$source = (Resolve-Path -LiteralPath $SourceRoot).Path
$destination = [System.IO.Path]::GetFullPath($DestinationParent)
$uploadRoot = Join-Path $destination 'SUBIR'
$holdRoot = Join-Path $destination 'NO_SUBIR'

$courses = foreach ($category in Get-ChildItem -LiteralPath $source -Directory -Force | Where-Object { -not $_.Name.StartsWith('.') -and $_.Name -notin $ExcludedCategories }) {
    foreach ($course in Get-ChildItem -LiteralPath $category.FullName -Directory -Force | Where-Object { -not $_.Name.StartsWith('.') }) {
        $key = "$($category.Name)\\$($course.Name)"
        $status = if ($blockedCourses.ContainsKey($key)) { 'NO_SUBIR' } else { 'SUBIR' }
        $destinationRoot = if ($status -eq 'SUBIR') { $uploadRoot } else { $holdRoot }
        [pscustomobject]@{
            Category = $category.Name
            Course = $course.Name
            Status = $status
            Source = $course.FullName
            Destination = Join-Path (Join-Path $destinationRoot $category.Name) $course.Name
        }
    }
}

foreach ($course in $courses | Sort-Object Status, Category, Course) {
    if (Test-Path -LiteralPath $course.Destination) {
        throw "El destino ya existe y no se tocará: $($course.Destination)"
    }
}

$courses | Group-Object Status | ForEach-Object {
    Write-Host "$($_.Name): $($_.Count) cursos"
}
$courses | Format-Table Status, Category, Course, Destination -AutoSize

if ($Apply) {
    foreach ($course in $courses | Sort-Object Status, Category, Course) {
        if ($PSCmdlet.ShouldProcess($course.Source, "Mover a $($course.Destination)")) {
            New-Item -ItemType Directory -Force -Path (Split-Path -Parent $course.Destination) | Out-Null
            Move-Item -LiteralPath $course.Source -Destination $course.Destination
        }
    }
}
