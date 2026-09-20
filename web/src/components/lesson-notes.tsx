"use client";

import { type CSSProperties, FormEvent, useEffect, useState } from "react";

import { Icon } from "@/components/icons";
import { toast } from "@/components/toaster";
import { formatPlayerTime } from "@/lib/media/player-time";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

type Note = { body: string; id: string; timestamp_seconds: number };
type LessonNotesProps = { lessonId: string; readSecond: () => number; seekTo: (seconds: number) => void };

export function LessonNotes({ lessonId, readSecond, seekTo }: LessonNotesProps) {
  const [body, setBody] = useState("");
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void createSupabaseBrowserClient()
      .from("lesson_notes")
      .select("id, body, timestamp_seconds")
      .eq("lesson_id", lessonId)
      .order("timestamp_seconds")
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) { toast("No se pudieron cargar tus notas.", "error"); setNotes([]); return; }
        setNotes((data ?? []) as Note[]);
      });
    return () => { cancelled = true; };
  }, [lessonId]);

  async function addNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = body.trim();
    if (!text) return;
    setSaving(true);
    const supabase = createSupabaseBrowserClient();
    // getSession lee la sesión local; evita un viaje de red solo para conocer el usuario.
    const { data: sessionData } = await supabase.auth.getSession();
    const userId = sessionData.session?.user.id;
    if (!userId) {
      toast("Tu sesión terminó. Inicia sesión de nuevo para guardar notas.", "error");
      setSaving(false);
      return;
    }
    const { data, error } = await supabase
      .from("lesson_notes")
      .insert({ body: text, lesson_id: lessonId, timestamp_seconds: Math.floor(readSecond()), user_id: userId })
      .select("id, body, timestamp_seconds")
      .single();
    if (error || !data) toast("No se pudo guardar la nota. Inténtalo de nuevo.", "error");
    else {
      setNotes((current) => [...(current ?? []), data as Note].sort((a, b) => a.timestamp_seconds - b.timestamp_seconds));
      setBody("");
      toast("Nota guardada en el segundo actual.", "success", 2500);
    }
    setSaving(false);
  }

  return (
    <div>
      <form className="notes-form" onSubmit={addNote}>
        <input aria-label="Nueva nota de la lección" className="input" onChange={(event) => setBody(event.target.value)} placeholder="Escribe una idea; se enlaza al segundo actual del vídeo" value={body} />
        <button className="btn btn-primary" disabled={saving || !body.trim()} type="submit"><Icon name="plus" />{saving ? "Guardando…" : "Añadir nota"}</button>
      </form>
      <div className="note-list">
        {notes === null ? [0, 1].map((key) => <div className="skeleton" key={key} style={{ height: 46 }} />) : null}
        {notes?.map((note, index) => (
          <button className="note-item" key={note.id} onClick={() => seekTo(note.timestamp_seconds)} style={{ animationDelay: `${index * 30}ms` } as CSSProperties} title="Ir a este momento" type="button">
            <span className="note-time">{formatPlayerTime(note.timestamp_seconds)}</span>
            <span>{note.body}</span>
          </button>
        ))}
        {notes && !notes.length ? <p className="muted" style={{ margin: 0 }}>Aún no hay notas en esta lección. Pausa en un momento clave y escribe la primera.</p> : null}
      </div>
    </div>
  );
}
