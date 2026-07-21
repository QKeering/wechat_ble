from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Depends, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.core.responses import error, success
from app.db.session import get_db
from app.services.device_qrcode import profile_resource_response

router = APIRouter(tags=["common"])


def save_upload(file: UploadFile, folder: str = "common") -> dict:
    suffix = Path(file.filename or "").suffix.lower()
    upload_dir = Path("uploads") / folder
    upload_dir.mkdir(parents=True, exist_ok=True)
    target = upload_dir / f"{uuid4().hex}{suffix}"
    return {"target": target, "url": f"/common/download/resource?resource={target.as_posix()}"}


@router.post("/common/upload")
@router.post("/admin/common/upload")
async def common_upload(file: UploadFile):
    saved = save_upload(file)
    content = await file.read()
    saved["target"].write_bytes(content)
    url = f"/uploads/common/{saved['target'].name}"
    data = success()
    data.update({
        "url": url,
        "fileName": url,
        "newFileName": url,
        "originalFilename": file.filename,
        "fileSize": len(content),
    })
    return data


@router.post("/common/uploads")
@router.post("/admin/common/uploads")
async def common_uploads(files: list[UploadFile]):
    urls = []
    names = []
    original = []
    for file in files:
        saved = save_upload(file)
        saved["target"].write_bytes(await file.read())
        url = f"/uploads/common/{saved['target'].name}"
        urls.append(url)
        names.append(url)
        original.append(file.filename or "")
    data = success()
    data.update({"urls": ",".join(urls), "fileNames": ",".join(names), "originalFilenames": ",".join(original)})
    return data


@router.get("/common/download")
@router.get("/admin/common/download")
def common_download(fileName: str, delete: bool = False):
    path = Path(fileName)
    if not path.is_absolute():
        path = Path("uploads") / path.name
        if not path.exists():
            path = Path("uploads/common") / fileName
    if not path.exists():
        return error("文件不存在")
    return FileResponse(path, filename=path.name)


@router.get("/profile/{resource:path}")
def profile_resource(resource: str, db: Session = Depends(get_db)):
    return profile_resource_response(resource, db)


@router.get("/common/download/resource")
@router.get("/admin/common/download/resource")
def common_download_resource(resource: str):
    path = Path(resource)
    if not path.exists():
        return error("资源不存在")
    return FileResponse(path, filename=path.name)
