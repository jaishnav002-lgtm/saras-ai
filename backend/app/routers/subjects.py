from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.database import get_db
from app import models, schemas
from app.auth import get_current_user
from app.services.retrieval import HybridRetrievalService
from app.services.retrieval_cache import RetrievalCache
from app.services.answering import GroundedAnswerService
from app.services.answer_cache import AnswerCache
from app.services.exceptions import RAGServiceError

router = APIRouter(prefix="/api/subjects", tags=["subjects"])


def _to_subject_out(subject: models.Subject) -> schemas.SubjectOut:
    doc_count = len(subject.documents)
    last_activity = subject.created_at
    if subject.documents:
        last_activity = max(d.uploaded_at for d in subject.documents)
    return schemas.SubjectOut(
        id=subject.id,
        name=subject.name,
        description=subject.description,
        created_at=subject.created_at,
        document_count=doc_count,
        last_activity=last_activity,
    )


def get_owned_subject(subject_id: str, db: Session, user: models.User) -> models.Subject:
    subject = db.query(models.Subject).filter(models.Subject.id == subject_id).first()
    if not subject:
        raise HTTPException(status_code=404, detail="Subject not found")
    if subject.user_id != user.id:
        raise HTTPException(status_code=403, detail="You do not have access to this subject")
    return subject


@router.get("", response_model=list[schemas.SubjectOut])
def list_subjects(
    db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)
):
    subjects = (
        db.query(models.Subject).filter(models.Subject.user_id == current_user.id).all()
    )
    return [_to_subject_out(s) for s in subjects]


@router.post("", response_model=schemas.SubjectOut)
def create_subject(
    payload: schemas.SubjectCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    subject = models.Subject(
        user_id=current_user.id, name=payload.name, description=payload.description
    )
    db.add(subject)
    db.commit()
    db.refresh(subject)
    return _to_subject_out(subject)


@router.get("/{subject_id}", response_model=schemas.SubjectOut)
def get_subject(
    subject_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    subject = get_owned_subject(subject_id, db, current_user)
    return _to_subject_out(subject)


@router.post("/{subject_id}/retrieve", response_model=schemas.RetrievalResponse)
def retrieve_subject_chunks(
    subject_id: str,
    payload: schemas.RetrievalRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    # Validate ownership before constructing either keyword or semantic ranking.
    get_owned_subject(subject_id, db, current_user)
    results, cached = HybridRetrievalService().retrieve(
        payload.question, subject_id, current_user.id, db, payload.top_k
    )
    return {"results": results, "cached": cached}


@router.post("/{subject_id}/answer", response_model=schemas.GroundedAnswerResponse)
def answer_subject_question(
    subject_id: str,
    payload: schemas.AnswerRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    get_owned_subject(subject_id, db, current_user)
    try:
        answer, sources, cached = GroundedAnswerService().answer(
            payload.question, subject_id, current_user.id, db, payload.top_k
        )
    except RAGServiceError as exc:
        # Provider failures are safe diagnostic messages and never cache partial output.
        raise HTTPException(status_code=503, detail=str(exc))
    return {"answer": answer, "sources": sources, "cached": cached}


@router.delete("/{subject_id}")
def delete_subject(
    subject_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    subject = get_owned_subject(subject_id, db, current_user)
    RetrievalCache().invalidate_subject(db, subject_id)
    AnswerCache().invalidate_subject(db, subject_id)
    db.delete(subject)
    db.commit()
    return {"detail": "Subject deleted"}
