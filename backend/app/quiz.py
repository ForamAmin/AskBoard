"""Grounded quiz generation for one document's retrieved excerpts."""
import json
import os

from dotenv import load_dotenv
from google import genai

load_dotenv()


def generate_quiz(results: list[dict], count: int, difficulty: str, question_type: str) -> dict:
    context = []
    sources = []
    for result in results:
        text = result.get("text", "").strip()
        if not text:
            continue
        page = result.get("page")
        context.append(f"[Page {page}]\n{text}")
        sources.append({"page": page, "reference": result.get("reference", f"Page {page}"), "text": text})
    if not context:
        return {"questions": [], "sources": []}

    context_text = "\n\n".join(context)
    prompt = f"""You create a study quiz using ONLY the document excerpts below.
Return valid JSON only, with this exact shape:
{{"questions":[{{"question":"...","type":"multiple_choice|true_false","options":["..."],"answer":0,"explanation":"...","page":1}}]}}
Rules:
- Create exactly {count} questions if the excerpts support that many.
- Difficulty: {difficulty}. Requested type: {question_type}.
- For multiple_choice, provide exactly 4 options and answer is the zero-based index.
- For true_false, options must be ["True","False"] and answer is 0 or 1.
- Use only facts stated in the excerpts. Do not use outside knowledge.
- Every question must have a concise explanation and the supporting page number.
- Do not include markdown fences or extra text.

DOCUMENT EXCERPTS:
{context_text}"""
    MODEL_NAME = "gemini-3.5-flash"
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY is not configured.")

    client = genai.Client(api_key=api_key)

    try:
        response = client.models.generate_content(
            model=MODEL_NAME,
            contents=prompt,
        )
    finally:
        client.close()

    raw = (
        (response.text or "")
        .strip()
        .removeprefix("```json")
        .removesuffix("```")
        .strip()
    )

    payload = json.loads(raw)
    questions = payload.get("questions")

    if not isinstance(questions, list):
        raise ValueError("Quiz generation returned no questions.")

    return {
        "questions": questions[:count],
        "sources": sources,
    }
