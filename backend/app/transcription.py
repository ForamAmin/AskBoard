
from faster_whisper import WhisperModel

MODEL_SIZE = "small"

# Load the model once and reuse it for subsequent audio segments.
# CPU + int8 is suitable for testing on your laptop.
_model = None


def get_model():
    global _model

    if _model is None:
        _model = WhisperModel(
            MODEL_SIZE,
            device="cpu",
            compute_type="int8",
        )

    return _model


def transcribe_audio(audio_path: str) -> dict:
    """
    Transcribe one audio segment and return its text.
    The audio file must exist at audio_path.
    """
    model = get_model()

    segments, info = model.transcribe(
        audio_path,
        beam_size=1,
        vad_filter=True,
    )

    text = " ".join(
        segment.text.strip()
        for segment in segments
        if segment.text.strip()
    ).strip()

    return {
        "text": text,
        "language": info.language,
        "duration": info.duration,
    }
