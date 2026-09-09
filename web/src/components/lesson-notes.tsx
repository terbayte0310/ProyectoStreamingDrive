"use client";

import { FormEvent, useEffect, useState } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

type Note = {
  body: string;
  id: string;
  timestamp_seconds: number;
};

type LessonNotesProps = {
  lessonId: string;
  readSecond: () => number;
  seekTo: (seconds: number) => void;
};

function formatTime(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${minutes}:${remainingSeconds}`;
}

export function LessonNotes({ lessonId, readSecond, seekTo }: LessonNotesProps) {
  const [body, setBody] = useState("");
  const [notes, setNotes] = useState<Note[]>([]);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const supabase = createSupabaseBrowserClient();

    void supabase
      .from("lesson_notes")
      .select("id, body, timestamp_seconds")
      .eq("lesson_id", lessonId)
      .order("timestamp_seconds")
      .then(({ data, error }) => {
        if (cancelled) return;

        if (error) {
          setLoadError("No se pudieron cargar tus notas.");
          return;
        }

        setLoadError("");
        setNotes((data ?? []) as Note[]);
      });

    return () => {
      cancelled = true;
    };
  }, [lessonId]);

  async function addNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = body.trim();
    if (!text) return;

    setSaving(true);
    const supabase = createSupabaseBrowserClient();
    const { data: userData } = await supabase.auth.getUser();

    if (!userData.user) {
      setLoadError("Tu sesión terminó. Inicia sesión de nuevo para guardar notas.");
      setSaving(false);
      return;
    }

    const newNote = {
      body: text,
      lesson_id: lessonId,
      timestamp_seconds: Math.floor(readSecond()),
      user_id: userData.user.id,
    };
    const { data, error } = await supabase
      .from("lesson_notes")
      .insert(newNote)
      .select("id, body, timestamp_seconds")
      .single();

    if (error) {
      setLoadError("No se pudo guardar la nota. Inténtalo de nuevo.");
    } else if (data) {
      setNotes((currentNotes) => [...currentNotes, data as Note]);
      setBody("");
      setLoadError("");
    }

    setSaving(false);
  }

  return (
    <section className="notes-panel">
      <h2 className="font-semibold">Notas</h2>
      <p className="mt-1 text-sm muted">
        La nota quedará enlazada al segundo actual del video.
      </p>

      <form className="notes-form" onSubmit={addNote}>
        <input
          className="notes-input"
          onChange={(event) => setBody(event.target.value)}
          placeholder="Añadir nota en el segundo actual…"
          value={body}
        />
        <button
          className="primary-button disabled:opacity-50"
          disabled={saving}
          type="submit"
        >
          {saving ? "Guardando…" : "Guardar"}
        </button>
      </form>

      {loadError && <p className="mt-3 text-sm text-rose-500">{loadError}</p>}

      <div className="mt-4 flex flex-col gap-2">
        {notes.length ? (
          notes.map((note) => (
            <button
              className="note-item"
              key={note.id}
              onClick={() => seekTo(note.timestamp_seconds)}
              type="button"
            >
              <span className="mr-2 font-semibold text-blue-500">
                {formatTime(note.timestamp_seconds)}
              </span>
              {note.body}
            </button>
          ))
        ) : (
          <p className="text-sm muted">Todavía no tienes notas en esta lección.</p>
        )}
      </div>
    </section>
  );
}
