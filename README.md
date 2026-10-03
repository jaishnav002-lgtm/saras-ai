# Saras AI — Local Prototype (RAG / LLM excluded)

A local prototype of the "AI-Powered Collaborative Learning Platform" core
workflow: **auth → subjects → document upload → text extraction**.

**Per request, this build intentionally excludes:** embeddings, pgvector
similarity search, the Claude/LLM API, and the AI chat assistant. Everything
up to "extract text from an uploaded PDF/PPTX/DOCX and show it back to the
user" is implemented and tested. The RAG/chat layer can be added later on
top of the `Document` model without touching auth or subjects.

UI is intentionally minimal: black/white, monospace, no color, no chat panel.

---

## 1. Prerequisites

- Docker + Docker Compose (for PostgreSQL)
- Python 3.11+ and `pip`
- Node.js 18+ and `npm`

## 2. Start PostgreSQL

```bash
docker compose up -d
```

This starts Postgres on `localhost:5432` with database `saras_ai`, user
`saras`, password `saras_password` (see `docker-compose.yml`).

## 3. Backend setup

```bash
cd backend
python3 -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env            # defaults already match docker-compose.yml
```

### Database initialization

No manual migrations needed for this prototype — the FastAPI app creates
all tables automatically on startup (`Base.metadata.create_all`) once it can
reach Postgres.

### Start the backend

```bash
uvicorn app.main:app --reload --port 8000
```

API is now at `http://localhost:8000`. Interactive docs: `http://localhost:8000/docs`.

### Run backend tests

```bash
pytest tests/ -v
```

Tests use an isolated in-memory SQLite database (not your Postgres
instance), so they run without any external services. All 6 currently pass:
signup/login, duplicate-email rejection, wrong-password rejection, subject
ownership isolation, unsupported-file-type rejection, and DOCX
upload+extraction.

## 4. Frontend setup

```bash
cd frontend
npm install
cp .env.local.example .env.local   # points to http://localhost:8000
npm run dev
```

Open `http://localhost:3000`.

## 5. Testing the flow

1. Go to `http://localhost:3000` → redirected to `/signup`.
2. Create an account.
3. On the Dashboard, click **+ Create Subject** (e.g. "Computer Networks").
4. Click into the subject card → you're in the subject workspace.
5. Click **Choose file** and upload a `.pdf`, `.pptx`, or `.docx`.
6. The document appears with status `processed`, an extracted unit count
   (pages/slides), and a text preview.

## 6. Environment variables

Backend (`backend/.env`):

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string |
| `JWT_SECRET_KEY` | Secret for signing auth tokens — change in any real deployment |
| `JWT_ALGORITHM` | Defaults to `HS256` |
| `JWT_EXPIRE_MINUTES` | Token lifetime |
| `UPLOAD_DIR` | Local folder for uploaded files |
| `MAX_UPLOAD_MB` | Upload size limit |

Frontend (`frontend/.env.local`):

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_API_URL` | Backend base URL |

No `ANTHROPIC_API_KEY` is required — there is no LLM call in this build.

## 7. API endpoints implemented

```
POST   /api/auth/signup
POST   /api/auth/login
GET    /api/auth/me

GET    /api/subjects
POST   /api/subjects
GET    /api/subjects/{id}
DELETE /api/subjects/{id}

GET    /api/subjects/{id}/documents
POST   /api/subjects/{id}/documents      (multipart file upload)
DELETE /api/documents/{id}

GET    /api/health
```

## 8. Implemented features

- Email/password signup & login, bcrypt-hashed passwords, JWT auth
- Subject CRUD, strictly scoped to the owning user on every read/write
- Document upload (PDF/PPTX/DOCX) with file-type and size validation
- Local filesystem storage under `backend/uploads/<subject_id>/`
- Synchronous text extraction (PyMuPDF / python-pptx / python-docx),
  storing a text preview + page/slide count + processing status
- Dashboard: subject cards, document counts, last-activity timestamps
- Subject workspace: upload control, processing-status badges, delete
- Minimalist black-and-white UI (Next.js + TypeScript + Tailwind)
- Backend unit/integration tests (pytest + FastAPI TestClient)

## 9. Intentionally excluded (per request)

- pgvector, embeddings (sentence-transformers), chunking, vector similarity search
- Claude/Anthropic API calls and any LLM-generated responses
- The AI Assistant / chat page and `ChatSession` / `ChatMessage` persistence
- Video/voice/whiteboard features (also out of scope per the original spec)

The `Document` model and pipeline are structured so a RAG layer (chunking →
embeddings → pgvector → retrieval → Claude call → chat UI) can be added
later without reworking auth, subjects, or the upload flow.

## 10. Troubleshooting

- **Backend can't connect to Postgres**: confirm `docker compose ps` shows
  `postgres` as healthy, and that `DATABASE_URL` in `backend/.env` matches
  `docker-compose.yml` credentials.
- **CORS errors in the browser**: confirm the frontend is running on
  `http://localhost:3000` (the backend's CORS allow-list in `app/main.py`
  is currently hard-coded to that origin — change it if you use a different
  port).
- **`bcrypt`/`passlib` version errors**: this project pins `bcrypt==4.0.1`
  in `requirements.txt` because newer `bcrypt` releases break `passlib`'s
  version probing. Don't upgrade `bcrypt` alone.
- **File upload rejected**: only `.pdf`, `.pptx`, `.docx` are accepted, and
  files must be under `MAX_UPLOAD_MB` (default 20MB).
