SUCCESS = 200
ERROR = 500
WARN = 601
UNAUTHORIZED = 401
NOT_MIGRATED = 501


def success(data=None, msg: str = "操作成功") -> dict:
    payload = {"code": SUCCESS, "msg": msg}
    if data is not None:
        payload["data"] = data
    return payload


def error(msg: str = "操作失败", code: int = ERROR, data=None) -> dict:
    payload = {"code": code, "msg": msg}
    if data is not None:
        payload["data"] = data
    return payload


def warn(msg: str, data=None) -> dict:
    return error(msg=msg, code=WARN, data=data)


def table(rows: list, total: int, msg: str = "查询成功") -> dict:
    return {"code": SUCCESS, "msg": msg, "rows": rows, "total": total}


def not_migrated(path: str) -> dict:
    return error(f"接口待迁移: {path}", code=NOT_MIGRATED)
