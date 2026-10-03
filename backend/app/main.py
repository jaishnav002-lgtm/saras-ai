from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.database import Base, engine
from app import models  # noqa: F401  (ensures models are registered before create_all)
from app.routers import auth, subjects, documents, timetables

app = FastAPI(title="Saras")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


from sqlalchemy import text


@app.on_event("startup")
def on_startup():
    # Simple init mechanism for the prototype: create tables if they don't exist.
    Base.metadata.create_all(bind=engine)
    try:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE documents ADD COLUMN extracted_text TEXT"))
    except Exception:
        pass


app.include_router(auth.router)
app.include_router(subjects.router)
app.include_router(documents.router)
app.include_router(timetables.router)


@app.get("/api/health")
def health():
    return {"status": "ok"}
