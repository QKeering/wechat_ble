import os
import re
import shutil
import subprocess
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

from app.core.config import settings
from app.services.crud import camelize_dict

SAFE_TABLE_NAME = re.compile(r"^[A-Za-z0-9_]+$")
BACKUP_DIR = Path("uploads/backups")


def _database_config() -> tuple[str, str, int, str, str]:
    url = make_url(settings.database_url)
    if not url.drivername.startswith("mysql") or not url.database:
        raise ValueError("数据库备份仅支持 MySQL")
    return url.host or "127.0.0.1", int(url.port or 3306), url.username or "", url.password or "", url.database


def _mysql_tool(name: str) -> str:
    resolved = shutil.which(name)
    if resolved:
        return resolved
    windows_path = Path(r"C:\Program Files\MySQL\MySQL Server 8.4\bin") / f"{name}.exe"
    if windows_path.exists():
        return str(windows_path)
    raise ValueError(f"未找到 MySQL 工具: {name}")


def backup_path() -> Path:
    _, _, _, _, database = _database_config()
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    return BACKUP_DIR / f"{database}.sql"


def list_tables(db: Session, name: str | None, page_num: int, page_size: int) -> tuple[list[dict], int]:
    _, _, _, _, database = _database_config()
    params = {"schema": database, "name": f"%{name or ''}%", "offset": max(page_num - 1, 0) * page_size, "limit": page_size}
    condition = "and (table_name like :name or table_comment like :name)" if name else ""
    total = db.execute(
        text(f"select count(*) from information_schema.tables where table_schema=:schema {condition}"),
        params,
    ).scalar() or 0
    rows = db.execute(
        text(
            f"""
            select table_name, table_comment as comments, table_rows as tablie_rows, update_time, engine
            from information_schema.tables
            where table_schema=:schema {condition}
            order by table_name
            limit :limit offset :offset
            """
        ),
        params,
    ).all()
    return [camelize_dict(dict(row._mapping)) for row in rows], int(total)


def create_backup(table_names: list[str] | None = None) -> Path:
    host, port, username, password, database = _database_config()
    tables = [item for item in (table_names or []) if item]
    if any(not SAFE_TABLE_NAME.fullmatch(item) for item in tables):
        raise ValueError("数据表名称不合法")
    command = [
        _mysql_tool("mysqldump"),
        "--column-statistics=0",
        "--host",
        host,
        "--port",
        str(port),
        "--user",
        username,
        "--default-character-set=utf8mb4",
        database,
        *tables,
    ]
    target = backup_path()
    env = dict(os.environ)
    env["MYSQL_PWD"] = password
    with target.open("wb") as output:
        result = subprocess.run(command, stdout=output, stderr=subprocess.PIPE, env=env, check=False)
    if result.returncode != 0:
        target.unlink(missing_ok=True)
        raise ValueError(result.stderr.decode("utf-8", errors="replace") or "数据库导出失败")
    return target


def restore_backup(content: bytes, filename: str | None) -> None:
    if not filename or Path(filename).suffix.lower() != ".sql":
        raise ValueError("请选择 .sql 备份文件")
    host, port, username, password, database = _database_config()
    target = backup_path()
    target.write_bytes(content)
    command = [
        _mysql_tool("mysql"),
        "--host",
        host,
        "--port",
        str(port),
        "--user",
        username,
        "--default-character-set=utf8mb4",
        database,
    ]
    env = dict(os.environ)
    env["MYSQL_PWD"] = password
    with target.open("rb") as source:
        result = subprocess.run(command, stdin=source, stderr=subprocess.PIPE, env=env, check=False)
    if result.returncode != 0:
        raise ValueError(result.stderr.decode("utf-8", errors="replace") or "数据库恢复失败")
