import json
import re
from datetime import datetime, timezone
from pathlib import Path

STORE = Path(__file__).resolve().parent.parent / "data" / "report_sessions.json"
FILLERS = {"um", "uh", "like", "basically", "actually", "you know", "sort of"}


def analyze_session(payload: dict) -> dict:
    text = str(payload.get("transcript", "")).strip()
    words = re.findall(r"[A-Za-z]+(?:'[A-Za-z]+)?", text.lower())
    sentences = [s.strip() for s in re.split(r"[.!?]+", text) if s.strip()]
    filler_count = sum(words.count(item) for item in FILLERS if " " not in item) + sum(text.lower().count(item) for item in FILLERS if " " in item)
    unique = len(set(words))
    duration = max(0, int(payload.get("duration_seconds") or 0))
    minutes = duration / 60 if duration else 0
    return {**payload, "id": payload.get("id") or f"session-{datetime.now(timezone.utc).timestamp():.0f}", "created_at": payload.get("created_at") or datetime.now(timezone.utc).isoformat(), "word_count": len(words), "unique_words": unique, "sentence_count": len(sentences), "filler_words": filler_count, "speaking_wpm": round(len(words) / minutes) if minutes else None, "average_sentence_words": round(len(words) / len(sentences), 1) if sentences else None, "grammar": "Needs AI analysis", "pronunciation": "Not measured", "pauses": "Not measured", "hesitation": "Not measured", "explanation_quality": "Needs AI analysis", "recommendations": ["Complete another Teach It Back session to compare progress."]}


def save_session(payload: dict) -> dict:
    STORE.parent.mkdir(parents=True, exist_ok=True)
    sessions = []
    if STORE.exists():
        try: sessions = json.loads(STORE.read_text(encoding="utf-8"))
        except (OSError, ValueError): sessions = []
    item = analyze_session(payload)
    sessions = [item] + [x for x in sessions if x.get("id") != item["id"]]
    STORE.write_text(json.dumps(sessions[:200], ensure_ascii=False, indent=2), encoding="utf-8")
    return item


def load_sessions(document_id: str | None = None) -> list[dict]:
    if not STORE.exists(): return []
    try: sessions = json.loads(STORE.read_text(encoding="utf-8"))
    except (OSError, ValueError): return []
    return [x for x in sessions if not document_id or x.get("document_id") == document_id]
