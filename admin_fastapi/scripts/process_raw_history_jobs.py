from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.db.session import SessionLocal
from app.services.health import process_ring_history_raw_upload_jobs


def main() -> int:
    parser = argparse.ArgumentParser(description="Process queued ring raw history upload jobs.")
    parser.add_argument("--limit", type=int, default=50, help="max jobs to process in one run")
    parser.add_argument("--max-retry", type=int, default=5, help="max retry count for failed jobs")
    args = parser.parse_args()

    db = SessionLocal()
    try:
        result = process_ring_history_raw_upload_jobs(db, limit=args.limit, max_retry=args.max_retry)
        print(json.dumps(result, ensure_ascii=False, default=str))
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
