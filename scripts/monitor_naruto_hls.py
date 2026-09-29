#!/usr/bin/env python3
"""Terminal progress monitor for the Naruto HLS batch."""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path


WORKSPACE = Path(__file__).resolve().parents[1]
DEFAULT_ARTIFACTS = WORKSPACE / "outputs" / "media_inventory" / "naruto_20260924"
NODE = Path(r"C:\Users\josep\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe")
BAR_WIDTH = 36
SUCCESS = {"convertido", "ya_validado"}


def running(pid: int) -> bool:
    if os.name != "nt":
        try:
            os.kill(pid, 0)
            return True
        except OSError:
            return False
    try:
        result = subprocess.run(
            ["tasklist", "/FI", f"PID eq {pid}", "/FO", "CSV", "/NH"],
            capture_output=True, text=True, timeout=5, check=False,
        )
        return str(pid) in result.stdout
    except (OSError, subprocess.TimeoutExpired):
        return False


def read_inventory(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as stream:
        return list(csv.DictReader(stream))


def read_events(path: Path) -> list[dict]:
    if not path.exists():
        return []
    result = []
    with path.open("r", encoding="utf-8-sig") as stream:
        for line in stream:
            try:
                result.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return result


def ffmpeg_progress(artifacts: Path, pending: set[str]) -> tuple[str, str]:
    logs = [p for p in artifacts.glob("*.ffmpeg.log") if p.name.removesuffix(".ffmpeg.log") in pending]
    if not logs:
        return "", ""
    log = max(logs, key=lambda p: p.stat().st_mtime)
    try:
        text = log.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return log.name.removesuffix(".ffmpeg.log"), ""
    times = re.findall(r"\btime=(\d{2}:\d{2}:\d{2}(?:\.\d+)?)", text)
    speeds = re.findall(r"\bspeed=([\d.]+x)", text)
    detail = f"FFmpeg {times[-1]}" if times else "FFmpeg preparando pista"
    if speeds:
        detail += f" · {speeds[-1]}"
    return log.name.removesuffix(".ffmpeg.log"), detail


def state(artifacts: Path, pids: list[int]) -> dict:
    inventory = read_inventory(artifacts / "inventario_privado.csv")
    events = read_events(artifacts / "conversion-log.jsonl")
    latest = {event.get("code"): event for event in events if event.get("code")}
    succeeded = [row for row in inventory if latest.get(row["CodigoInterno"], {}).get("status") in SUCCESS]
    failed = [row for row in inventory if latest.get(row["CodigoInterno"], {}).get("status") == "error"]
    completed_codes = {row["CodigoInterno"] for row in succeeded + failed}
    pending_rows = [row for row in inventory if row["CodigoInterno"] not in completed_codes]
    active_pids = [pid for pid in pids if running(pid)]
    is_running = bool(active_pids)
    current_code, detail = ffmpeg_progress(artifacts, {row["CodigoInterno"] for row in pending_rows}) if is_running else ("", "")
    last = events[-1] if events else {}
    average = sum(float(latest[row["CodigoInterno"]].get("seconds", 0)) for row in succeeded) / len(succeeded) if succeeded else 0
    effective_workers = 1 + 0.4 * max(0, len(active_pids) - 1)
    eta = average * len(pending_rows) / effective_workers
    finished = len(succeeded) == len(inventory) and not is_running
    return {
        "inventory": inventory, "events": events, "latest": latest,
        "succeeded": succeeded, "failed": failed, "pending": pending_rows,
        "running": is_running, "finished": finished, "last": last,
        "current_code": current_code, "detail": detail, "eta": eta,
        "active_pids": active_pids,
        "checked_at": datetime.now().astimezone().isoformat(timespec="seconds"),
    }


def render(current: dict) -> str:
    total = len(current["inventory"])
    done = len(current["succeeded"])
    errors = len(current["failed"])
    pending = len(current["pending"])
    pct = 100 * done / total if total else 0
    filled = round(BAR_WIDTH * done / total) if total else 0
    bar = "#" * filled + "." * (BAR_WIDTH - filled)
    last = current["last"]
    if current["finished"]:
        status = "COMPLETADA"
    elif current["running"]:
        status = "EN PROCESO"
    elif errors:
        status = "DETENIDA POR ERROR"
    else:
        status = "PROCESO DETENIDO CON PENDIENTES"
    lines = [
        "CONVERSIÓN HLS · NARUTO · SER-00006",
        f"[{bar}] {pct:5.1f}%  {status}",
        f"Convertidos: {done:3d}   Pendientes: {pending:3d}   Errores: {errors:3d}   Total: {total}",
        f"Último código: {last.get('code', '—')}  ({last.get('status', 'sin resultados')})",
        f"Trabajadores activos: {len(current['active_pids'])}",
        f"En curso: {current['current_code'] or '—'}  {current['detail']}",
        f"ETA aproximada: {current['eta'] / 3600:.1f} h, según el promedio observado" if done else "ETA aproximada: disponible tras completar el primer episodio",
        f"Actualizado: {current['checked_at']}",
    ]
    if current["failed"]:
        error = current["latest"].get(current["failed"][-1]["CodigoInterno"], {})
        lines.append(f"Error {error.get('code')}: {error.get('error', 'causa no registrada')}")
    lines.append("Excel: inventario_conversion_naruto.xlsx · Ctrl+C cierra solo el monitor")
    return "\n".join(lines)


def save_status(artifacts: Path, current: dict) -> None:
    total = len(current["inventory"])
    text = render(current)
    (artifacts / "estado_actual.txt").write_text(text + "\n", encoding="utf-8")
    history_path = artifacts / "historial_monitor.csv"
    last = current["last"]
    current_code = current["current_code"]
    header = "Hora,Convertidos,Pendientes,Errores,UltimoCodigo,CodigoEnCurso,ProcesoActivo\n"
    if not history_path.exists():
        history_path.write_text(header, encoding="utf-8-sig")
    with history_path.open("a", encoding="utf-8", newline="") as stream:
        stream.write(
            f"{current['checked_at']},{len(current['succeeded'])},{len(current['pending'])},"
            f"{len(current['failed'])},{last.get('code','')},{current_code},{current['running']}\n"
        )


def update_workbook(builder: Path, node: Path) -> tuple[bool, str]:
    try:
        result = subprocess.run([str(node), str(builder)], capture_output=True, text=True, timeout=180, check=False)
        if result.returncode:
            return False, (result.stderr or result.stdout).strip()[-1200:]
        return True, result.stdout.strip()
    except (OSError, subprocess.TimeoutExpired) as error:
        return False, str(error)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pid", action="append", required=True, type=int, help="PID del runner PowerShell; puede repetirse")
    parser.add_argument("--artifacts", type=Path, default=DEFAULT_ARTIFACTS)
    parser.add_argument("--builder", type=Path, default=WORKSPACE / "scripts" / "build_naruto_inventory.mjs")
    parser.add_argument("--node", type=Path, default=NODE)
    parser.add_argument("--refresh", type=float, default=2.0, help="Intervalo de pantalla en segundos")
    args = parser.parse_args()

    last_event_count = -1
    last_export = 0.0
    last_history = 0.0
    last_state = None
    try:
        while True:
            current = state(args.artifacts, args.pid)
            event_count = len(current["events"])
            now = time.monotonic()
            if event_count != last_event_count and now - last_export >= 30:
                ok, message = update_workbook(args.builder, args.node)
                if ok:
                    last_event_count = event_count
                    last_export = now
                else:
                    current["builder_error"] = message
            if now - last_history >= 60 or last_state != (
                len(current["succeeded"]), len(current["pending"]), len(current["failed"]),
                current["running"], current["current_code"],
            ):
                save_status(args.artifacts, current)
                last_history = now
                last_state = (
                    len(current["succeeded"]), len(current["pending"]), len(current["failed"]),
                    current["running"], current["current_code"],
                )
            if sys.stdout.isatty():
                print("\033[2J\033[H", end="")
            print(render(current), flush=True)
            if current.get("builder_error"):
                print(f"No se pudo actualizar Excel: {current['builder_error']}", flush=True)
            if current["finished"] or (not current["running"] and (current["failed"] or current["pending"])):
                update_workbook(args.builder, args.node)
                return 0 if current["finished"] else 1
            time.sleep(max(0.5, args.refresh))
    except KeyboardInterrupt:
        print("\nMonitor cerrado. La conversión continúa en el proceso aparte.", flush=True)
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
