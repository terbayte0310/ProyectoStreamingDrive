"use client";

type ConfirmOptions = { body: string; cancelLabel?: string; confirmLabel?: string; danger?: boolean; title: string };

/**
 * Sustituye window.confirm por un <dialog> nativo con el estilo de Nébula.
 * Imperativo a propósito: se puede llamar desde cualquier manejador sin
 * montar proveedores, y el foco queda atrapado por el propio navegador.
 */
export function confirmDialog({ body, cancelLabel = "Cancelar", confirmLabel = "Continuar", danger = false, title }: ConfirmOptions) {
  return new Promise<boolean>((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "dialog";
    const content = document.createElement("div");
    content.className = "dialog-body";
    const heading = document.createElement("h2");
    heading.className = "title-m";
    heading.textContent = title;
    const text = document.createElement("p");
    text.textContent = body;
    content.append(heading, text);

    const actions = document.createElement("div");
    actions.className = "dialog-actions";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "btn btn-ghost";
    cancel.textContent = cancelLabel;
    const accept = document.createElement("button");
    accept.type = "button";
    accept.className = danger ? "btn btn-danger" : "btn btn-primary";
    accept.textContent = confirmLabel;
    actions.append(cancel, accept);
    dialog.append(content, actions);

    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      dialog.close();
      dialog.remove();
      resolve(value);
    };
    cancel.addEventListener("click", () => finish(false));
    accept.addEventListener("click", () => finish(true));
    dialog.addEventListener("cancel", (event) => { event.preventDefault(); finish(false); });
    dialog.addEventListener("click", (event) => { if (event.target === dialog) finish(false); });
    document.body.append(dialog);
    dialog.showModal();
    (danger ? cancel : accept).focus();
  });
}
