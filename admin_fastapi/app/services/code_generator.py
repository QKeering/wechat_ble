import re
from pathlib import Path
from typing import Any

SAFE_NAME = re.compile(r"^[A-Za-z][A-Za-z0-9_]*$")


def _safe_name(table_name: str) -> str:
    if not SAFE_NAME.fullmatch(table_name):
        raise ValueError("数据表名称不合法")
    return table_name


def _field_names(columns: list[dict[str, Any]]) -> list[str]:
    return [str(column.get("columnName") or column.get("column_name") or "") for column in columns]


def generated_files(table_name: str, columns: list[dict[str, Any]]) -> dict[str, str]:
    table_name = _safe_name(table_name)
    fields = ", ".join(item for item in _field_names(columns) if item)
    api = f'''from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.core.responses import error, success, table
from app.db.session import get_db
from app.services.crud import create_row, delete_rows, get_row, list_rows, update_row

router = APIRouter(prefix="/admin/{table_name}", tags=["{table_name}"])


@router.get("/list")
def list_items(request: Request, db: Session = Depends(get_db)):
    query = dict(request.query_params)
    page_num = int(query.pop("pageNum", 1) or 1)
    page_size = int(query.pop("pageSize", 10) or 10)
    rows, total = list_rows(db, "{table_name}", query, page_num, page_size)
    return table(rows, total)


@router.get("/{{row_id}}")
def get_item(row_id: str, db: Session = Depends(get_db)):
    return success(get_row(db, "{table_name}", row_id))


@router.post("")
async def create_item(request: Request, db: Session = Depends(get_db)):
    return success() if create_row(db, "{table_name}", await request.json()) > 0 else error()


@router.put("")
async def update_item(request: Request, db: Session = Depends(get_db)):
    return success() if update_row(db, "{table_name}", await request.json()) > 0 else error()


@router.delete("/{{ids}}")
def delete_items(ids: str, db: Session = Depends(get_db)):
    return success() if delete_rows(db, "{table_name}", ids) > 0 else error()
'''
    web_api = f'''import request from '@/utils/request'

export function list{table_name}(query) {{
  return request({{ url: '/admin/{table_name}/list', method: 'get', params: query }})
}}

export function get{table_name}(id) {{
  return request({{ url: '/admin/{table_name}/' + id, method: 'get' }})
}}

export function add{table_name}(data) {{
  return request({{ url: '/admin/{table_name}', method: 'post', data }})
}}

export function update{table_name}(data) {{
  return request({{ url: '/admin/{table_name}', method: 'put', data }})
}}

export function del{table_name}(ids) {{
  return request({{ url: '/admin/{table_name}/' + ids, method: 'delete' }})
}}
'''
    readme = f'''# {table_name}

Generated FastAPI CRUD scaffold.

Columns: {fields}

Register `api.py` in the FastAPI application router and place `index.js` in the frontend API directory.
'''
    return {
        f"{table_name}/api.py": api,
        f"{table_name}/index.js": web_api,
        f"{table_name}/README.md": readme,
    }


def write_generated_files(root: Path, table_name: str, columns: list[dict[str, Any]]) -> Path:
    files = generated_files(table_name, columns)
    target = root / table_name
    target.mkdir(parents=True, exist_ok=True)
    for name, content in files.items():
        relative = Path(name).relative_to(table_name)
        destination = target / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(content, encoding="utf-8")
    return target
