import fs from "node:fs/promises";
import path from "node:path";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const projectRoot = path.resolve(import.meta.dirname, "..");
const inventoryDir = path.join(projectRoot, "outputs", "media_inventory");
const readyCsv = path.join(inventoryDir, "ready_to_upload-20260908-120108.csv");
const needsCsv = path.join(inventoryDir, "needs_preparation-20260908-120108.csv");
const outputPath = path.join(inventoryDir, "plan_cursos_subida_20260908.xlsx");

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { value += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else value += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(value); value = ""; }
    else if (char === '\n') { row.push(value.replace(/\r$/, "")); rows.push(row); row = []; value = ""; }
    else value += char;
  }
  if (value.length || row.length) { row.push(value.replace(/\r$/, "")); rows.push(row); }
  const [rawHeaders, ...data] = rows;
  const headers = rawHeaders.map((header) => header.replace(/^\uFEFF/, ""));
  return data.filter((r) => r.length === headers.length).map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i]])));
}

function courseKey(relativePath) {
  const [category = "", course = ""] = relativePath.split("\\");
  return `${category}\\${course}`;
}

function parts(key) {
  const [category, course] = key.split("\\");
  return { category, course };
}

const [readyRows, needsRows] = await Promise.all([
  fs.readFile(readyCsv, "utf8").then(parseCsv),
  fs.readFile(needsCsv, "utf8").then(parseCsv),
]);

const courses = new Map();
function getCourse(key) {
  if (!courses.has(key)) {
    const { category, course } = parts(key);
    courses.set(key, { category, course, readyFiles: 0, blockedFiles: 0, blockedGiB: 0, actions: new Map() });
  }
  return courses.get(key);
}

for (const row of readyRows) {
  const course = getCourse(courseKey(row.relative_path));
  course.readyFiles += 1;
}
for (const row of needsRows) {
  const course = getCourse(courseKey(row.relative_path));
  course.blockedFiles += 1;
  course.blockedGiB += Number(row.size_gib || 0);
  course.actions.set(row.recommended_action, (course.actions.get(row.recommended_action) ?? 0) + 1);
}

const records = [...courses.values()].filter((course) => course.category !== "Pasados").map((course) => {
  const actions = [...course.actions.entries()].map(([action, count]) => `${action}: ${count}`).join("; ");
  const status = course.blockedFiles > 0 ? "NO SUBIR" : "SUBIR";
  return {
    Categoria: course.category,
    Curso: course.course,
    Estado: status,
    ArchivosListos: course.readyFiles,
    ArchivosBloqueantes: course.blockedFiles,
    GiBBloqueados: Number(course.blockedGiB.toFixed(3)),
    AccionesPendientes: actions || "Ninguna",
    RutaOrigen: `D:\\Cursos\\${course.category}\\${course.course}`,
    RutaDestinoPropuesta: `D:\\${status}\\${course.category}\\${course.course}`,
  };
}).sort((a, b) => a.Categoria.localeCompare(b.Categoria, "es") || a.Curso.localeCompare(b.Curso, "es"));

const upload = records.filter((r) => r.Estado === "SUBIR");
const hold = records.filter((r) => r.Estado === "NO SUBIR");
const sum = (rows, field) => rows.reduce((total, row) => total + Number(row[field] || 0), 0);

const workbook = Workbook.create();
const summary = workbook.worksheets.add("Resumen");
const uploadSheet = workbook.worksheets.add("Cursos SUBIR");
const holdSheet = workbook.worksheets.add("Cursos NO SUBIR");

for (const sheet of [summary, uploadSheet, holdSheet]) {
  sheet.showGridLines = false;
}

summary.getRange("A2:B10").values = [
  ["Plan de subida por curso", ""],
  ["Fecha de inventario", "8 de septiembre de 2026"],
  ["Regla", "Un curso pasa a NO SUBIR si contiene algún vídeo que requiera remux, recodificación o revisión."],
  ["Cursos listos para subir", upload.length],
  ["Cursos retenidos", hold.length],
  ["Vídeos listos en cursos de SUBIR", sum(upload, "ArchivosListos")],
  ["Archivos que requieren preparación", sum(hold, "ArchivosBloqueantes")],
  ["GiB a preparar antes de subir", Number(sum(hold, "GiBBloqueados").toFixed(2))],
  ["Separación propuesta", "Carpetas hermanas D:\\SUBIR y D:\\NO SUBIR; mantiene intacta la jerarquía Categoría > Curso."],
];
summary.getRange("A2:A10").format.font = { name: "Arial", size: 10, bold: true };
summary.getRange("A2:B2").format = { fill: "#1F4E78", font: { name: "Arial", size: 14, bold: true, color: "#FFFFFF" } };
summary.getRange("A3:B10").format.font = { name: "Arial", size: 10 };
summary.getRange("A3:B10").format.verticalAlignment = "center";
summary.getRange("A3:B10").format.wrapText = true;
summary.getRange("B6:B9").format.numberFormat = "#,##0.00";
summary.getRange("A2:B10").format.borders = { preset: "outside", style: "thin", color: "#B7C9D6" };
summary.getRange("A2:A10").format.columnWidth = 32;
summary.getRange("B2:B10").format.columnWidth = 82;
summary.getRange("A3:B10").format.rowHeight = 26;

const headers = ["Categoría", "Curso", "Estado", "Vídeos listos", "Archivos bloqueantes", "GiB bloqueados", "Acciones pendientes", "Ruta de origen", "Ruta de destino propuesta"];
function writeCourseSheet(sheet, rows, tableName, fill) {
  sheet.getRangeByIndexes(0, 0, 1, headers.length).values = [headers];
  if (rows.length) {
    sheet.getRangeByIndexes(1, 0, rows.length, headers.length).values = rows.map((r) => [
      r.Categoria, r.Curso, r.Estado, r.ArchivosListos, r.ArchivosBloqueantes, r.GiBBloqueados,
      r.AccionesPendientes, r.RutaOrigen, r.RutaDestinoPropuesta,
    ]);
  }
  const endRow = Math.max(2, rows.length + 1);
  const range = sheet.getRange(`A1:I${endRow}`);
  range.format.font = { name: "Arial", size: 10 };
  sheet.getRange("A1:I1").format = { fill, font: { name: "Arial", size: 10, bold: true, color: "#FFFFFF" } };
  sheet.getRange("A1:I1").format.horizontalAlignment = "center";
  sheet.getRange("A1:I1").format.verticalAlignment = "center";
  sheet.getRange(`D2:F${endRow}`).format.numberFormat = "#,##0.00";
  sheet.getRange(`A1:I${endRow}`).format.verticalAlignment = "center";
  sheet.getRange(`G2:I${endRow}`).format.wrapText = true;
  sheet.tables.add(`A1:I${endRow}`, true, tableName).style = "TableStyleMedium2";
  sheet.freezePanes.freezeRows(1);
  const widths = [18, 46, 14, 15, 20, 16, 42, 65, 65];
  widths.forEach((width, index) => { sheet.getRangeByIndexes(0, index, endRow, 1).format.columnWidth = width; });
}

writeCourseSheet(uploadSheet, upload, "CoursesUpload", "#2E7D32");
writeCourseSheet(holdSheet, hold, "CoursesHold", "#B71C1C");

workbook.recalculate();
await fs.mkdir(inventoryDir, { recursive: true });
const exported = await SpreadsheetFile.exportXlsx(workbook);
await exported.save(outputPath);

const check = await workbook.inspect({ kind: "table", range: "Resumen!A2:B10", include: "values", tableMaxRows: 12, tableMaxCols: 3 });
console.log(check.ndjson);
console.log(JSON.stringify({ outputPath, uploadCourses: upload.length, heldCourses: hold.length, blockedFiles: sum(hold, "ArchivosBloqueantes") }));
