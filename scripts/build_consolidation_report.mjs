import fs from "node:fs/promises";
import path from "node:path";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const projectRoot = path.resolve(import.meta.dirname, "..");
const inventoryDir = path.join(projectRoot, "outputs", "media_inventory");
const preparedRoot = "D:\\PREPARADOS_MEDIA";
const sourceRoot = "D:\\NO_SUBIR";
const backupRoot = "D:\\RESPALDOS_MEDIA_ORIGINALES";
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "").replace("T", "-");
const outputPath = path.join(inventoryDir, `reporte_consolidacion_${stamp}.xlsx`);

async function filesRecursively(root) {
  const found = [];
  async function walk(directory) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith(".mp4")) found.push(full);
    }
  }
  await walk(root);
  return found;
}

async function exists(file) {
  try { return (await fs.stat(file)).isFile(); } catch { return false; }
}

const preparedFiles = (await filesRecursively(preparedRoot)).filter((file) => !file.includes("\\_control\\"));
const excludedControls = (await filesRecursively(preparedRoot)).filter((file) => file.includes("\\_control\\"));
const records = [];
for (const prepared of preparedFiles.sort((a, b) => a.localeCompare(b, "es"))) {
  const relative = path.relative(preparedRoot, prepared);
  const withoutExtension = relative.slice(0, -4);
  const candidates = [
    { source: path.join(sourceRoot, `${withoutExtension}.ts`), kind: "TS → MP4 (remux)" },
    { source: path.join(sourceRoot, `${withoutExtension}.avi`), kind: "AVI → MP4 (recodificado)" },
    { source: path.join(sourceRoot, relative), kind: "MP4 normalizado" },
  ];
  const match = [];
  for (const candidate of candidates) if (await exists(candidate.source)) match.push(candidate);
  const preparedSize = (await fs.stat(prepared)).size;
  const destination = path.join(sourceRoot, relative);
  const source = match[0]?.source ?? "";
  const status = match.length === 1 ? "LISTO PARA CONSOLIDAR" : match.length === 0 ? "REVISAR: origen no encontrado" : "REVISAR: más de un origen";
  records.push({
    Categoria: relative.split("\\")[0],
    Curso: relative.split("\\")[1] ?? "",
    Operacion: match[0]?.kind ?? "",
    Estado: status,
    TamanoGiB: Number((preparedSize / 1024 ** 3).toFixed(3)),
    OrigenActual: source,
    MP4Preparado: prepared,
    DestinoFinal: destination,
    RespaldoDelOriginal: source ? path.join(backupRoot, path.relative(sourceRoot, source)) : "",
    ColisionEnRespaldo: source ? await exists(path.join(backupRoot, path.relative(sourceRoot, source))) ? "Sí" : "No" : "",
    Nota: status === "LISTO PARA CONSOLIDAR" ? "Mover: origen → respaldo; MP4 preparado → destino final. Sin copias." : "No mover hasta revisión.",
  });
}

const courses = new Map();
for (const row of records) {
  const key = `${row.Categoria}\\${row.Curso}`;
  if (!courses.has(key)) courses.set(key, { Categoria: row.Categoria, Curso: row.Curso, Archivos: 0, Listos: 0, Revisar: 0, GiB: 0 });
  const course = courses.get(key);
  course.Archivos += 1;
  course.GiB += row.TamanoGiB;
  if (row.Estado === "LISTO PARA CONSOLIDAR") course.Listos += 1; else course.Revisar += 1;
}
const courseRows = [...courses.values()].sort((a, b) => a.Categoria.localeCompare(b.Categoria, "es") || a.Curso.localeCompare(b.Curso, "es")).map((r) => ({ ...r, GiB: Number(r.GiB.toFixed(3)), Estado: r.Revisar ? "REVISAR" : "LISTO" }));
const ready = records.filter((r) => r.Estado === "LISTO PARA CONSOLIDAR");
const review = records.filter((r) => r.Estado !== "LISTO PARA CONSOLIDAR");
const totalGiB = Number(records.reduce((total, row) => total + row.TamanoGiB, 0).toFixed(2));

const workbook = Workbook.create();
const summary = workbook.worksheets.add("Resumen");
const filesSheet = workbook.worksheets.add("Por archivo");
const coursesSheet = workbook.worksheets.add("Por curso");
const excludedSheet = workbook.worksheets.add("No consolidar");
for (const sheet of [summary, filesSheet, coursesSheet, excludedSheet]) sheet.showGridLines = false;

summary.getRange("A1:B12").values = [
  ["Reporte de consolidación", ""],
  ["Generado", new Date().toLocaleString("es-PE")],
  ["Regla", "No se copia: se mueve el original al respaldo y el MP4 preparado a su misma ubicación dentro del curso."],
  ["MP4 preparados analizados", records.length],
  ["Listos para consolidar", ready.length],
  ["Requieren revisión", review.length],
  ["Cursos implicados", courseRows.length],
  ["Tamaño de MP4 preparados", totalGiB],
  ["Espacio libre actual en D:", "Se verificará justo antes de ejecutar; este plan no crea una segunda copia."],
  ["Raíz final de cursos", sourceRoot],
  ["Respaldo de originales", backupRoot],
  ["Elementos de control excluidos", excludedControls.length],
];
summary.getRange("A1:B1").format = { fill: "#1F4E78", font: { name: "Arial", size: 14, bold: true, color: "#FFFFFF" } };
summary.getRange("A1:B12").format.font = { name: "Arial", size: 10 };
summary.getRange("A2:A12").format.font = { name: "Arial", size: 10, bold: true };
summary.getRange("A1:B12").format.wrapText = true;
summary.getRange("A1:A12").format.columnWidth = 31;
summary.getRange("B1:B12").format.columnWidth = 92;
summary.getRange("B8").format.numberFormat = "#,##0.00";

function writeTable(sheet, rows, columns, name, color, widths) {
  sheet.getRangeByIndexes(0, 0, 1, columns.length).values = [columns];
  if (rows.length) sheet.getRangeByIndexes(1, 0, rows.length, columns.length).values = rows.map((row) => columns.map((column) => row[column] ?? ""));
  const end = Math.max(2, rows.length + 1);
  sheet.getRangeByIndexes(0, 0, end, columns.length).format.font = { name: "Arial", size: 9 };
  sheet.getRangeByIndexes(0, 0, 1, columns.length).format = { fill: color, font: { name: "Arial", size: 9, bold: true, color: "#FFFFFF" } };
  sheet.getRangeByIndexes(0, 0, end, columns.length).format.verticalAlignment = "center";
  sheet.getRangeByIndexes(0, 0, end, columns.length).format.wrapText = true;
  sheet.tables.add(sheet.getRangeByIndexes(0, 0, end, columns.length), true, name).style = "TableStyleMedium2";
  sheet.freezePanes.freezeRows(1);
  widths.forEach((width, index) => { sheet.getRangeByIndexes(0, index, end, 1).format.columnWidth = width; });
}

const fileColumns = ["Categoria", "Curso", "Operacion", "Estado", "TamanoGiB", "OrigenActual", "MP4Preparado", "DestinoFinal", "RespaldoDelOriginal", "ColisionEnRespaldo", "Nota"];
writeTable(filesSheet, records, fileColumns, "ConsolidationFiles", "#2E7D32", [18, 36, 23, 27, 12, 60, 60, 60, 68, 18, 45]);
filesSheet.getRange(`E2:E${Math.max(2, records.length + 1)}`).format.numberFormat = "#,##0.000";
writeTable(coursesSheet, courseRows, ["Categoria", "Curso", "Estado", "Archivos", "Listos", "Revisar", "GiB"], "ConsolidationCourses", "#1565C0", [20, 48, 16, 14, 14, 14, 14]);
coursesSheet.getRange(`G2:G${Math.max(2, courseRows.length + 1)}`).format.numberFormat = "#,##0.000";
writeTable(excludedSheet, excludedControls.map((file) => ({ Archivo: file, Motivo: "Archivo de control de pruebas; no pertenece a un curso." })), ["Archivo", "Motivo"], "ExcludedControls", "#757575", [100, 55]);

workbook.recalculate();
await fs.mkdir(inventoryDir, { recursive: true });
const exported = await SpreadsheetFile.exportXlsx(workbook);
await exported.save(outputPath);
console.log(JSON.stringify({ outputPath, prepared: records.length, ready: ready.length, review: review.length, courses: courseRows.length, totalGiB, controlsExcluded: excludedControls.length }));
