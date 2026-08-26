# transcribe.py — Whisper transcription worker for ViralClipper.
#
# Usage:  python transcribe.py <video_path> [model_size] [duration_seconds]
#
# Emits newline-delimited JSON on stdout (flushed per line):
#   {"type":"progress","progress":42.1}
#   {"type":"result","segments":[{"start":0.0,"end":4.2,"text":"..."}, ...]}
#   {"type":"error","message":"..."}
#
# Designed for the tiny/base faster-whisper models on CPU with batch_size=1
# so it fits comfortably in ~2GB RAM.
import json
import sys
import traceback


def emit(obj):
    """Print one JSON line immediately (line-buffered IPC)."""
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


def main():
    if len(sys.argv) < 2:
        emit({"type": "error", "message": "usage: transcribe.py <video> [model] [duration]"})
        return 1

    video_path = sys.argv[1]
    model_size = sys.argv[2] if len(sys.argv) > 2 else "tiny"
    duration = float(sys.argv[3]) if len(sys.argv) > 3 and float(sys.argv[3] or 0) > 0 else None

    # Import here so argument errors print before the heavy load.
    from faster_whisper import WhisperModel

    emit({"type": "log"})

    model = WhisperModel(model_size, device="cpu", compute_type="int8")

    segments_iter, info = None, None
    try:
        # Prefer batched inference when available (still batch_size=1).
        from faster_whisper import BatchedInferencePipeline
        pipeline = BatchedInferencePipeline(model=model)
        segments_iter, info = pipeline.transcribe(
            video_path, batch_size=1, vad_filter=True, language=None
        )
    except Exception:
        segments_iter, info = model.transcribe(video_path, beam_size=1, vad_filter=True)

    total = duration or getattr(info, "duration", None)

    results = []
    for seg in segments_iter:
        results.append({
            "start": round(float(seg.start), 3),
            "end": round(float(seg.end), 3),
            "text": seg.text.strip(),
        })
        pct = min(99.0, (seg.end / total * 100.0)) if total else 0.0
        emit({"type": "progress", "progress": round(pct, 2)})

    emit({"type": "result", "segments": results})
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except SystemExit:
        raise
    except Exception as e:  # noqa: BLE001 — report any failure over the wire
        emit({"type": "error", "message": f"{e}\n{traceback.format_exc()[-500:]}"})
        sys.exit(1)
