export type TransferKind = "download" | "stream";

export class TransferRangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TransferRangeError";
  }
}

export function calculateTransferBytes(kind: TransferKind, range: string | null, fileSize: number) {
  if (!Number.isSafeInteger(fileSize) || fileSize <= 0) {
    throw new TransferRangeError("El archivo no tiene un tamaño válido para contabilizarlo.");
  }
  if (kind === "download" || !range) return fileSize;
  if (!range.startsWith("bytes=") || range.includes(",")) {
    throw new TransferRangeError("El rango solicitado no es compatible.");
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match || (!match[1] && !match[2])) {
    throw new TransferRangeError("El rango solicitado no es válido.");
  }

  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
      throw new TransferRangeError("El rango solicitado no es válido.");
    }
    return Math.min(suffixLength, fileSize);
  }

  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : fileSize - 1;
  if (
    !Number.isSafeInteger(start)
    || !Number.isSafeInteger(requestedEnd)
    || start < 0
    || requestedEnd < start
    || start >= fileSize
  ) {
    throw new TransferRangeError("El rango solicitado no es válido.");
  }
  return Math.min(requestedEnd, fileSize - 1) - start + 1;
}
