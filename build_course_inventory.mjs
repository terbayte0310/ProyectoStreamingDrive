import fs from "node:fs/promises";
import path from "node:path";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const coursesRoot = "D:\\Cursos";
const outputDir = path.join(process.cwd(), "outputs", "course_inventory");
const outputPath = path.join(outputDir, "Inventario_de_cursos.xlsx");
const ignoredRoots = new Set([".icons"]);
const mediaExtensions = new Set([".mp4", ".mkv", ".avi", ".mov", ".webm", ".m4v", ".mp3", ".wav", ".m4a"]);

function proposedPriority(category) {
  const high = new Set(["React", "Next", "JavaScript", "Typescript", "Python", "Git", "Docker", "SQL", "AWS", "Nest"]);
  const medium = new Set(["Angular", "Java", "Spring", "Vue", "CI_CD", "Terminal", "SOLID", "SCRUM", "Redes"]);
  if (high.has(category)) return ["Alta", "Tecnología directamente útil para la primera versión de la aplicación."];
  if (medium.has(category)) return ["Media", "Base técnica útil, pero no imprescindible para el primer producto."];
  return ["Por decidir", "Requiere priorización personal según objetivos de aprendizaje."];
}

async function walk(directory, relative = "") {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    const nextRelative = relative ? path.join(relative, entry.name) : entry.name;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const children = await walk(fullPath, nextRelative);
      result.push({ type: "Directory", fullPath, relative: nextRelative, name: entry.name, children });
    } else {
      const stat = await fs.stat(fullPath);
      result.push({ type: "File", fullPath, relative: nextRelative, name: entry.name, extension: path.extname(entry.name).toLowerCase(), size: stat.size });
    }
  }
  return result;
}

function flatten(nodes, directories = [], files = []) {
  for (const node of nodes) {
    if (node.type === "Directory") {
      directories.push(node);
      flatten(node.children, directories, files);
    } else files.push(node);
  }
  return { directories, files };
}

function metrics(node) {
  const { directories, files } = flatten(node.children);
  const ownFiles = node.children.filter((item) => item.type === "File");
  const allFiles = [...ownFiles, ...files];
  return {
    topicCount: node.children.filter((item) => item.type === "Directory").length,
    directoryCount: directories.length + 1,
    fileCount: allFiles.length,
    mediaCount: allFiles.filter((file) => mediaExtensions.has(file.extension)).length,
    totalBytes: allFiles.reduce((sum, file) => sum + file.size, 0),
  };
}

function gb(bytes) { return Number((bytes / 1024 ** 3).toFixed(2)); }
function timestamp() { return new Date(); }

const tree = await walk(coursesRoot);
const categories = tree.filter((item) => item.type === "Directory" && !ignoredRoots.has(item.name));
const all = flatten(categories);
const courseRows = [];
const topicRows = [];
const directoryRows = [];

for (const category of categories) {
  const [urgency, rationale] = proposedPriority(category.name);
  const directCourses = category.children.filter((item) => item.type === "Directory");
  for (const course of directCourses) {
    const courseMetrics = metrics(course);
    courseRows.push([
      category.name, course.name, course.relative, courseMetrics.topicCount, courseMetrics.mediaCount,
      courseMetrics.fileCount, gb(courseMetrics.totalBytes), urgency, rationale, "Por definir", "No iniciado"
    ]);
    const topics = course.children.filter((item) => item.type === "Directory");
    for (const topic of topics) {
      const topicMetrics = metrics(topic);
      topicRows.push([
        category.name, course.name, topic.name, topic.relative, topicMetrics.topicCount,
        topicMetrics.mediaCount, topicMetrics.fileCount, gb(topicMetrics.totalBytes), urgency, "Por definir", "No iniciado"
      ]);
    }
  }
}

for (const directory of all.directories) {
  const parts = directory.relative.split(path.sep);
  const directItems = directory.children;
  const directFiles = directItems.filter((item) => item.type === "File");
  directoryRows.push([
    parts[0] ?? "", parts[1] ?? "", parts[2] ?? "", directory.relative,
    parts.length, directItems.filter((item) => item.type === "Directory").length,
    directFiles.length, gb(directFiles.reduce((sum, file) => sum + file.size, 0))
  ]);
}

courseRows.sort((a, b) => a[0].localeCompare(b[0], "es") || a[1].localeCompare(b[1], "es"));
topicRows.sort((a, b) => a[0].localeCompare(b[0], "es") || a[1].localeCompare(b[1], "es") || a[2].localeCompare(b[2], "es"));
directoryRows.sort((a, b) => a[3].localeCompare(b[3], "es"));

const categorySummary = categories.map((category) => {
  const summary = metrics(category);
  const [urgency] = proposedPriority(category.name);
  return [category.name, category.children.filter((item) => item.type === "Directory").length, summary.topicCount, summary.mediaCount, summary.fileCount, gb(summary.totalBytes), urgency];
}).sort((a, b) => a[0].localeCompare(b[0], "es"));

const workbook = Workbook.create();
const summarySheet = workbook.worksheets.add("Resumen");
const coursesSheet = workbook.worksheets.add("Cursos");
const topicsSheet = workbook.worksheets.add("Temas");
const directoriesSheet = workbook.worksheets.add("Directorios");

function title(sheet, text, subtitle, width) {
  sheet.getRange(`A1:${width}1`).merge();
  sheet.getRange("A1").values = [[text]];
  sheet.getRange("A2").values = [[subtitle]];
  sheet.getRange(`A1:${width}1`).format = { font: { name: "Arial", size: 14, bold: true, color: "#1F2937" } };
  sheet.getRange(`A2:${width}2`).format = { font: { name: "Arial", size: 10, italic: true, color: "#4B5563" } };
}

function styleTable(sheet, range, headerRange) {
  sheet.getRange(range).format.font = { name: "Arial", size: 10, color: "#1F2937" };
  sheet.getRange(headerRange).format = { fill: "#1F4E78", font: { name: "Arial", size: 10, bold: true, color: "#FFFFFF" }, horizontalAlignment: "center", verticalAlignment: "center", wrapText: true };
  sheet.getRange(headerRange).format.rowHeight = 30;
  sheet.getRange(range).format.verticalAlignment = "center";
  sheet.showGridLines = false;
}

title(summarySheet, "Inventario de cursos", "Origen: D:\\Cursos. La urgencia es una propuesta editable para la fase inicial de la aplicación.", "G");
summarySheet.getRange("A4:G4").values = [["Categoría", "Cursos", "Temas directos", "Archivos multimedia", "Archivos", "Tamaño (GB)", "Urgencia propuesta"]];
summarySheet.getRange(`A5:G${4 + categorySummary.length}`).values = categorySummary;
styleTable(summarySheet, `A4:G${4 + categorySummary.length}`, "A4:G4");
summarySheet.getRange("I4:J4").values = [["Indicador", "Valor"]];
summarySheet.getRange("I5:J10").values = [
  ["Categorías", categories.length], ["Cursos", courseRows.length], ["Temas", topicRows.length],
  ["Directorios", directoryRows.length], ["Archivos", all.files.length], ["Tamaño total (GB)", gb(all.files.reduce((sum, file) => sum + file.size, 0))]
];
styleTable(summarySheet, "I4:J10", "I4:J4");
summarySheet.getRange("F5:F200").format.numberFormat = "#,##0.00";
summarySheet.getRange("J5:J10").format.numberFormat = "#,##0.00";
summarySheet.getRange("A4:G4").format.borders = { preset: "outside", style: "thin", color: "#D1D5DB" };
summarySheet.getRange("I4:J10").format.borders = { preset: "outside", style: "thin", color: "#D1D5DB" };
summarySheet.getRange("A1:J10").format.autofitColumns();
summarySheet.getRange("A2").format.columnWidth = 35;

title(coursesSheet, "Cursos", "Una fila por curso detectado. Completa Urgencia personal y Estado cuando definas tu plan de estudio.", "K");
coursesSheet.getRange("A4:K4").values = [["Categoría", "Curso", "Directorio relativo", "Temas", "Multimedia", "Archivos", "Tamaño (GB)", "Urgencia propuesta", "Criterio de propuesta", "Urgencia personal", "Estado"]];
if (courseRows.length) coursesSheet.getRange(`A5:K${4 + courseRows.length}`).values = courseRows;
styleTable(coursesSheet, `A4:K${4 + courseRows.length}`, "A4:K4");
coursesSheet.getRange(`G5:G${4 + courseRows.length}`).format.numberFormat = "#,##0.00";
coursesSheet.getRange(`J5:K${4 + courseRows.length}`).dataValidation = { rule: { type: "list", values: ["Por definir", "Alta", "Media", "Baja", "No aplica", "No iniciado", "En curso", "Terminado", "En pausa"] } };
coursesSheet.freezePanes.freezeRows(4);
coursesSheet.getRange(`A4:K${4 + courseRows.length}`).format.autofitColumns();
coursesSheet.getRange(`B5:B${4 + courseRows.length}`).format.columnWidth = 45;
coursesSheet.getRange(`C5:C${4 + courseRows.length}`).format.columnWidth = 52;
coursesSheet.getRange(`I5:I${4 + courseRows.length}`).format.columnWidth = 45;

title(topicsSheet, "Temas", "Una fila por subdirectorio de curso. Sirve como catálogo para navegación y progreso granular.", "K");
topicsSheet.getRange("A4:K4").values = [["Categoría", "Curso", "Tema", "Directorio relativo", "Subtemas", "Multimedia", "Archivos", "Tamaño (GB)", "Urgencia propuesta", "Urgencia personal", "Estado"]];
if (topicRows.length) topicsSheet.getRange(`A5:K${4 + topicRows.length}`).values = topicRows;
styleTable(topicsSheet, `A4:K${4 + topicRows.length}`, "A4:K4");
topicsSheet.getRange(`H5:H${4 + topicRows.length}`).format.numberFormat = "#,##0.00";
topicsSheet.getRange(`J5:K${4 + topicRows.length}`).dataValidation = { rule: { type: "list", values: ["Por definir", "Alta", "Media", "Baja", "No aplica", "No iniciado", "En curso", "Terminado", "En pausa"] } };
topicsSheet.freezePanes.freezeRows(4);
topicsSheet.getRange(`A4:K${4 + topicRows.length}`).format.autofitColumns();
topicsSheet.getRange(`B5:D${4 + topicRows.length}`).format.columnWidth = 42;

title(directoriesSheet, "Directorios", "Árbol completo de directorios de contenido. No incluye .icons ni archivos individuales.", "H");
directoriesSheet.getRange("A4:H4").values = [["Categoría", "Curso", "Tema", "Directorio relativo", "Nivel", "Subdirectorios directos", "Archivos directos", "Tamaño directo (GB)"]];
if (directoryRows.length) directoriesSheet.getRange(`A5:H${4 + directoryRows.length}`).values = directoryRows;
styleTable(directoriesSheet, `A4:H${4 + directoryRows.length}`, "A4:H4");
directoriesSheet.getRange(`H5:H${4 + directoryRows.length}`).format.numberFormat = "#,##0.00";
directoriesSheet.freezePanes.freezeRows(4);
directoriesSheet.getRange(`A4:H${4 + directoryRows.length}`).format.autofitColumns();
directoriesSheet.getRange(`D5:D${4 + directoryRows.length}`).format.columnWidth = 70;

for (const sheet of [coursesSheet, topicsSheet, directoriesSheet]) {
  sheet.getUsedRange().format.wrapText = true;
}

const inspection = await workbook.inspect({ kind: "table", range: "Cursos!A1:K12", include: "values,formulas", tableMaxRows: 12, tableMaxCols: 11 });
console.log(inspection.ndjson);
const errors = await workbook.inspect({ kind: "match", searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!", options: { useRegex: true, maxResults: 300 }, summary: "final formula error scan" });
console.log(errors.ndjson);
await fs.mkdir(outputDir, { recursive: true });
const preview = await workbook.render({ sheetName: "Resumen", range: "A1:J35", scale: 1.2, format: "png" });
await fs.writeFile(path.join(outputDir, "resumen_preview.png"), new Uint8Array(await preview.arrayBuffer()));
const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(outputPath);
console.log(JSON.stringify({ outputPath, categories: categories.length, courses: courseRows.length, topics: topicRows.length, directories: directoryRows.length, files: all.files.length, generatedAt: timestamp().toISOString() }));
