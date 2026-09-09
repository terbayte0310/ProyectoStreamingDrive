[CmdletBinding()]
param(
    [string]$SourceRoot = 'D:\NO_SUBIR',
    [string]$OutputDirectory = 'C:\Users\josep\Documents\ChatGPT\ProyectoStreamingDrive\outputs\media_inventory'
)

$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
$mediaExtensions = @('.mp4', '.m4v', '.mov', '.webm', '.mkv', '.avi', '.ts', '.flv', '.wmv', '.mpeg', '.mpg')
if (-not (Test-Path -LiteralPath $SourceRoot -PathType Container)) { throw "No existe: $SourceRoot" }
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null

$courseRoots = foreach ($category in Get-ChildItem -LiteralPath $SourceRoot -Directory) {
    foreach ($course in Get-ChildItem -LiteralPath $category.FullName -Directory) {
        [pscustomobject]@{ Category=$category.Name; Course=$course.Name; Path=$course.FullName }
    }
}

$details = foreach ($course in $courseRoots) {
    foreach ($file in Get-ChildItem -LiteralPath $course.Path -Recurse -File -Force) {
        $extension = $file.Extension.ToLowerInvariant()
        if ($file.Name.StartsWith('._')) {
            [pscustomobject]@{ Categoria=$course.Category; Curso=$course.Course; Ruta=$file.FullName; Relativa=$file.FullName.Substring($course.Path.Length).TrimStart('\'); Extension=$extension; Bytes=$file.Length; Tipo='AUXILIAR_MACOS'; Video=''; Audio=''; Estado='IGNORAR'; Motivo='Metadato AppleDouble.' }
            continue
        }
        if ($extension -notin $mediaExtensions) { continue }
        # Los .ts que quedan aquí son recursos TypeScript, no flujo MPEG-TS.
        # Los MPEG-TS de vídeo ya fueron reemplazados durante la preparación.
        if ($extension -eq '.ts') {
            [pscustomobject]@{ Categoria=$course.Category; Curso=$course.Course; Ruta=$file.FullName; Relativa=$file.FullName.Substring($course.Path.Length).TrimStart('\'); Extension=$extension; Bytes=$file.Length; Tipo='RECURSO_CODIGO'; Video=''; Audio=''; Estado='OK'; Motivo='Archivo TypeScript conservado como recurso.' }
            continue
        }
        if ($file.Length -eq 0) {
            [pscustomobject]@{ Categoria=$course.Category; Curso=$course.Course; Ruta=$file.FullName; Relativa=$file.FullName.Substring($course.Path.Length).TrimStart('\'); Extension=$extension; Bytes=$file.Length; Tipo='MEDIA'; Video=''; Audio=''; Estado='BLOQUEA'; Motivo='Archivo multimedia vacío.' }
            continue
        }
        $probeText = & ffprobe -v error -show_entries stream=codec_type,codec_name -of json -- $file.FullName 2>$null
        $probe = $null
        try { if ($LASTEXITCODE -eq 0 -and $probeText) { $probe = $probeText | ConvertFrom-Json } } catch { $probe = $null }
        if ($null -eq $probe -or $null -eq $probe.streams) {
            if ($extension -eq '.ts') {
                [pscustomobject]@{ Categoria=$course.Category; Curso=$course.Course; Ruta=$file.FullName; Relativa=$file.FullName.Substring($course.Path.Length).TrimStart('\'); Extension=$extension; Bytes=$file.Length; Tipo='RECURSO_CODIGO'; Video=''; Audio=''; Estado='OK'; Motivo='Archivo .ts no reconocible como vídeo; se conserva como recurso.' }
            } else {
                [pscustomobject]@{ Categoria=$course.Category; Curso=$course.Course; Ruta=$file.FullName; Relativa=$file.FullName.Substring($course.Path.Length).TrimStart('\'); Extension=$extension; Bytes=$file.Length; Tipo='MEDIA'; Video=''; Audio=''; Estado='BLOQUEA'; Motivo='ffprobe no reconoce medio válido.' }
            }
            continue
        }
        $video = @($probe.streams | Where-Object { $_.codec_type -eq 'video' } | ForEach-Object { $_.codec_name }) -join ';'
        $audio = @($probe.streams | Where-Object { $_.codec_type -eq 'audio' } | ForEach-Object { $_.codec_name }) -join ';'
        if ([string]::IsNullOrWhiteSpace($video)) {
            [pscustomobject]@{ Categoria=$course.Category; Curso=$course.Course; Ruta=$file.FullName; Relativa=$file.FullName.Substring($course.Path.Length).TrimStart('\'); Extension=$extension; Bytes=$file.Length; Tipo='RECURSO'; Video=''; Audio=$audio; Estado='OK'; Motivo='No contiene vídeo; no bloquea la carga.' }
        } elseif ($video -eq 'h264' -and ([string]::IsNullOrWhiteSpace($audio) -or $audio -eq 'aac')) {
            [pscustomobject]@{ Categoria=$course.Category; Curso=$course.Course; Ruta=$file.FullName; Relativa=$file.FullName.Substring($course.Path.Length).TrimStart('\'); Extension=$extension; Bytes=$file.Length; Tipo='MEDIA'; Video=$video; Audio=$audio; Estado='OK'; Motivo='Compatible con video HTML.' }
        } else {
            [pscustomobject]@{ Categoria=$course.Category; Curso=$course.Course; Ruta=$file.FullName; Relativa=$file.FullName.Substring($course.Path.Length).TrimStart('\'); Extension=$extension; Bytes=$file.Length; Tipo='MEDIA'; Video=$video; Audio=$audio; Estado='BLOQUEA'; Motivo='Códecs no compatibles: se requiere H.264 y AAC.' }
        }
    }
}

$courseReport = foreach ($course in $courseRoots) {
    $items = @($details | Where-Object { $_.Categoria -eq $course.Category -and $_.Curso -eq $course.Course })
    $blockers = @($items | Where-Object Estado -eq 'BLOQUEA')
    [pscustomobject]@{
        Categoria=$course.Category; Curso=$course.Course; RutaActual=$course.Path; Estado=if($blockers.Count){'REVISAR'}else{'LISTO PARA SUBIR'};
        VideosCompatibles=@($items | Where-Object { $_.Tipo -eq 'MEDIA' -and $_.Estado -eq 'OK' }).Count;
        RecursosConservados=@($items | Where-Object { $_.Tipo -in 'RECURSO_CODIGO','RECURSO' }).Count;
        Bloqueos=$blockers.Count; DetalleBloqueos=($blockers.Motivo | Sort-Object -Unique) -join '; '
    }
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$detailsPath = Join-Path $OutputDirectory "auditoria_final_archivos-$stamp.csv"
$coursesPath = Join-Path $OutputDirectory "auditoria_final_cursos-$stamp.csv"
$details | Export-Csv -LiteralPath $detailsPath -NoTypeInformation -Encoding UTF8
$courseReport | Export-Csv -LiteralPath $coursesPath -NoTypeInformation -Encoding UTF8
Write-Host "Cursos listos: $(@($courseReport | Where-Object Estado -eq 'LISTO PARA SUBIR').Count). Revisar: $(@($courseReport | Where-Object Estado -eq 'REVISAR').Count)."
Write-Host "Detalle: $detailsPath"
Write-Host "Cursos: $coursesPath"
