import re
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import MetaData, Table, and_, delete, func, insert, select, update
from sqlalchemy.orm import Session

from app.db.session import engine

metadata = MetaData()


def get_table(table_name: str) -> Table:
    return Table(table_name, metadata, autoload_with=engine)


def row_to_dict(row: Any) -> dict[str, Any]:
    return camelize_dict(dict(row._mapping))


def to_camel(name: str) -> str:
    name = name.lower()
    parts = name.split("_")
    return parts[0] + "".join(part[:1].upper() + part[1:] for part in parts[1:])


def to_snake(name: str) -> str:
    return re.sub(r"(?<!^)(?=[A-Z])", "_", name).lower()


def serialize_value(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.strftime("%Y-%m-%d %H:%M:%S")
    if isinstance(value, date):
        return value.strftime("%Y-%m-%d")
    if isinstance(value, Decimal):
        return float(value)
    return value


def camelize_dict(data: dict[str, Any]) -> dict[str, Any]:
    return {to_camel(key): serialize_value(value) for key, value in data.items()}


def primary_key_name(table: Table) -> str:
    columns = list(table.primary_key.columns)
    if columns:
        return columns[0].name
    if "id" in table.c:
        return "id"
    raise ValueError(f"表 {table.name} 没有主键")


def clean_payload(table: Table, payload: dict[str, Any]) -> dict[str, Any]:
    values = {}
    for key, value in payload.items():
        column_name = key if key in table.c else to_snake(key)
        if column_name in table.c and value is not None:
            values[column_name] = value
    return values


def list_rows(
    db: Session,
    table_name: str,
    filters: dict[str, Any],
    page_num: int = 1,
    page_size: int = 10,
    like_fields: set[str] | None = None,
) -> tuple[list[dict[str, Any]], int]:
    table = get_table(table_name)
    like_fields = {field if field in table.c else to_snake(field) for field in (like_fields or set())}
    clauses = []
    for key, value in filters.items():
        if value in (None, "") or key not in table.c:
            snake_key = to_snake(key)
            if snake_key not in table.c:
                continue
            key = snake_key
        if value in (None, ""):
            continue
        column = table.c[key]
        if key == "mac" and key in like_fields:
            # MAC input may contain colons, dashes, spaces, or no separators.
            # Normalizing both sides also makes partial searches work across formats.
            normalized_value = re.sub(r"[^0-9a-fA-F]", "", str(value)).lower()
            if not normalized_value:
                continue
            normalized_column = func.lower(
                func.replace(func.replace(func.replace(column, ":", ""), "-", ""), " ", "")
            )
            clauses.append(normalized_column.like(f"%{normalized_value}%"))
        else:
            clauses.append(column.like(f"%{value}%") if key in like_fields else column == value)

    base = select(table)
    count_query = select(func.count()).select_from(table)
    if "del_flag" in table.c:
        clauses.append(table.c.del_flag == 0)
    elif "delFlag" in table.c:
        clauses.append(table.c.delFlag == 0)

    if clauses:
        condition = and_(*clauses)
        base = base.where(condition)
        count_query = count_query.where(condition)

    offset = max(page_num - 1, 0) * page_size
    rows = db.execute(base.limit(page_size).offset(offset)).all()
    total = db.scalar(count_query) or 0
    return [row_to_dict(row) for row in rows], total


def get_row(db: Session, table_name: str, row_id: Any) -> dict[str, Any] | None:
    table = get_table(table_name)
    pk = primary_key_name(table)
    row = db.execute(select(table).where(table.c[pk] == row_id)).first()
    return row_to_dict(row) if row else None


def create_row(db: Session, table_name: str, payload: dict[str, Any]) -> int:
    table = get_table(table_name)
    result = db.execute(insert(table).values(**clean_payload(table, payload)))
    db.commit()
    return result.rowcount or 0


def update_row(db: Session, table_name: str, payload: dict[str, Any]) -> int:
    table = get_table(table_name)
    pk = primary_key_name(table)
    values = clean_payload(table, payload)
    if pk not in values:
        raise ValueError(f"缺少主键字段: {pk}")
    row_id = values.pop(pk)
    result = db.execute(update(table).where(table.c[pk] == row_id).values(**values))
    db.commit()
    return result.rowcount or 0


def delete_rows(db: Session, table_name: str, ids: str) -> int:
    table = get_table(table_name)
    pk = primary_key_name(table)
    id_values = [item for item in ids.split(",") if item]
    if "del_flag" in table.c:
        result = db.execute(update(table).where(table.c[pk].in_(id_values)).values(del_flag=2))
    elif "delFlag" in table.c:
        result = db.execute(update(table).where(table.c[pk].in_(id_values)).values(delFlag=2))
    else:
        result = db.execute(delete(table).where(table.c[pk].in_(id_values)))
    db.commit()
    return result.rowcount or 0
