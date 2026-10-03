"""
Basic tests: signup/login, subject ownership, document upload+extraction.
Uses an in-memory SQLite DB (swapped in via dependency override) so tests
run without needing a live Postgres instance.
"""
import io
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.main import app
from app.database import Base, get_db

TEST_DB_URL = "sqlite:///./test.db"
engine = create_engine(TEST_DB_URL, connect_args={"check_same_thread": False})
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


app.dependency_overrides[get_db] = override_get_db


@pytest.fixture(scope="module", autouse=True)
def setup_db():
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)
    if os.path.exists("test.db"):
        os.remove("test.db")


client = TestClient(app)


def signup(email="alice@example.com", password="password123", name="Alice"):
    return client.post(
        "/api/auth/signup", json={"name": name, "email": email, "password": password}
    )


def test_signup_and_login():
    r = signup()
    assert r.status_code == 200
    assert "access_token" in r.json()

    r2 = client.post(
        "/api/auth/login", json={"email": "alice@example.com", "password": "password123"}
    )
    assert r2.status_code == 200
    token = r2.json()["access_token"]

    me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200
    assert me.json()["email"] == "alice@example.com"


def test_duplicate_signup_rejected():
    r = signup(email="bob@example.com")
    assert r.status_code == 200
    r2 = signup(email="bob@example.com")
    assert r2.status_code == 400


def test_wrong_password_rejected():
    signup(email="carol@example.com", password="rightpassword")
    r = client.post(
        "/api/auth/login", json={"email": "carol@example.com", "password": "wrongpassword"}
    )
    assert r.status_code == 401


def _auth_header(email, password="password123"):
    signup(email=email, password=password)
    r = client.post("/api/auth/login", json={"email": email, "password": password})
    token = r.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def test_subject_crud_and_ownership():
    headers_a = _auth_header("dave@example.com")
    headers_b = _auth_header("erin@example.com")

    r = client.post(
        "/api/subjects",
        json={"name": "Computer Networks", "description": "CN course"},
        headers=headers_a,
    )
    assert r.status_code == 200
    subject_id = r.json()["id"]

    # Owner can fetch it
    r2 = client.get(f"/api/subjects/{subject_id}", headers=headers_a)
    assert r2.status_code == 200

    # Different user cannot access it
    r3 = client.get(f"/api/subjects/{subject_id}", headers=headers_b)
    assert r3.status_code == 403

    # No auth at all
    r4 = client.get(f"/api/subjects/{subject_id}")
    assert r4.status_code in (401, 403)


def test_unsupported_file_type_rejected():
    headers = _auth_header("frank@example.com")
    r = client.post(
        "/api/subjects", json={"name": "Algorithms"}, headers=headers
    )
    subject_id = r.json()["id"]

    fake_file = io.BytesIO(b"not a real doc")
    r2 = client.post(
        f"/api/subjects/{subject_id}/documents",
        files={"file": ("notes.txt", fake_file, "text/plain")},
        headers=headers,
    )
    assert r2.status_code == 400


def test_docx_upload_and_extraction():
    import docx

    headers = _auth_header("grace@example.com")
    r = client.post(
        "/api/subjects", json={"name": "Data Engineering"}, headers=headers
    )
    subject_id = r.json()["id"]

    doc = docx.Document()
    doc.add_paragraph("Hello from a test document.")
    doc.add_paragraph("Second paragraph with more content.")
    buf = io.BytesIO()
    doc.save(buf)
    buf.seek(0)

    r2 = client.post(
        f"/api/subjects/{subject_id}/documents",
        files={
            "file": (
                "sample.docx",
                buf,
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            )
        },
        headers=headers,
    )
    assert r2.status_code == 200
    body = r2.json()
    assert body["status"] == "processed"
    assert "Hello from a test document" in body["extracted_preview"]

    r3 = client.get(f"/api/subjects/{subject_id}/documents", headers=headers)
    assert r3.status_code == 200
    assert len(r3.json()) == 1

    doc_id = body["id"]

    # Access document details and full text
    r_detail = client.get(f"/api/documents/{doc_id}", headers=headers)
    assert r_detail.status_code == 200
    detail_body = r_detail.json()
    assert "Second paragraph with more content" in detail_body["extracted_text"]

    # Access file with Authorization header
    r_file = client.get(f"/api/documents/{doc_id}/file", headers=headers)
    assert r_file.status_code == 200
    assert len(r_file.content) > 0

    # Access file with token query param
    token = headers["Authorization"].split(" ")[1]
    r_file_query = client.get(f"/api/documents/{doc_id}/file?token={token}")
    assert r_file_query.status_code == 200
    assert len(r_file_query.content) > 0

    # Another user cannot access the file
    other_headers = _auth_header("intruder@example.com")
    r_forbidden = client.get(f"/api/documents/{doc_id}/file", headers=other_headers)
    assert r_forbidden.status_code == 403


def test_pptx_upload_and_visual_slides_parsing():
    from pptx import Presentation
    from pptx.util import Inches, Pt

    headers = _auth_header("helen@example.com")
    r = client.post(
        "/api/subjects", json={"name": "Cloud Computing"}, headers=headers
    )
    subject_id = r.json()["id"]

    prs = Presentation()
    prs.slide_width = Inches(13.333)
    prs.slide_height = Inches(7.5)
    slide = prs.slides.add_slide(prs.slide_layouts[6])

    txBox = slide.shapes.add_textbox(Inches(1), Inches(1), Inches(10), Inches(2))
    p = txBox.text_frame.paragraphs[0]
    p.text = "Visual Cloud Slide"
    p.font.size = Pt(28)
    p.font.bold = True

    buf = io.BytesIO()
    prs.save(buf)
    buf.seek(0)

    r_up = client.post(
        f"/api/subjects/{subject_id}/documents",
        files={
            "file": (
                "presentation.pptx",
                buf,
                "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            )
        },
        headers=headers,
    )
    assert r_up.status_code == 200
    doc_id = r_up.json()["id"]

    # Test visual slides endpoint
    r_slides = client.get(f"/api/documents/{doc_id}/slides", headers=headers)
    assert r_slides.status_code == 200
    data = r_slides.json()
    assert data["total_slides"] == 1
    assert len(data["slides"][0]["elements"]) >= 1
    assert data["slides"][0]["elements"][0]["type"] == "text"


def test_timetable_csv_review_then_confirmation():
    """CSV bypasses OCR; confirmation returns metadata but creates no DB event."""
    headers = _auth_header("timetable@example.com")
    csv_data = (
        b"Subject,Exam Date,Exam Time,Venue\n"
        b"Algorithms,15/03/2026,10:00 AM - 12:00 PM,Hall A\n"
        b"Databases,28/09/2026,2:00 PM - 4:00 PM,Room 304\n"
        b"Networks,05/10/2026,10:00 AM - 12:00 PM,Hall B\n"
    )
    extracted = client.post(
        "/api/timetables/extract",
        files={"file": ("exams.csv", io.BytesIO(csv_data), "text/csv")},
        headers=headers,
    )
    assert extracted.status_code == 200
    entries = extracted.json()["entries"]
    assert [entry["date"] for entry in entries] == ["2026-03-15", "2026-09-28", "2026-10-05"]
    assert extracted.json()["ocr_item_count"] == 0

    confirmed = client.post("/api/timetables/confirm", json={"entries": entries}, headers=headers)
    assert confirmed.status_code == 200
    assert confirmed.json()["batch_id"].startswith("timetable_")
    assert confirmed.json()["entries"] == entries
