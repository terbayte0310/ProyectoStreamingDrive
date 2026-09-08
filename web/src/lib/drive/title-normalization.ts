// Normaliza el título mostrado en catálogo a partir del nombre crudo de Drive.
// Nunca toca Drive: `detected_name` conserva siempre el nombre real del archivo/carpeta.
// Un admin puede sobrescribir el resultado con `custom_title`, que esta función jamás produce ni modifica.

const LEADING_NUMERIC_PREFIX = /^\d{1,3}[\s._-]+(?=\S)/;
// Solo convierte "_"/"-" a espacio cuando pegan dos palabras (p. ej. "guia-rapida"),
// no cuando ya se usan como separador visual entre palabras ("Módulo 1 - Fundamentos").
const WORD_JOINING_SEPARATORS = /(?<=\S)[_-]+(?=\S)/g;
const EXTRA_WHITESPACE = /\s+/g;
const ONLY_SEPARATOR_CHARS = /^[\s._-]*$/;

function stripExtension(name: string) {
  const lastDot = name.lastIndexOf(".");
  if (lastDot <= 0) return name;
  const extension = name.slice(lastDot + 1);
  // Evita cortar nombres sin extensión real, p. ej. "Versión 2.0" o "Node.js".
  if (extension.length === 0 || extension.length > 5 || /\s/.test(extension)) return name;
  return name.slice(0, lastDot);
}

export function normalizeDetectedTitle(rawName: string, isFolder: boolean): string {
  let title = isFolder ? rawName : stripExtension(rawName);
  title = title.replace(LEADING_NUMERIC_PREFIX, "");
  title = title.replace(WORD_JOINING_SEPARATORS, " ");
  title = title.replace(EXTRA_WHITESPACE, " ").trim();
  return title.length > 0 && !ONLY_SEPARATOR_CHARS.test(title) ? title : rawName;
}
