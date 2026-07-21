import os
import platform
import socket
import sys
import time
from datetime import datetime
from pathlib import Path

import psutil

START_TIME = time.time()


def _size_gb(value: int) -> float:
    return round(value / 1024 / 1024 / 1024, 2)


def _size_mb(value: int) -> float:
    return round(value / 1024 / 1024, 2)


def _percent(value: float) -> float:
    return round(value, 2)


def server_info() -> dict:
    cpu_times = psutil.cpu_times_percent(interval=0.1)
    memory = psutil.virtual_memory()
    process = psutil.Process()
    process_memory = process.memory_info().rss
    disks = []
    for partition in psutil.disk_partitions(all=False):
        try:
            usage = psutil.disk_usage(partition.mountpoint)
        except (OSError, PermissionError):
            continue
        disks.append({
            "dirName": partition.mountpoint,
            "sysTypeName": partition.fstype,
            "typeName": partition.device,
            "total": f"{_size_gb(usage.total)} GB",
            "free": f"{_size_gb(usage.free)} GB",
            "used": f"{_size_gb(usage.used)} GB",
            "usage": _percent(usage.percent),
        })
    host_name = socket.gethostname()
    try:
        host_ip = socket.gethostbyname(host_name)
    except OSError:
        host_ip = "127.0.0.1"
    elapsed = max(int(time.time() - START_TIME), 0)
    return {
        "cpu": {
            "cpuNum": os.cpu_count() or 1,
            "used": _percent(cpu_times.user),
            "sys": _percent(cpu_times.system),
            "free": _percent(cpu_times.idle),
        },
        "mem": {
            "total": _size_gb(memory.total),
            "used": _size_gb(memory.used),
            "free": _size_gb(memory.available),
            "usage": _percent(memory.percent),
        },
        "sys": {
            "computerName": host_name,
            "computerIp": host_ip,
            "osName": platform.platform(),
            "osArch": platform.machine(),
            "userDir": str(Path.cwd()),
        },
        "jvm": {
            "name": "Python",
            "version": platform.python_version(),
            "home": sys.prefix,
            "total": _size_mb(memory.total),
            "used": _size_mb(process_memory),
            "free": _size_mb(max(memory.available, 0)),
            "usage": _percent(process_memory * 100 / memory.total) if memory.total else 0,
            "startTime": datetime.fromtimestamp(START_TIME).strftime("%Y-%m-%d %H:%M:%S"),
            "runTime": f"{elapsed // 86400}天 {(elapsed % 86400) // 3600}小时 {(elapsed % 3600) // 60}分钟",
            "inputArgs": " ".join(sys.argv),
        },
        "sysFiles": disks,
    }
