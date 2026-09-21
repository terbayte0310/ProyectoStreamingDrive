/**
 * Relevo de la portada entre el catálogo y el esqueleto de la ficha.
 *
 * Al pulsar una portada, la ficha aún no ha llegado y Next pinta primero su
 * esqueleto. Si el esqueleto no tuviera portada, la del catálogo no tendría con
 * quién emparejarse: desaparecería y volvería a aparecer cuando llegan los datos.
 * Aquí se guarda, al pulsar, la imagen que el usuario está viendo (la URL exacta,
 * ya en la caché del navegador) para que el esqueleto la muestre y el morfismo
 * arranque desde el primer instante.
 *
 * Vive en memoria del cliente: no persiste ni se envía a ningún sitio.
 */
export type PosterHandoff = { id: string; src: string; title: string };

let current: PosterHandoff | null = null;

export function rememberPoster(handoff: PosterHandoff) {
  current = handoff;
}

/** La portada recordada, solo si corresponde a esa ficha. */
export function recallPoster(id: string): PosterHandoff | null {
  return current && current.id === id ? current : null;
}
