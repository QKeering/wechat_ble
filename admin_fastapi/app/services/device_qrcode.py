import hashlib
import html
import io
import re
from datetime import datetime
from pathlib import Path
from typing import Any

from fastapi.responses import FileResponse, Response
from sqlalchemy import text
from sqlalchemy.orm import Session


PROFILE_ROOT = Path("profile")


def qrcode_url(sn: str, create_time: Any = None) -> str:
    return f"/profile/qrcode/{_date_path(create_time)}/{sn}.png"


def ensure_payload_qrcode(payload: dict[str, Any]) -> dict[str, Any]:
    sn = str(payload.get("sn") or payload.get("snCode") or "").strip().upper()
    if not is_valid_sn(sn):
        sn = generate_sn12(str(payload.get("deviceName") or ""), str(payload.get("mac") or ""))
        payload["sn"] = sn
    if payload.get("qrcodeUrl") or payload.get("qrcode_url"):
        return payload
    if sn:
        payload["qrcodeUrl"] = qrcode_url(sn)
    return payload


def generate_sn12(device_name: str, mac: str) -> str:
    product = _product_code(device_name)
    mac_code = _mac_short(mac)
    digest = hashlib.sha256(f"{device_name}{mac}".encode("utf-8")).digest()
    value = 0
    for item in digest[:5]:
        value = (value << 8) | item
    hashed = _pad_left(_to_base36(value)[:7], 7, "0")
    body = f"{product}{mac_code}{hashed}"
    return f"{body}{_checksum(body)}"


def is_valid_sn(sn: str) -> bool:
    if not sn or len(sn) != 12 or re.fullmatch(r"[A-Z0-9]{12}", sn) is None:
        return False
    return sn[-1] == _checksum(sn[:11])


def ensure_rows_qrcode(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    for row in rows:
        if not row.get("qrcodeUrl") and row.get("sn"):
            row["qrcodeUrl"] = qrcode_url(str(row["sn"]), row.get("createTime"))
    return rows


def profile_resource_response(resource: str, db: Session) -> Response:
    safe_resource = resource.replace("\\", "/").lstrip("/")
    target = (PROFILE_ROOT / safe_resource).resolve()
    root = PROFILE_ROOT.resolve()
    if target.exists() and target.is_file() and _is_inside(target, root):
        return FileResponse(target)

    sn = Path(safe_resource).stem
    if not sn:
        return Response(status_code=404)

    row = db.execute(
        text("select sn from device where sn=:sn and del_flag=0 limit 1"),
        {"sn": sn},
    ).first()
    if not row:
        row = db.execute(
            text("select sn from device where qrcode_url like :path and del_flag=0 limit 1"),
            {"path": f"%/{Path(safe_resource).name}"},
        ).first()
    if not row:
        return Response(status_code=404)

    return qrcode_image_response(str(row._mapping["sn"]))


def qrcode_image_response(sn: str) -> Response:
    png = _qrcode_png(sn)
    if png is not None:
        return Response(content=png, media_type="image/png", headers={"Cache-Control": "no-store"})
    return Response(content=_fallback_svg(sn), media_type="image/svg+xml", headers={"Cache-Control": "no-store"})


def _qrcode_png(sn: str) -> bytes | None:
    try:
        import qrcode
    except Exception:
        return None

    qr = qrcode.QRCode(
        version=None,
        error_correction=qrcode.constants.ERROR_CORRECT_H,
        box_size=10,
        border=1,
    )
    qr.add_data(sn.strip())
    qr.make(fit=True)
    image = qr.make_image(fill_color="black", back_color="white")
    output = io.BytesIO()
    image.save(output, format="PNG")
    return output.getvalue()


def _fallback_svg(sn: str) -> str:
    modules = _qr_matrix_v2_h(sn.strip())
    size = len(modules)
    cell = 8
    quiet_zone = 4
    width = (size + quiet_zone * 2) * cell
    rects = []
    for y, row in enumerate(modules):
        for x, on in enumerate(row):
            if on:
                rects.append(
                    f'<rect x="{(quiet_zone + x) * cell}" y="{(quiet_zone + y) * cell}" width="{cell}" height="{cell}"/>'
                )
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{width}" viewBox="0 0 {width} {width}">'
        '<rect width="100%" height="100%" fill="#fff"/>'
        f'<g fill="#111">{"".join(rects)}</g>'
        f"<title>{html.escape(sn)}</title>"
        "</svg>"
    )


def _date_path(value: Any = None) -> str:
    if isinstance(value, str):
        try:
            value = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            value = None
    if not isinstance(value, datetime):
        value = datetime.now()
    return value.strftime("%Y/%m/%d")


def _is_inside(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False


def _product_code(device_name: str) -> str:
    letters = re.sub(r"[^A-Za-z]", "", device_name).upper()
    if not letters:
        letters = "XX"
    if len(letters) == 1:
        letters += "X"
    return letters[:2]


def _mac_short(mac: str) -> str:
    hex_value = re.sub(r"[^0-9A-Fa-f]", "", mac).upper()
    if not hex_value:
        hex_value = "0"
    value = int(hex_value, 16) % 1296
    return _pad_left(_to_base36(value), 2, "0")[-2:]


def _checksum(value: str) -> str:
    result = 0
    for char in value:
        result = (result * 31 + ord(char)) & 0x7FFFFFFF
    return chr(ord("A") + (result % 26))


def _to_base36(value: int) -> str:
    alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    if value == 0:
        return "0"
    chars = []
    while value:
        value, remainder = divmod(value, 36)
        chars.append(alphabet[remainder])
    return "".join(reversed(chars))


def _pad_left(value: str, length: int, char: str) -> str:
    return value.rjust(length, char)


def _qr_matrix_v2_h(text: str) -> list[list[bool]]:
    data = text.encode("utf-8")
    if len(data) > 14:
        data = hashlib.sha256(data).hexdigest()[:14].upper().encode("ascii")

    data_codewords = _qr_data_codewords(data)
    ecc_codewords = _rs_remainder(data_codewords, 28)
    all_codewords = data_codewords + ecc_codewords
    bits = [(codeword >> shift) & 1 for codeword in all_codewords for shift in range(7, -1, -1)]

    size = 25
    modules: list[list[bool | None]] = [[None for _ in range(size)] for _ in range(size)]
    reserved = [[False for _ in range(size)] for _ in range(size)]

    def set_function(x: int, y: int, black: bool) -> None:
        if 0 <= x < size and 0 <= y < size:
            modules[y][x] = black
            reserved[y][x] = True

    _draw_finder(set_function, 0, 0)
    _draw_finder(set_function, size - 7, 0)
    _draw_finder(set_function, 0, size - 7)
    _draw_alignment(set_function, 18, 18)

    for i in range(size):
        if not reserved[6][i]:
            set_function(i, 6, i % 2 == 0)
        if not reserved[i][6]:
            set_function(6, i, i % 2 == 0)

    set_function(8, 17, True)
    _draw_format_bits(set_function, size, _format_bits(ecl=2, mask=0))

    bit_index = 0
    upward = True
    right = size - 1
    while right > 0:
        if right == 6:
            right -= 1
        for vert in range(size):
            y = size - 1 - vert if upward else vert
            for x in (right, right - 1):
                if reserved[y][x]:
                    continue
                bit = bits[bit_index] if bit_index < len(bits) else 0
                bit_index += 1
                if (x + y) % 2 == 0:
                    bit ^= 1
                modules[y][x] = bool(bit)
        upward = not upward
        right -= 2

    return [[bool(module) for module in row] for row in modules]


def _qr_data_codewords(data: bytes) -> list[int]:
    bits = [0, 1, 0, 0]
    bits.extend((len(data) >> shift) & 1 for shift in range(7, -1, -1))
    for byte in data:
        bits.extend((byte >> shift) & 1 for shift in range(7, -1, -1))
    bits.extend([0] * min(4, 128 - len(bits)))
    while len(bits) % 8:
        bits.append(0)

    result = []
    for i in range(0, len(bits), 8):
        value = 0
        for bit in bits[i : i + 8]:
            value = (value << 1) | bit
        result.append(value)

    for pad in (0xEC, 0x11):
        if len(result) >= 16:
            break
        result.append(pad)
    while len(result) < 16:
        result.extend([0xEC, 0x11])
    return result[:16]


def _draw_finder(set_function: Any, x0: int, y0: int) -> None:
    for y in range(y0 - 1, y0 + 8):
        for x in range(x0 - 1, x0 + 8):
            if not (0 <= x < 25 and 0 <= y < 25):
                continue
            dx = x - x0
            dy = y - y0
            black = 0 <= dx <= 6 and 0 <= dy <= 6 and (dx in (0, 6) or dy in (0, 6) or (2 <= dx <= 4 and 2 <= dy <= 4))
            set_function(x, y, black)


def _draw_alignment(set_function: Any, cx: int, cy: int) -> None:
    for y in range(cy - 2, cy + 3):
        for x in range(cx - 2, cx + 3):
            distance = max(abs(x - cx), abs(y - cy))
            set_function(x, y, distance in (0, 2))


def _draw_format_bits(set_function: Any, size: int, bits: int) -> None:
    for i in range(6):
        set_function(8, i, _get_bit(bits, i))
    set_function(8, 7, _get_bit(bits, 6))
    set_function(8, 8, _get_bit(bits, 7))
    set_function(7, 8, _get_bit(bits, 8))
    for i in range(9, 15):
        set_function(14 - i, 8, _get_bit(bits, i))
    for i in range(8):
        set_function(size - 1 - i, 8, _get_bit(bits, i))
    for i in range(8, 15):
        set_function(8, size - 15 + i, _get_bit(bits, i))
    set_function(8, size - 8, True)


def _format_bits(ecl: int, mask: int) -> int:
    data = (ecl << 3) | mask
    value = data << 10
    generator = 0x537
    for i in range(14, 9, -1):
        if ((value >> i) & 1) != 0:
            value ^= generator << (i - 10)
    return ((data << 10) | value) ^ 0x5412


def _get_bit(value: int, index: int) -> bool:
    return ((value >> index) & 1) != 0


def _rs_remainder(data: list[int], degree: int) -> list[int]:
    divisor = _rs_divisor(degree)
    result = [0] * degree
    for byte in data:
        factor = byte ^ result.pop(0)
        result.append(0)
        for i, coefficient in enumerate(divisor):
            result[i] ^= _gf_multiply(coefficient, factor)
    return result


def _rs_divisor(degree: int) -> list[int]:
    result = [0] * (degree - 1) + [1]
    root = 1
    for _ in range(degree):
        for j in range(degree):
            result[j] = _gf_multiply(result[j], root)
            if j + 1 < degree:
                result[j] ^= result[j + 1]
        root = _gf_multiply(root, 2)
    return result


def _gf_multiply(x: int, y: int) -> int:
    result = 0
    while y:
        if y & 1:
            result ^= x
        x <<= 1
        if x & 0x100:
            x ^= 0x11D
        y >>= 1
    return result
