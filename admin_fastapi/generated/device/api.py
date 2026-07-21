from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.core.responses import error, success, table
from app.db.session import get_db
from app.services.crud import create_row, delete_rows, get_row, list_rows, update_row

router = APIRouter(prefix="/admin/device", tags=["device"])


@router.get("/list")
def list_items(request: Request, db: Session = Depends(get_db)):
    query = dict(request.query_params)
    page_num = int(query.pop("pageNum", 1) or 1)
    page_size = int(query.pop("pageSize", 10) or 10)
    rows, total = list_rows(db, "device", query, page_num, page_size)
    return table(rows, total)


@router.get("/{row_id}")
def get_item(row_id: str, db: Session = Depends(get_db)):
    return success(get_row(db, "device", row_id))


@router.post("")
async def create_item(request: Request, db: Session = Depends(get_db)):
    return success() if create_row(db, "device", await request.json()) > 0 else error()


@router.put("")
async def update_item(request: Request, db: Session = Depends(get_db)):
    return success() if update_row(db, "device", await request.json()) > 0 else error()


@router.delete("/{ids}")
def delete_items(ids: str, db: Session = Depends(get_db)):
    return success() if delete_rows(db, "device", ids) > 0 else error()
