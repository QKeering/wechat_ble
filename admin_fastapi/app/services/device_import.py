import io
import re
import zipfile
from typing import Any
from xml.etree import ElementTree

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.services.crud import clean_payload, get_table, row_to_dict
from app.services.device_qrcode import ensure_payload_qrcode


DEVICE_COLUMNS = [
    ("设备型号id", "modelId"),
    ("设备名称", "deviceName"),
    ("设备大小", "deviceSize"),
    ("固件版本", "firmwareVersion"),
    ("硬件版本", "hardwareVersion"),
    ("MAC地址", "mac"),
]
HEADER_ALIASES = {label: key for label, key in DEVICE_COLUMNS}
HEADER_ALIASES.update({key: key for _, key in DEVICE_COLUMNS})
HEADER_ALIASES.update({"model_id": "modelId", "device_name": "deviceName", "device_size": "deviceSize", "mac_address": "mac"})


def device_template_xlsx() -> bytes:
    return _write_xlsx([[label for label, _ in DEVICE_COLUMNS]])


def import_device_xlsx(db: Session, content: bytes, update_support: bool) -> str:
    rows = _read_xlsx(content)
    if not rows:
        raise ValueError("导入文件没有设备数据")

    device = get_table("device")
    successes = []
    errors = []
    for index, row in enumerate(rows, start=2):
        payload = {HEADER_ALIASES[key]: value for key, value in row.items() if key in HEADER_ALIASES and value not in (None, "")}
        try:
            _validate_device(payload)
            model_exists = db.execute(
                text("select count(*) from device_model where id=:id and del_flag=0"),
                {"id": payload["modelId"]},
            ).scalar()
            if not model_exists:
                raise ValueError("设备型号不存在")
            existing = db.execute(select(device).where(device.c.mac == str(payload["mac"]).strip()).limit(1)).first()
            if existing and not update_support:
                raise ValueError("设备已存在")
            if existing:
                current = row_to_dict(existing)
                current.update(payload)
                current["id"] = current.get("id")
                current = ensure_payload_qrcode(current)
                values = clean_payload(device, current)
                row_id = values.pop("id")
                db.execute(device.update().where(device.c.id == row_id).values(**values))
                successes.append(f"第 {index} 行设备 {payload['mac']} 更新成功")
            else:
                payload = ensure_payload_qrcode(payload)
                db.execute(device.insert().values(**clean_payload(device, payload)))
                successes.append(f"第 {index} 行设备 {payload['mac']} 导入成功")
        except Exception as exc:
            errors.append(f"第 {index} 行: {exc}")

    if errors:
        db.rollback()
        raise ValueError("导入失败，未写入任何数据；" + "；".join(errors))
    db.commit()
    return f"导入完成，共处理 {len(successes)} 条设备数据"


def _validate_device(payload: dict[str, Any]) -> None:
    required = {"modelId": "设备型号id", "deviceName": "设备名称", "deviceSize": "设备大小", "mac": "MAC地址"}
    for key, label in required.items():
        if payload.get(key) in (None, ""):
            raise ValueError(f"{label}不能为空")
    mac = str(payload["mac"]).strip()
    if re.fullmatch(r"(?:[0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}", mac) is None:
        raise ValueError("MAC地址格式错误，应为 AA:BB:CC:DD:EE:FF")
    payload["modelId"] = int(payload["modelId"])
    payload["deviceSize"] = int(payload["deviceSize"])
    payload["mac"] = mac.upper()


def _read_xlsx(content: bytes) -> list[dict[str, Any]]:
    try:
        archive = zipfile.ZipFile(io.BytesIO(content))
        sheet = ElementTree.fromstring(archive.read("xl/worksheets/sheet1.xml"))
    except Exception as exc:
        raise ValueError("仅支持有效的 .xlsx 文件，请将旧 .xls 文件另存为 .xlsx") from exc

    ns = {"x": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    shared = []
    if "xl/sharedStrings.xml" in archive.namelist():
        shared_root = ElementTree.fromstring(archive.read("xl/sharedStrings.xml"))
        for item in shared_root.findall("x:si", ns):
            shared.append("".join(node.text or "" for node in item.iterfind(".//x:t", ns)))

    values = []
    for row in sheet.findall(".//x:sheetData/x:row", ns):
        cells = {}
        for cell in row.findall("x:c", ns):
            column = _column_index(cell.attrib.get("r", "A1"))
            value_node = cell.find("x:v", ns)
            inline_node = cell.find("x:is/x:t", ns)
            value: Any = inline_node.text if inline_node is not None else value_node.text if value_node is not None else ""
            if cell.attrib.get("t") == "s" and value != "":
                value = shared[int(value)]
            cells[column] = value
        if cells:
            values.append([cells.get(index, "") for index in range(max(cells) + 1)])

    if not values:
        return []
    headers = [str(value).strip() for value in values[0]]
    return [{headers[index]: value for index, value in enumerate(row) if index < len(headers)} for row in values[1:] if any(value not in ("", None) for value in row)]


def _write_xlsx(rows: list[list[Any]]) -> bytes:
    sheet_rows = []
    for row_index, row in enumerate(rows, start=1):
        cells = []
        for column_index, value in enumerate(row, start=1):
            ref = f"{_column_name(column_index)}{row_index}"
            text = _xml_escape(str(value))
            cells.append(f'<c r="{ref}" t="inlineStr"><is><t>{text}</t></is></c>')
        sheet_rows.append(f'<row r="{row_index}">{"".join(cells)}</row>')

    sheet = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        f'<sheetData>{"".join(sheet_rows)}</sheetData></worksheet>'
    )
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>')
        archive.writestr("_rels/.rels", '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>')
        archive.writestr("xl/workbook.xml", '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="设备数据" sheetId="1" r:id="rId1"/></sheets></workbook>')
        archive.writestr("xl/_rels/workbook.xml.rels", '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>')
        archive.writestr("xl/worksheets/sheet1.xml", sheet)
    return output.getvalue()


def _column_index(reference: str) -> int:
    letters = re.match(r"[A-Z]+", reference.upper())
    result = 0
    for char in letters.group(0) if letters else "A":
        result = result * 26 + ord(char) - ord("A") + 1
    return result - 1


def _column_name(index: int) -> str:
    result = ""
    while index:
        index, remainder = divmod(index - 1, 26)
        result = chr(ord("A") + remainder) + result
    return result


def _xml_escape(value: str) -> str:
    return value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")
