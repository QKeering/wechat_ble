from typing import Any

import bcrypt
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.services.crud import camelize_dict, clean_payload, get_table, to_snake


def rows(db: Session, sql: str, params: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    return [camelize_dict(dict(row._mapping)) for row in db.execute(text(sql), params or {}).all()]


def row(db: Session, sql: str, params: dict[str, Any] | None = None) -> dict[str, Any] | None:
    item = db.execute(text(sql), params or {}).first()
    return camelize_dict(dict(item._mapping)) if item else None


def config_value(db: Session, config_key: str) -> str | None:
    return db.execute(
        text("select config_value from sys_config where config_key=:config_key limit 1"),
        {"config_key": config_key},
    ).scalar()


def dict_data_by_type(db: Session, dict_type: str) -> list[dict[str, Any]]:
    return rows(
        db,
        """
        select * from sys_dict_data
        where status = '0' and dict_type = :dict_type
        order by dict_sort
        """,
        {"dict_type": dict_type},
    )


def dict_type_options(db: Session) -> list[dict[str, Any]]:
    return rows(db, "select * from sys_dict_type where status = '0' order by dict_id")


def menu_list(db: Session, filters: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    filters = filters or {}
    clauses = []
    params: dict[str, Any] = {}
    if filters.get("menuName"):
        clauses.append("menu_name like :menu_name")
        params["menu_name"] = f"%{filters['menuName']}%"
    if filters.get("status") not in (None, ""):
        clauses.append("status = :status")
        params["status"] = filters["status"]
    where = "where " + " and ".join(clauses) if clauses else ""
    return rows(db, f"select * from sys_menu {where} order by parent_id, order_num", params)


def dept_list(db: Session, filters: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    filters = filters or {}
    clauses = ["del_flag = '0'"]
    params: dict[str, Any] = {}
    if filters.get("deptName"):
        clauses.append("dept_name like :dept_name")
        params["dept_name"] = f"%{filters['deptName']}%"
    if filters.get("status") not in (None, ""):
        clauses.append("status = :status")
        params["status"] = filters["status"]
    return rows(db, f"select * from sys_dept where {' and '.join(clauses)} order by parent_id, order_num", params)


def build_tree(items: list[dict[str, Any]], id_key: str, parent_key: str) -> list[dict[str, Any]]:
    by_parent: dict[int, list[dict[str, Any]]] = {}
    ids = {int(item[id_key]) for item in items if item.get(id_key) is not None}
    for item in items:
        by_parent.setdefault(int(item.get(parent_key) or 0), []).append(item)

    def attach(item: dict[str, Any]) -> dict[str, Any]:
        children = [attach(child) for child in by_parent.get(int(item.get(id_key) or 0), [])]
        if children:
            item["children"] = children
        return item

    roots = [item for item in items if int(item.get(parent_key) or 0) not in ids]
    return [attach(item) for item in roots]


def menu_tree_select(db: Session) -> list[dict[str, Any]]:
    menus = menu_list(db)
    nodes = [
        {"id": item["menuId"], "label": item["menuName"], "parentId": item.get("parentId")}
        for item in menus
    ]
    return build_tree(nodes, "id", "parentId")


def dept_tree_select(db: Session) -> list[dict[str, Any]]:
    depts = dept_list(db)
    nodes = [
        {"id": item["deptId"], "label": item["deptName"], "parentId": item.get("parentId")}
        for item in depts
    ]
    return build_tree(nodes, "id", "parentId")


def role_menu_ids(db: Session, role_id: int) -> list[int]:
    return list(db.execute(text("select menu_id from sys_role_menu where role_id=:role_id"), {"role_id": role_id}).scalars())


def role_dept_ids(db: Session, role_id: int) -> list[int]:
    return list(db.execute(text("select dept_id from sys_role_dept where role_id=:role_id"), {"role_id": role_id}).scalars())


def replace_role_menus(db: Session, role_id: int, menu_ids: list[int]) -> None:
    db.execute(text("delete from sys_role_menu where role_id=:role_id"), {"role_id": role_id})
    for menu_id in menu_ids:
        db.execute(text("insert into sys_role_menu(role_id, menu_id) values(:role_id, :menu_id)"), {"role_id": role_id, "menu_id": menu_id})


def replace_role_depts(db: Session, role_id: int, dept_ids: list[int]) -> None:
    db.execute(text("delete from sys_role_dept where role_id=:role_id"), {"role_id": role_id})
    for dept_id in dept_ids:
        db.execute(text("insert into sys_role_dept(role_id, dept_id) values(:role_id, :dept_id)"), {"role_id": role_id, "dept_id": dept_id})


def options_for_user_form(db: Session) -> dict[str, Any]:
    return {
        "roles": rows(db, "select * from sys_role where del_flag = '0' order by role_sort"),
        "posts": rows(db, "select * from sys_post order by post_sort"),
    }


def user_detail(db: Session, user_id: int | None) -> dict[str, Any]:
    data = options_for_user_form(db)
    if user_id:
        data["data"] = row(db, "select * from sys_user where user_id=:user_id and del_flag='0'", {"user_id": user_id})
        if data["data"]:
            data["data"].pop("password", None)
        data["postIds"] = list(db.execute(text("select post_id from sys_user_post where user_id=:user_id"), {"user_id": user_id}).scalars())
        data["roleIds"] = list(db.execute(text("select role_id from sys_user_role where user_id=:user_id"), {"user_id": user_id}).scalars())
    return data


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def replace_user_roles(db: Session, user_id: int, role_ids: list[int]) -> None:
    db.execute(text("delete from sys_user_role where user_id=:user_id"), {"user_id": user_id})
    for role_id in role_ids:
        db.execute(text("insert into sys_user_role(user_id, role_id) values(:user_id, :role_id)"), {"user_id": user_id, "role_id": role_id})


def replace_user_posts(db: Session, user_id: int, post_ids: list[int]) -> None:
    db.execute(text("delete from sys_user_post where user_id=:user_id"), {"user_id": user_id})
    for post_id in post_ids:
        db.execute(text("insert into sys_user_post(user_id, post_id) values(:user_id, :post_id)"), {"user_id": user_id, "post_id": post_id})


def id_list(value: Any) -> list[int]:
    if value in (None, ""):
        return []
    if isinstance(value, str):
        return [int(item) for item in value.split(",") if item]
    return [int(item) for item in value]


def create_user(db: Session, payload: dict[str, Any]) -> int:
    table = get_table("sys_user")
    values = clean_payload(table, payload)
    if values.get("password"):
        values["password"] = hash_password(values["password"])
    result = db.execute(table.insert().values(**values))
    user_id = int(result.inserted_primary_key[0])
    replace_user_roles(db, user_id, id_list(payload.get("roleIds")))
    replace_user_posts(db, user_id, id_list(payload.get("postIds")))
    db.commit()
    return 1


def update_user(db: Session, payload: dict[str, Any]) -> int:
    table = get_table("sys_user")
    values = clean_payload(table, payload)
    user_id = int(values.pop("user_id"))
    values.pop("password", None)
    db.execute(table.update().where(table.c.user_id == user_id).values(**values))
    replace_user_roles(db, user_id, id_list(payload.get("roleIds")))
    replace_user_posts(db, user_id, id_list(payload.get("postIds")))
    db.commit()
    return 1


def create_role(db: Session, payload: dict[str, Any]) -> int:
    table = get_table("sys_role")
    values = clean_payload(table, payload)
    result = db.execute(table.insert().values(**values))
    role_id = int(result.inserted_primary_key[0])
    replace_role_menus(db, role_id, id_list(payload.get("menuIds")))
    replace_role_depts(db, role_id, id_list(payload.get("deptIds")))
    db.commit()
    return 1


def update_role(db: Session, payload: dict[str, Any]) -> int:
    table = get_table("sys_role")
    values = clean_payload(table, payload)
    role_id = int(values.pop("role_id"))
    db.execute(table.update().where(table.c.role_id == role_id).values(**values))
    replace_role_menus(db, role_id, id_list(payload.get("menuIds")))
    if "deptIds" in payload:
        replace_role_depts(db, role_id, id_list(payload.get("deptIds")))
    db.commit()
    return 1


def update_simple(db: Session, table_name: str, pk_name: str, payload: dict[str, Any]) -> int:
    table = get_table(table_name)
    values = clean_payload(table, payload)
    pk = to_snake(pk_name)
    row_id = values.pop(pk)
    db.execute(table.update().where(table.c[pk] == row_id).values(**values))
    db.commit()
    return 1
