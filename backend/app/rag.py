"""Embedding + ChromaDB storage and retrieval, scoped by document ID."""

import os
from functools import lru_cache
from pathlib import Path

import chromadb
from chromadb.config import Settings
from sentence_transformers import SentenceTransformer

MODEL_NAME = os.getenv("ASKBOARD_EMBED_MODEL", "sentence-transformers/all-MiniLM-L6-v2")
CHROMA_PATH = os.getenv("ASKBOARD_CHROMA_PATH") or str(Path(__file__).resolve().parents[1] / "chroma_db")
COLLECTION_NAME = "askboard_chunks"
ADD_BATCH_SIZE = 256


@lru_cache(maxsize=1)
def get_model() -> SentenceTransformer:
    return SentenceTransformer(MODEL_NAME, device="cpu")


@lru_cache(maxsize=1)
def get_collection():
    client = chromadb.PersistentClient(path=CHROMA_PATH, settings=Settings(anonymized_telemetry=False))
    return client.get_or_create_collection(
        COLLECTION_NAME,
        embedding_function=None,  # we supply our own vectors
        metadata={"hnsw:space": "cosine"},
    )


def embed(texts: list[str]) -> list[list[float]]:
    vectors = get_model().encode(texts, batch_size=32, normalize_embeddings=True, show_progress_bar=False)
    return vectors.tolist()


def index_document(document_id: str, filename: str, chunks: list[dict]) -> int:
    """Replace any existing chunks for this document, then embed and store the new ones."""
    collection = get_collection()
    collection.delete(where={"document_id": document_id})

    for offset in range(0, len(chunks), ADD_BATCH_SIZE):
        batch = chunks[offset : offset + ADD_BATCH_SIZE]
        texts = [chunk["text"] for chunk in batch]
        collection.add(
            ids=[f"{document_id}:{offset + i}" for i in range(len(batch))],
            documents=texts,
            embeddings=embed(texts),
            metadatas=[
                {
                    "document_id": document_id,
                    "filename": filename,
                    "page": chunk["page"],
                    "chunk_index": offset + i,
                }
                for i, chunk in enumerate(batch)
            ],
        )
    return len(chunks)


def search_document(document_id: str, question: str, top_k: int) -> dict | None:
    """Top-k chunks of one document for a question, or None if the document is unknown."""
    collection = get_collection()
    scope = {"document_id": document_id}

    stored_ids = collection.get(where=scope, include=[])["ids"]
    if not stored_ids:
        return None

    found = collection.query(
        query_embeddings=embed([question]),
        n_results=min(top_k, len(stored_ids)),
        where=scope,
        include=["documents", "metadatas", "distances"],
    )

    results = [
        {
            "rank": rank,
            "chunk_id": chunk_id,
            "page": meta["page"],
            "reference": f"Page {meta['page']}",
            "score": round(1 - distance, 4),  # cosine similarity
            "text": text,
        }
        for rank, (chunk_id, text, meta, distance) in enumerate(
            zip(found["ids"][0], found["documents"][0], found["metadatas"][0], found["distances"][0]),
            start=1,
        )
    ]
    return {"filename": found["metadatas"][0][0]["filename"], "results": results}