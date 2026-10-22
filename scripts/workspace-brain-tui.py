#!/usr/bin/env python3
"""Read-only terminal dashboard for the local Workspace Brain Compose stack."""

import argparse
import curses
import json
import os
import subprocess
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import urlopen


ROOT = Path(__file__).resolve().parent.parent
COMPOSE_FILE = ROOT / "deploy" / "compose" / "compose.yaml"
COMPOSE = [
    "docker",
    "compose",
    "-f",
    str(COMPOSE_FILE),
    "--profile",
    "librechat",
]
REFRESH_SECONDS = 5
SERVICE_ORDER = (
    "workspace-brain-api",
    "nats",
    "ingestion-worker",
    "knowledge-worker",
    "librechat",
    "librechat-mongo",
)


def run(command, timeout=8):
    try:
        result = subprocess.run(
            command,
            cwd=str(ROOT),
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=timeout,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        return None, str(error)
    if result.returncode:
        message = result.stderr.strip() or result.stdout.strip()
        return None, message or "command failed"
    return result.stdout, None


def field(item, *names, default=""):
    for name in names:
        if name in item:
            return item[name]
    return default


def parse_json_records(output):
    try:
        value = json.loads(output)
    except json.JSONDecodeError:
        value = [json.loads(line) for line in output.splitlines() if line.strip()]
    if isinstance(value, dict):
        return [value]
    if isinstance(value, list):
        return value
    return []


def configured_port(name, default):
    if os.environ.get(name):
        return os.environ[name]
    env_file = ROOT / "deploy" / "compose" / ".env"
    try:
        lines = env_file.read_text(encoding="utf-8").splitlines()
    except OSError:
        return default
    for line in lines:
        key, separator, value = line.partition("=")
        if separator and key.strip() == name:
            return value.strip().strip("\"'")
    return default


def probe(url):
    started = time.monotonic()
    try:
        with urlopen(url, timeout=2) as response:
            code = response.status
    except HTTPError as error:
        code = error.code
    except (URLError, OSError, TimeoutError) as error:
        return "unreachable ({})".format(type(error).__name__)
    elapsed = int((time.monotonic() - started) * 1000)
    return "HTTP {} ({} ms)".format(code, elapsed)


def collect_snapshot():
    context, context_error = run(["docker", "context", "show"], timeout=4)
    compose_output, compose_error = run(
        COMPOSE + ["ps", "--all", "--format", "json"], timeout=8
    )
    if compose_error:
        return {
            "context": context.strip() if context else "unavailable",
            "context_error": context_error,
            "error": compose_error,
            "containers": [],
            "probes": [],
            "collected": time.strftime("%H:%M:%S"),
        }

    containers = parse_json_records(compose_output)
    ids = [
        field(container, "ID", "Id", "id")
        for container in containers
        if field(container, "ID", "Id", "id")
    ]
    restarts = {}
    if ids:
        output, _ = run(
            ["docker", "inspect", "--format", "{{.Name}} {{.RestartCount}}"] + ids
        )
        if output:
            for line in output.splitlines():
                parts = line.strip().split()
                if len(parts) == 2:
                    restarts[parts[0].lstrip("/")] = parts[1]

    stats_output, _ = run(
        ["docker", "stats", "--no-stream", "--format", "{{json .}}"], timeout=8
    )
    stats = {}
    if stats_output:
        try:
            for item in parse_json_records(stats_output):
                name = field(item, "Name", "name")
                if name:
                    stats[name] = item
        except json.JSONDecodeError:
            stats = {}

    for container in containers:
        name = field(container, "Name", "Names")
        state = field(container, "State", "Status", default="unknown")
        health = field(container, "Health", "health")
        if not health and str(state).lower().startswith("running"):
            health = "no healthcheck"
        container["_name"] = str(name).lstrip("/")
        container["_state"] = str(state)
        container["_health"] = str(health or "-")
        container["_restarts"] = restarts.get(container["_name"], "-")
        container["_stats"] = stats.get(container["_name"], {})

    api_port = configured_port("API_PORT", "3000")
    chat_port = configured_port("LIBRECHAT_PORT", "3080")
    probe_urls = [
        ("API liveness", "http://127.0.0.1:{}/health".format(api_port)),
        ("API readiness", "http://127.0.0.1:{}/ready".format(api_port)),
        ("LibreChat", "http://127.0.0.1:{}/health".format(chat_port)),
    ]
    with ThreadPoolExecutor(max_workers=len(probe_urls)) as executor:
        probes = list(executor.map(lambda item: probe(item[1]), probe_urls))

    return {
        "context": context.strip() if context else "unavailable",
        "context_error": context_error,
        "error": None,
        "containers": containers,
        "probes": list(zip([item[0] for item in probe_urls], probes)),
        "collected": time.strftime("%H:%M:%S"),
    }


def health_color(container):
    state = container["_state"].lower()
    health = container["_health"].lower()
    if not state.startswith("running") or health == "unhealthy":
        return 3
    if health in ("starting", "no healthcheck"):
        return 2
    if health == "healthy":
        return 1
    return 2


def resource_text(container):
    stats = container["_stats"]
    cpu = field(stats, "CPUPerc", "CPU %", default="-").strip().rstrip("%")
    memory = field(stats, "MemUsage", "Mem Usage", default="-")
    if cpu == "-":
        return "-"
    return "{}% {}".format(cpu, memory.split(" / ", 1)[0])


def cell(value, width):
    value = str(value).replace("\n", " ")
    if len(value) > width:
        value = value[: max(0, width - 3)] + "..."
    return value.ljust(width)


def service_key(item):
    service = field(item, "Service", "service", default=item["_name"])
    try:
        priority = SERVICE_ORDER.index(service)
    except ValueError:
        priority = len(SERVICE_ORDER)
    return priority, service


def draw(stdscr, snapshot):
    stdscr.erase()
    height, width = stdscr.getmaxyx()

    def write(row, column, text, attribute=0):
        if row < height and column < width:
            try:
                stdscr.addnstr(row, column, text, max(0, width - column - 1), attribute)
            except curses.error:
                pass

    write(0, 0, "Workspace Brain | local runtime".ljust(width), curses.A_BOLD)
    write(
        1,
        0,
        "Docker context: {}    Updated: {}".format(
            snapshot["context"], snapshot["collected"]
        ),
    )
    if snapshot["context_error"]:
        write(2, 0, "Context: " + snapshot["context_error"], curses.A_BOLD)

    headings = ("SERVICE", "STATE", "HEALTH", "RESTARTS", "CPU / MEMORY")
    widths = (20, 10, 16, 8, 22)
    header = " ".join(cell(value, widths[index]) for index, value in enumerate(headings))
    write(4, 0, header, curses.A_BOLD | curses.A_UNDERLINE)

    row = 5
    if snapshot["error"]:
        write(row, 0, "Compose status unavailable: " + snapshot["error"], curses.A_BOLD)
        row += 1
    else:
        if not snapshot["containers"]:
            write(row, 0, "No Compose containers found for this project.")
            row += 1
        for container in sorted(snapshot["containers"], key=service_key):
            service = field(container, "Service", "service", default=container["_name"])
            values = (
                service,
                container["_state"],
                container["_health"],
                container["_restarts"],
                resource_text(container),
            )
            text = " ".join(
                cell(value, widths[index]) for index, value in enumerate(values)
            )
            color = health_color(container)
            attr = curses.color_pair(color) if curses.has_colors() else 0
            write(row, 0, text, attr)
            row += 1

    row += 1
    write(row, 0, "HTTP checks", curses.A_BOLD)
    row += 1
    for label, result in snapshot["probes"]:
        okay = result.startswith("HTTP 2")
        attr = curses.color_pair(1 if okay else 2) if curses.has_colors() else 0
        write(row, 0, "{}: {}".format(label, result), attr)
        row += 1

    footer = "q quit | r refresh | auto-refresh every {}s".format(REFRESH_SECONDS)
    write(height - 1, 0, footer, curses.A_REVERSE)
    stdscr.refresh()


def run_tui(stdscr):
    if curses.has_colors():
        curses.start_color()
        curses.use_default_colors()
        curses.init_pair(1, curses.COLOR_GREEN, -1)
        curses.init_pair(2, curses.COLOR_YELLOW, -1)
        curses.init_pair(3, curses.COLOR_RED, -1)
    stdscr.keypad(True)
    stdscr.timeout(1000)
    snapshot = collect_snapshot()
    next_refresh = time.monotonic() + REFRESH_SECONDS
    while True:
        draw(stdscr, snapshot)
        key = stdscr.getch()
        if key in (ord("q"), ord("Q")):
            return
        if key in (ord("r"), ord("R")) or time.monotonic() >= next_refresh:
            snapshot = collect_snapshot()
            next_refresh = time.monotonic() + REFRESH_SECONDS


def print_once(snapshot):
    print("Workspace Brain | Docker context: {}".format(snapshot["context"]))
    if snapshot["context_error"]:
        print("Context: " + snapshot["context_error"])
    if snapshot["error"]:
        print("Compose status unavailable: " + snapshot["error"])
    for container in snapshot["containers"]:
        service = field(container, "Service", "service", default=container["_name"])
        print(
            "{:<22} {:<12} {:<18} restarts={:<4} {}".format(
                service,
                container["_state"],
                container["_health"],
                container["_restarts"],
                resource_text(container),
            )
        )
    for label, result in snapshot["probes"]:
        print("{}: {}".format(label, result))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--once", action="store_true", help="print one snapshot without opening the TUI"
    )
    args = parser.parse_args()
    if args.once:
        snapshot = collect_snapshot()
        print_once(snapshot)
        return
    curses.wrapper(run_tui)


if __name__ == "__main__":
    main()
