
"""Create page-aware chunks for AskBoard's retrieval pipeline."""

import re

CHUNK_SIZE = 500
CHUNK_OVERLAP = 80


def split_text(
    text: str,
    size: int = CHUNK_SIZE,
    overlap: int = CHUNK_OVERLAP,
) -> list[str]:
    if size <= 0 or overlap < 0 or overlap >= size // 2:
        raise ValueError(
            "Use positive size and overlap smaller than half the size."
        )

    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n+", "\n", text).strip()

    if not text:
        return []

    # Split at sentence and paragraph boundaries.
    segments = [
        part.strip()
        for part in re.split(r"(?<=[.!?])\s+|\n+", text)
        if part.strip()
    ]

    # Split exceptionally long sentences at word boundaries.
    sentences = []
    for segment in segments:
        while len(segment) > size:
            cut = segment.rfind(" ", 0, size + 1)
            if cut <= 0:
                cut = size

            sentences.append(segment[:cut].strip())
            segment = segment[cut:].strip()

        if segment:
            sentences.append(segment)

    chunks = []
    current = ""

    for sentence in sentences:
        candidate = f"{current} {sentence}".strip()

        if current and len(candidate) > size:
            chunks.append(current)

            # Retain a word-aligned tail from the previous chunk.
            tail = current[-overlap:] if overlap else ""
            if tail and len(current) > overlap:
                first_space = tail.find(" ")
                tail = tail[first_space + 1:] if first_space >= 0 else ""

            current = f"{tail} {sentence}".strip() if tail else sentence

            # Never allow overlap to push the chunk beyond the limit.
            if len(current) > size:
                current = sentence
        else:
            current = candidate

    if current and (not chunks or current != chunks[-1]):
        chunks.append(current)

    return chunks


def chunk_pages(pages: list[tuple[int, str]]) -> list[dict]:
    """Convert (actual PDF page number, text) pairs into chunks."""
    return [
        {"page": page_number, "text": chunk}
        for page_number, page_text in pages
        for chunk in split_text(page_text)
    ]
