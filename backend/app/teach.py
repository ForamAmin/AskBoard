
import os

from dotenv import load_dotenv
from google import genai

load_dotenv()

MODEL_NAME = "gemini-3.5-flash"
_client = None


def get_client():
    global _client
    if _client is None:
        api_key = os.getenv("GEMINI_API_KEY")
        if not api_key:
            raise RuntimeError("GEMINI_API_KEY is not configured.")
        _client = genai.Client(api_key=api_key)
    return _client


def generate_hint(
    topic: str,
    results: list[dict],
    previous_hint: str | None = None,
    transcript: str = "",
) -> dict:
    """Generate a progressive hint grounded in retrieved PDF passages."""

    if not results:
        return {
            "hint": "I couldn't find relevant information in this document.",
            "sources": [],
        }

    context_parts = []
    sources = []

    for result in results:
        page = result.get("page")
        text = result.get("text", "").strip()

        if not text:
            continue

        context_parts.append(f"[Page {page}]\n{text}")
        sources.append({
            "page": page,
            "reference": result.get("reference", f"Page {page}"),
            "text": text,
        })

    if not context_parts:
        return {
            "hint": "I couldn't find relevant information in this document.",
            "sources": [],
        }

    if previous_hint:
        hint_instruction = (
            "Give a stronger, more specific hint than the previous hint. "
            "Still do not reveal the complete answer."
        )
    else:
        hint_instruction = (
            "Give one small clue that helps the student reason independently. "
            "Do not reveal the complete answer."
        )

    context_text = "\n\n".join(context_parts)
    prompt = f"""
You are AskBoard's Teach Me hint assistant.

Help a student who is stuck while studying.

Rules:
- Use ONLY the supplied document excerpts.
- Give one short, useful hint (1-3 sentences).
- Never provide the complete answer or solve the whole problem.
- Do not invent facts beyond the excerpts.
- If the excerpts do not contain enough information, say so.
- Cite relevant pages using [Page N].
- {hint_instruction}

DOCUMENT EXCERPTS:
{context_text}

STUDENT'S TOPIC OR QUESTION:
{topic}

STUDENT'S EXPLANATION SO FAR:
{transcript or "No transcript available yet."}

PREVIOUS HINT:
{previous_hint or "None"}
"""

    response = get_client().models.generate_content(
        model=MODEL_NAME,
        contents=prompt,
    )

    return {
        "hint": response.text or "I couldn't generate a hint.",
        "sources": sources,
    }


def choose_topic(results: list[dict]) -> dict:
    """Choose one concise, teachable topic using only retrieved PDF passages."""
    context = "\n\n".join(
        f"[Page {item.get('page')}]\n{item.get('text', '').strip()}"
        for item in results if item.get("text", "").strip()
    )
    if not context:
        return {"topic": "", "sources": []}
    prompt = f"""Choose one specific, teachable topic from ONLY these PDF excerpts.
Return JSON only in this exact shape: {{"topic":"...","page":1}}.
The topic must be a named concept, process, event, or idea explicitly supported by the excerpts.
Do not invent a topic or add explanation.

PDF EXCERPTS:
{context}"""
    response = get_client().models.generate_content(
        model=MODEL_NAME, contents=prompt
    )
    import json
    payload = json.loads((response.text or "").strip().removeprefix("```json").removesuffix("```").strip())
    topic = payload.get("topic", "").strip()
    return {"topic": topic, "page": payload.get("page")}
