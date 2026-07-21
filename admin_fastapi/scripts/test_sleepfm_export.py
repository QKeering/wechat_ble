"""Call the SleepFM real-user export API from an external machine.

Run with the defaults below:
    python scripts/test_sleepfm_export.py
"""

from __future__ import annotations

import argparse
import json
import os
import ssl
import sys
import urllib.error
import urllib.request
from datetime import datetime
from uuid import uuid4


# Test defaults: edit these four values when the test environment changes.
DEFAULT_BASE_URL = "http://127.0.0.1:8000"
DEFAULT_SERVICE_TOKEN = "qkeer-sleepfm-test-token"
DEFAULT_USER_ID = "6"
DEFAULT_NIGHT_IDS = ["night_20251224"]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Test the SleepFM export API")
    parser.add_argument(
        "--base-url",
        default=os.getenv("SLEEPFM_BASE_URL", DEFAULT_BASE_URL),
        help="Server base URL, for example https://api.example.com",
    )
    parser.add_argument("--user-id", default=DEFAULT_USER_ID, help="Authorized app_user.id or app_user.code")
    parser.add_argument(
        "--night-id",
        action="append",
        default=None,
        help="Night ID such as night_20260714; repeat for multiple nights",
    )
    parser.add_argument(
        "--token",
        default=os.getenv("SLEEPFM_SERVICE_TOKEN", DEFAULT_SERVICE_TOKEN),
        help=argparse.SUPPRESS,
    )
    parser.add_argument("--timeout", type=float, default=30, help="Request timeout in seconds")
    parser.add_argument(
        "--insecure",
        action="store_true",
        help="Disable TLS certificate validation for temporary test environments only",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    night_ids = args.night_id or DEFAULT_NIGHT_IDS
    if not args.token:
        print("Error: set SLEEPFM_SERVICE_TOKEN before running the script.", file=sys.stderr)
        return 2

    url = args.base_url.rstrip("/") + "/api/v1/ai-health/sleepfm-input/export"
    request_id = f"req_{datetime.now():%Y%m%d_%H%M%S}_{uuid4().hex[:6]}"
    payload = {
        "schema_version": "sleepfm_real_user_input_v1",
        "request_id": request_id,
        "user_id": args.user_id,
        "night_ids": night_ids,
        "date_range": None,
        "preferred_input_mode": "auto",
        "include_labels": True,
        "deidentify": True,
        "max_nights": min(len(night_ids), 31),
    }
    request = urllib.request.Request(
        url,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {args.token}",
            "Content-Type": "application/json; charset=utf-8",
            "Accept": "application/json",
        },
        method="POST",
    )
    ssl_context = ssl._create_unverified_context() if args.insecure else None

    print(f"POST {url}")
    print(f"request_id: {request_id}")
    try:
        with urllib.request.urlopen(request, timeout=args.timeout, context=ssl_context) as response:
            body = response.read().decode("utf-8")
            print(f"HTTP {response.status}")
            print_json(body)
            return 0
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        print(f"HTTP {exc.code}", file=sys.stderr)
        print_json(body, stream=sys.stderr)
        return 1
    except urllib.error.URLError as exc:
        print(f"Connection failed: {exc.reason}", file=sys.stderr)
        return 1


def print_json(raw: str, stream=sys.stdout) -> None:
    try:
        print(json.dumps(json.loads(raw), ensure_ascii=False, indent=2), file=stream)
    except json.JSONDecodeError:
        print(raw, file=stream)


if __name__ == "__main__":
    raise SystemExit(main())
