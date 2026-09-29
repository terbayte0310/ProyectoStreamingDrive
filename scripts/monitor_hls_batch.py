#!/usr/bin/env python3
"""Terminal monitor for the 2026-09-22 HLS conversion batch."""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import subprocess
import sys
import time
import unicodedata
from datetime import datetime
from pathlib import Path


WORKSPACE = Path(__file__).resolve().parents[1]
ARTIFACTS = WORKSPACE / "outputs" / "media_inventory" / "pendientes_20260922"
INVENTORY = ARTIFACTS / "inventario_privado.csv"
EVENT_LOG = ARTIFACTS / "conversion-log.jsonl"
CURRENT_STATUS = ARTIFACTS / "estado_actual.txt"
HISTORY = ARTIFACTS / "historial_monitor.csv"
DEFAULT_PID = 26268
SUCCESS = {"convertido", "ya_validado"}
BAR_WIDTH = 38


def read_inventory() -> list[dict[str, str]]:
    with INVENTORY.open("r", encoding="utf-8-sig", newline="") as stream:
        return list(csv.DictReader(stream))


def read_events() -> list[dict]:
    if not EVENT_LOG.exists():
        return []
    events = []
    with EVENT_LOG.open("r", encoding="utf-8-sig") as stream:
        for line in stream:
            try:
                events.append(json.loads(line))
            except json.JSONDecodeError:
                continue  # ignore a final line while it is being appended
    return events


def process_is_running(pid: int) -> bool:
    if os.name != "nt":
        try:
            os.kill(pid, 0)
            return True
        except OSError:
            return False
    try:
        result = subprocess.run(
            ["tasklist", "/FI", f"PID eq {pid}", "/FO", "CSV", "/NH"],
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
        return str(pid) in result.stdout
    except (OSError, subprocess.TimeoutExpired):
        return False


def format_duration(seconds: float) -> str:
    seconds = max(0, int(seconds))
    hours, remainder = divmod(seconds, 3600)
    minutes, seconds = divmod(remainder, 60)
    return f"{hours:02d}:{minutes:02d}:{seconds:02d}"


def latest_events(events: list[dict]) -> dict[str, dict]:
    latest: dict[str, dict] = {}
    for event in events:
        code = event.get("code")
        if code:
            latest[code] = event
    return latest


def live_ffmpeg_details(pending_codes: set[str]) -> tuple[str, str]:
    candidates = [
        path
        for path in ARTIFACTS.glob("*.ffmpeg.log")
        if path.stem.removesuffix(".ffmpeg") in pending_codes
    ]
    if not candidates:
        return "", ""
    candidates.sort(key=lambda path: path.stat().st_mtime, reverse=True)
    log_path = candidates[0]
    try:
        content = log_path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return log_path.name.removesuffix(".ffmpeg.log"), ""
    code = log_path.name.removesuffix(".ffmpeg.log")
    time_match = re.findall(r"\btime=(\d{2}:\d{2}:\d{2}(?:\.\d+)?)", content)
    speed_match = re.findall(r"\bspeed=([\d.]+x)", content)
    details = f"FFmpeg {time_match[-1]}" if time_match else "FFmpeg preparando pista"
    if speed_match:
        details += f" · {speed_match[-1]}"
    return code, details


def collect_state(pid: int) -> dict:
    items = read_inventory()
    events = read_events()
    latest = latest_events(events)
    successful = [item for item in items if latest.get(item["CodigoInterno"], {}).get("status") in SUCCESS]
    failed = [item for item in items if latest.get(item["CodigoInterno"], {}).get("status") == "error"]
    pending = [item for item in items if item["CodigoInterno"] not in {x["CodigoInterno"] for x in successful + failed}]
    running = process_is_running(pid)
    current_code, ffmpeg_details = live_ffmpeg_details({item["CodigoInterno"] for item in pending}) if running else ("", "")
    current = next((item for item in pending if item["CodigoInterno"] == current_code), None)
    if current is None and running and pending:
        current = pending[0]
    last_event = events[-1] if events else {}
    percent = 100.0 * len(successful) / len(items) if items else 0.0
    finished = not running and not pending
    stopped_early = not running and bool(pending)
    return {
        "checked_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        "total": len(items),
        "successful": len(successful),
        "pending": len(pending),
        "errors": failed,
        "running": running,
        "finished": finished,
        "stopped_early": stopped_early,
        "percent": percent,
        "current": current,
        "ffmpeg_details": ffmpeg_details,
        "last_event": last_event,
        "latest": latest,
    }


def render(state: dict) -> str:
    total = state["total"]
    done = state["successful"]
    filled = round(BAR_WIDTH * done / total) if total else 0
    bar = "#" * filled + "." * (BAR_WIDTH - filled)
    current = state["current"]
    current_line = "Sin título activo"
    if current:
        current_line = f"{current['CodigoInterno']} · {current['Titulo']}"
        if current.get("Episodio"):
            current_line += f" · episodio {current['Episodio']}"
    if state["finished"]:
        status = "COMPLETADA"
    elif state["stopped_early"]:
        status = "DETENIDA · revisar el último registro"
    elif state["running"]:
        status = "EN CURSO"
    else:
        status = "ESPERANDO / SIN PROCESO"
    last = state["last_event"]
    last_line = "Todavía no hay resultados registrados"
    if last:
        last_line = f"{last.get('code', '?')} · {last.get('status', '?')} · {last.get('time', '?')}"
    lines = [
        "CONVERSIÓN HLS · Películas y El caballero de los siete reinos",
        "-" * 76,
        f"{status}    {done}/{total} paquetes    {state['percent']:.1f}%    errores: {len(state['errors'])}",
        f"[{bar}]",
        f"Actual: {current_line}",
    ]
    if state["ffmpeg_details"]:
        lines.append(f"Actividad: {state['ffmpeg_details']}")
    lines += [f"Último resultado: {last_line}", f"Actualizado: {state['checked_at']}"]
    if state["errors"]:
        lines.append("ERRORES:")
        for item in state["errors"]:
            event = state["latest"].get(item["CodigoInterno"], {})
            lines.append(f"  {item['CodigoInterno']}: {event.get('error', 'causa no registrada')}")
    lines += [
        "",
        f"Resumen persistente: {CURRENT_STATUS}",
        f"Historial: {HISTORY}",
        "Ctrl+C: cerrar el monitor (la conversión sigue ejecutándose).",
    ]
    return "\n".join(lines)


def save_snapshot(state: dict) -> None:
    current = state["current"]
    content = [
        "Estado de conversión HLS",
        f"Actualizado: {state['checked_at']}",
        f"Estado: {'completada' if state['finished'] else 'en curso' if state['running'] else 'detenida' if state['stopped_early'] else 'sin proceso activo'}",
        f"Progreso: {state['successful']}/{state['total']} ({state['percent']:.1f}%)",
        f"Pendientes: {state['pending']}",
        f"Errores: {len(state['errors'])}",
        f"Código actual: {current['CodigoInterno'] if current else 'ninguno'}",
        f"Último resultado: {state['last_event'].get('code', 'ninguno')} {state['last_event'].get('status', '')}",
    ]
    for item in state["errors"]:
        event = state["latest"].get(item["CodigoInterno"], {})
        content.append(f"ERROR {item['CodigoInterno']}: {event.get('error', 'causa no registrada')}")
    temporary = CURRENT_STATUS.with_suffix(".tmp")
    temporary.write_text("\n".join(content) + "\n", encoding="utf-8")
    temporary.replace(CURRENT_STATUS)


def append_history(state: dict, last_minute: str | None) -> str:
    minute = state["checked_at"][:16]
    if minute == last_minute:
        return last_minute or ""
    current = state["current"]
    new_file = not HISTORY.exists()
    with HISTORY.open("a", encoding="utf-8-sig", newline="") as stream:
        writer = csv.writer(stream)
        if new_file:
            writer.writerow(["actualizado", "estado", "completados", "total", "porcentaje", "pendientes", "errores", "codigo_actual", "ultimo_codigo", "ultimo_estado"])
        last = state["last_event"]
        writer.writerow([
            state["checked_at"],
            "completada" if state["finished"] else "en curso" if state["running"] else "detenida" if state["stopped_early"] else "sin proceso",
            state["successful"], state["total"], f"{state['percent']:.1f}", state["pending"], len(state["errors"]),
            current["CodigoInterno"] if current else "", last.get("code", ""), last.get("status", ""),
        ])
    return minute


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pid", type=int, default=DEFAULT_PID, help=f"PID de la cola PowerShell (predeterminado: {DEFAULT_PID})")
    parser.add_argument("--interval", type=float, default=5, help="segundos entre actualizaciones (predeterminado: 5)")
    parser.add_argument("--once", action="store_true", help="mostrar y guardar un único estado")
    args = parser.parse_args()
    if not INVENTORY.exists():
        print(f"No se encuentra el inventario: {INVENTORY}", file=sys.stderr)
        return 2
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    last_minute = None
    try:
        while True:
            state = collect_state(args.pid)
            save_snapshot(state)
            last_minute = append_history(state, last_minute)
            if sys.stdout.isatty():
                sys.stdout.write("\x1b[2J\x1b[H")
            console_text = unicodedata.normalize("NFKD", render(state)).encode("ascii", "ignore").decode("ascii")
            print(console_text, flush=True)
            if args.once or state["finished"] or state["stopped_early"]:
                return 1 if state["stopped_early"] or state["errors"] else 0
            time.sleep(max(1.0, args.interval))
    except KeyboardInterrupt:
        print("\nMonitor cerrado; el proceso de conversión no se detuvo.")
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
