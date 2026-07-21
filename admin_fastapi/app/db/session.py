from collections.abc import Generator

from sqlalchemy import MetaData, create_engine
from sqlalchemy.engine import URL, make_url
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import settings

parsed_url = make_url(settings.database_url)
if parsed_url.drivername.startswith("mysql"):
    database_url = URL.create(
        parsed_url.drivername,
        username=parsed_url.username,
        password=parsed_url.password,
        host=parsed_url.host,
        port=parsed_url.port,
        database=parsed_url.database,
        query=parsed_url.query,
    )
else:
    database_url = parsed_url

engine = create_engine(database_url, pool_pre_ping=True, future=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)
metadata = MetaData()


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
