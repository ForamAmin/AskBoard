import hashlib
import logging
from io import BytesIO
import os
import tempfile

from fastapi import UploadFile, File, HTTPException
from starlette.concurrency import run_in_threadpool

from .transcription import transcribe_audio
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from pypdf import PdfReader
from pydantic import BaseModel, Field
from .answer import generate_answer

from . import rag
from .chunking import chunk_pages
from .teach import choose_topic, generate_hint
from .quiz import generate_quiz
from .reports import load_sessions, save_session

logger = logging.getLogger("askboard")

app = FastAPI(title="AskBoard API", version="0.2.0")


class ReportSessionRequest(BaseModel):
    id: str | None = None
    document_id: str = Field(min_length=1, max_length=64)
    filename: str = "Uploaded PDF"
    topic: str = ""
    transcript: str = ""
    duration_seconds: int = Field(default=0, ge=0, le=86400)
    started_at: str | None = None


@app.post("/api/reports/sessions")
async def report_session(request: ReportSessionRequest):
    return await run_in_threadpool(save_session, request.model_dump())


@app.get("/api/reports/overview")
async def report_overview(document_id: str | None = None):
    sessions = await run_in_threadpool(load_sessions, document_id)
    return {"sessions": sessions, "total_sessions": len(sessions)}

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5500",
        "http://127.0.0.1:5500",
        "http://localhost:8000",
        "http://127.0.0.1:8000",
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)


class SearchRequest(BaseModel):
    document_id: str = Field(min_length=1, max_length=64)
    question: str = Field(min_length=1, max_length=1000)
    top_k: int = Field(default=4, ge=1, le=10)


@app.get("/api/health")
def health_check():
    return {"status": "ok", "service": "AskBoard API"}


@app.post("/api/documents/extract")
async def extract_pdf(file: UploadFile = File(...)):
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(
            status_code=400,
            detail="Please upload a PDF file.",
        )

    content = await file.read()

    if not content:
        raise HTTPException(status_code=400, detail="The file is empty.")

    if len(content) > 15 * 1024 * 1024:
        raise HTTPException(
            status_code=413,
            detail="PDF must be smaller than 15 MB.",
        )

    try:
        reader = PdfReader(BytesIO(content))

        if reader.is_encrypted:
            raise HTTPException(
                status_code=400,
                detail="Password-protected PDFs are not supported yet.",
            )

        pages = [
            (index + 1, (page.extract_text() or "").strip())
            for index, page in enumerate(reader.pages)
        ]
        pages = [(number, page_text) for number, page_text in pages if page_text]
        page_count = len(reader.pages)

    except HTTPException:
        raise
    except Exception:
        raise HTTPException(
            status_code=400,
            detail="Could not read this PDF. Please try another file.",
        )

    text = "\n\n".join(f"[Page {number}]\n{page_text}" for number, page_text in pages)

    if not text.strip():
        raise HTTPException(
            status_code=422,
            detail="No readable text found. This may be a scanned PDF.",
        )

    # Same bytes -> same ID, so re-uploading a file replaces its chunks instead of duplicating them.
    document_id = hashlib.sha256(content).hexdigest()[:16]

    try:
        chunk_count = await run_in_threadpool(
            rag.index_document, document_id, file.filename, chunk_pages(pages)
        )
    except Exception:
        logger.exception("Indexing failed for %s", file.filename)
        raise HTTPException(
            status_code=500,
            detail="Text was extracted but indexing failed. Check the backend log.",
        )

    return {
        "document_id": document_id,
        "filename": file.filename,
        "page_count": page_count,
        "chunk_count": chunk_count,
        "character_count": len(text),
        "text": text,
    }


@app.post("/api/search")
def search(request: SearchRequest):  # plain def: FastAPI runs it in a worker thread
    question = request.question.strip()
    if not question:
        raise HTTPException(status_code=400, detail="Question cannot be empty.")

    found = rag.search_document(request.document_id, question, request.top_k)
    if found is None:
        raise HTTPException(status_code=404, detail="Document not found. Upload it first.")

    return {"document_id": request.document_id, "question": question, **found}

class AnswerRequest(BaseModel):
    document_id: str
    question: str = Field(min_length=1, max_length=2000)
    top_k: int = Field(default=4, ge=1, le=10)

@app.post("/api/answer")
async def answer_question(request: AnswerRequest):
    found = await run_in_threadpool(
        rag.search_document,
        request.document_id,
        request.question,
        request.top_k,
    )
    if found is None:
        raise HTTPException(status_code=404, detail="Document not found. Upload it first.")

    try:
        generated = await run_in_threadpool(
            generate_answer,
            request.question,
            found["results"],  # the list of chunk dicts, not the wrapper dict
        )
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Answer generation failed: {exc}",
        ) from exc

    return {
        "document_id": request.document_id,
        "question": request.question,
        **generated,
    }

class TeachHintRequest(BaseModel):
    document_id: str = Field(min_length=1, max_length=64)
    topic: str = Field(min_length=1, max_length=1000)
    previous_hint: str | None = Field(default=None, max_length=1000)
    top_k: int = Field(default=4, ge=1, le=10)
    transcript: str = ""


class QuizRequest(BaseModel):
    document_id: str = Field(min_length=1, max_length=64)
    count: int = Field(default=5, ge=5, le=15)
    difficulty: str = Field(pattern="^(easy|medium|hard)$")
    question_type: str = Field(pattern="^(multiple_choice|true_false|mixed)$")


class TeachTopicRequest(BaseModel):
    document_id: str = Field(min_length=1, max_length=64)


@app.post("/api/teach/topic")
async def teach_topic(request: TeachTopicRequest):
    found = await run_in_threadpool(
        rag.search_document,
        request.document_id,
        "main topics, concepts, processes, people, events, and definitions in this document",
        10,
    )
    if found is None:
        raise HTTPException(status_code=404, detail="Document not found. Upload it first.")
    try:
        selected = await run_in_threadpool(choose_topic, found["results"])
    except Exception as exc:
        logger.exception("Topic selection failed")
        raise HTTPException(status_code=502, detail=f"Topic selection failed: {exc}") from exc
    if not selected.get("topic"):
        raise HTTPException(status_code=422, detail="No teachable topic was found in this document.")
    return {"document_id": request.document_id, **selected}


@app.post("/api/quiz")
async def create_quiz(request: QuizRequest):
    found = await run_in_threadpool(
        rag.search_document,
        request.document_id,
        "important facts, definitions, relationships, processes, and key ideas in this document",
        10,
    )
    if found is None:
        raise HTTPException(status_code=404, detail="Document not found. Upload it first.")
    try:
        generated = await run_in_threadpool(
            generate_quiz, found["results"], request.count, request.difficulty, request.question_type
        )
    except Exception as exc:
        logger.exception("Quiz generation failed")
        raise HTTPException(status_code=502, detail=f"Quiz generation failed: {exc}") from exc
    return {"document_id": request.document_id, **generated}


@app.post("/api/teach/hint")
async def teach_hint(request: TeachHintRequest):
    topic = request.topic.strip()

    if not topic:
        raise HTTPException(
            status_code=400,
            detail="Topic cannot be empty.",
        )

    found = await run_in_threadpool(
        rag.search_document,
        request.document_id,
        topic,
        request.top_k,
    )

    if found is None:
        raise HTTPException(
            status_code=404,
            detail="Document not found. Upload it first.",
        )

    try:
        generated = await run_in_threadpool(
            generate_hint,
            request.topic,
            found["results"],
            request.previous_hint,
            request.transcript,
        )
    except Exception as exc:
        logger.exception("Teach Me hint generation failed")
        raise HTTPException(
            status_code=502,
            detail=f"Hint generation failed: {exc}",
        ) from exc

    return {
        "document_id": request.document_id,
        "topic": topic,
        **generated,
    }


@app.post("/api/transcribe-segment")
async def transcribe_segment(audio: UploadFile = File(...)):
    if not audio.filename:
        raise HTTPException(status_code=400, detail="No audio file provided.")

    suffix = os.path.splitext(audio.filename)[1].lower()

    if suffix not in {".webm", ".wav", ".mp3", ".m4a", ".ogg", ".mp4"}:
        suffix = ".webm"

    temp_path = None

    try:
        audio_bytes = await audio.read()

        if not audio_bytes:
            raise HTTPException(
                status_code=400,
                detail="The uploaded audio is empty.",
            )

        with tempfile.NamedTemporaryFile(
            suffix=suffix,
            delete=False,
        ) as temp_file:
            temp_file.write(audio_bytes)
            temp_path = temp_file.name

        result = await run_in_threadpool(
            transcribe_audio,
            temp_path,
        )

        return {
            "text": result["text"],
            "language": result["language"],
            "duration": result["duration"],
        }

    except HTTPException:
        raise
    except Exception as exc:
        print(f"Audio transcription failed: {exc}")
        raise HTTPException(
            status_code=500,
            detail="Audio transcription failed. Check the backend terminal.",
        )
    finally:
        if temp_path and os.path.exists(temp_path):
            os.remove(temp_path)

        await audio.close()
