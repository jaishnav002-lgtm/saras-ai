import os
import tempfile
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from app import models, schemas
from app.auth import get_current_user
from app.config import settings
from app.timetable import extract_exams_from_file

router = APIRouter(prefix="/api/timetables", tags=["timetables"])
ALLOWED_EXTENSIONS = {"jpg", "jpeg", "png", "pdf", "csv", "xlsx"}
MIME_TYPES = {
    "jpg": {"image/jpeg"}, "jpeg": {"image/jpeg"}, "png": {"image/png"},
    "pdf": {"application/pdf"}, "csv": {"text/csv", "application/csv", "application/vnd.ms-excel", "text/plain"},
    "xlsx": {"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"},
}


@router.post("/extract", response_model=schemas.TimetableExtractionOut)
def extract_timetable(file: UploadFile = File(...), current_user: models.User = Depends(get_current_user)):
    filename = file.filename or ""
    extension = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if extension not in ALLOWED_EXTENSIONS:
        raise HTTPException(400, "Unsupported timetable type. Use JPG, PNG, PDF, CSV, or XLSX.")
    if file.content_type and file.content_type not in MIME_TYPES[extension]:
        raise HTTPException(400, "File MIME type does not match its extension.")
    contents = file.file.read()
    if not contents:
        raise HTTPException(400, "The uploaded file is empty.")
    if len(contents) > settings.max_upload_mb * 1024 * 1024:
        raise HTTPException(400, f"File is too large. Maximum is {settings.max_upload_mb} MB.")
    # Cheap signature validation before handing data to a parser/OCR engine.
    if extension == "pdf" and not contents.startswith(b"%PDF"):
        raise HTTPException(400, "This is not a valid PDF.")
    if extension == "png" and not contents.startswith(b"\x89PNG"):
        raise HTTPException(400, "This is not a valid PNG.")
    if extension in {"jpg", "jpeg"} and not contents.startswith(b"\xff\xd8"):
        raise HTTPException(400, "This is not a valid JPEG.")
    if extension == "xlsx" and not contents.startswith(b"PK"):
        raise HTTPException(400, "This is not a valid XLSX workbook.")
    with tempfile.TemporaryDirectory(prefix="saras-timetable-") as directory:
        path = Path(directory) / f"upload.{extension}"
        path.write_bytes(contents)
        try:
            entries, warnings, count = extract_exams_from_file(path, extension)
        except Exception as exc:  # OCR/parser errors must not persist or create events.
            raise HTTPException(422, f"Couldn't read your timetable: {exc}") from exc
    return schemas.TimetableExtractionOut(entries=entries, warnings=warnings, ocr_item_count=count)


@router.post("/confirm", response_model=schemas.TimetableConfirmOut)
def confirm_timetable(payload: schemas.TimetableConfirmRequest, current_user: models.User = Depends(get_current_user)):
    if not payload.entries:
        raise HTTPException(400, "Add at least one exam before confirming.")
    for entry in payload.entries:
        if not entry.subject.strip() or not entry.date:
            raise HTTPException(400, "Every exam needs a subject and a complete date before confirmation.")
        if any("Missing exam date" in warning or "no year" in warning for warning in entry.warnings):
            raise HTTPException(400, "Resolve incomplete dates before confirmation.")
    batch_id = f"timetable_{uuid.uuid4().hex}"
    # Calendar is intentionally client-local in the existing app.  This endpoint
    # validates review data and supplies batch metadata; it does not create events.
    return schemas.TimetableConfirmOut(batch_id=batch_id, entries=payload.entries)
