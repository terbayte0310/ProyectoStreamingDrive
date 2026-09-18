import path from "node:path";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const workbookPath = path.resolve(process.cwd(), "../../outputs/dragon_ball_z/inventario_conversion_dragon_ball_z.xlsx");
const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(workbookPath));
const inventory = workbook.worksheets.getItem("Inventario");
inventory.getRange("M2:N292").values = Array.from({ length: 291 }, () => ["Convertido", "Validado"]);
workbook.recalculate();
const check = await workbook.inspect({ kind: "table", range: "Resumen!A6:B10", include: "values,formulas", tableMaxRows: 5, tableMaxCols: 2 });
console.log(check.ndjson);
const errors = await workbook.inspect({ kind: "match", searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!", options: { useRegex: true, maxResults: 50 }, summary: "formula error scan" });
console.log(errors.ndjson);
const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(workbookPath);
