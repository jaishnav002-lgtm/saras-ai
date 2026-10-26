"""Run a safe document-index audit/backfill with the configured backend database."""
import argparse
import json
import sys
from pathlib import Path

from sqlalchemy.exc import SQLAlchemyError

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.database import SessionLocal
from app.services.backfill import DocumentIndexBackfill


def main() -> int:
    parser = argparse.ArgumentParser(description="Repair missing or stale Saras document indexes.")
    parser.add_argument("--dry-run", action="store_true", help="Inspect only; do not write chunks, vectors, or caches.")
    args = parser.parse_args()
    db = SessionLocal()
    try:
        try:
            report = DocumentIndexBackfill().run(db, dry_run=args.dry_run)
            print(json.dumps(report.to_dict(), sort_keys=True))
            return 1 if report.failures else 0
        except SQLAlchemyError:
            print(json.dumps({"error": "configured database is unavailable"}))
            return 2
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
