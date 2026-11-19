
import os

from dotenv import load_dotenv
from google import genai

load_dotenv()

MODEL_NAME = "gemini-3.5-flash"


def generate_answer(question: str, results: list[dict]) -> dict:
    if not results:
        return {
            "answer": "I couldn't find relevant information in this document.",
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
            "answer": "I couldn't find relevant information in this document.",
            "sources": [],
        }

    prompt = f"""
You are AskBoard, a study assistant.

Answer the question using ONLY the supplied document excerpts.
- Be clear and concise.
- Do not invent facts.
- Cite supporting pages as [Page N].
- If the excerpts do not contain enough information, say so.

DOCUMENT EXCERPTS:
{"\n\n".join(context_parts)}

QUESTION:
{question}
"""

    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY is not configured.")

    client = genai.Client(api_key=api_key)
    response = client.models.generate_content(
        model=MODEL_NAME,
        contents=prompt,
    )

    return {
        "answer": response.text or "I couldn't generate an answer.",
        "sources": sources,
    }
