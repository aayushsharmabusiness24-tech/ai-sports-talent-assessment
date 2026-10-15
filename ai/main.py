"""Command-line entry point used by the Node.js backend.

    python main.py --video <path> --activity <pushups|squats|pullups|running> --view <auto|side|front|back>
    python main.py --check

Diagnostics go to stderr. Exactly ONE line of JSON is written to stdout:
    success: {"ok": true, "status": ..., ...}
    failure: {"ok": false, "error": {"code": ..., "message": ...}}
"""

import argparse
import json
import math
import os
import sys
import traceback

ACTIVITIES = ("pushups", "squats", "pullups", "running")
VIEWS = ("auto", "side", "front", "back")


def sanitize(obj):
    """Converts NumPy types and NaN/inf into plain, JSON-safe values."""
    if obj is None or isinstance(obj, (str, bool, int)):
        return obj
    if isinstance(obj, float):
        return obj if math.isfinite(obj) else None
    if isinstance(obj, dict):
        return {str(k): sanitize(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple, set)):
        return [sanitize(v) for v in obj]
    if hasattr(obj, "tolist"):
        return sanitize(obj.tolist())
    return str(obj)


def emit(stream, payload):
    stream.write(json.dumps(sanitize(payload), ensure_ascii=True, allow_nan=False) + "\n")
    stream.flush()


def error_payload(code, message):
    return {"ok": False, "error": {"code": code, "message": message}}


def main():
    real_stdout = sys.stdout
    sys.stdout = sys.stderr  # stray prints from libraries must never corrupt the JSON line

    parser = argparse.ArgumentParser(description="AI sports video analysis")
    parser.add_argument("--video")
    parser.add_argument("--activity")
    parser.add_argument("--view", default="auto")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()

    try:
        if args.check:
            from video_analysis import self_check
            result = self_check()
            emit(real_stdout, result)
            if result["ok"]:
                print("AI environment check passed.", file=sys.stderr)
                return 0
            print("AI environment check FAILED:", file=sys.stderr)
            for problem in result["problems"]:
                print(" - " + problem, file=sys.stderr)
            return 1

        activity = (args.activity or "").lower()
        view = (args.view or "auto").lower()
        if activity not in ACTIVITIES:
            emit(real_stdout, error_payload(
                "UNSUPPORTED_ACTIVITY", "Unsupported activity. Choose one of: " + ", ".join(ACTIVITIES) + "."))
            return 2
        if view not in VIEWS:
            view = "auto"
        if not args.video or not os.path.isfile(args.video):
            emit(real_stdout, error_payload("VIDEO_UNREADABLE", "The video file could not be found."))
            return 2

        from video_analysis import analyze_video
        result = analyze_video(args.video, activity, view)
        emit(real_stdout, result)
        return 0

    except Exception as exc:  # noqa: BLE001
        if getattr(exc, "is_analysis_error", False):
            emit(real_stdout, error_payload(exc.code, exc.message))
            return 2
        if isinstance(exc, ImportError):
            traceback.print_exc(file=sys.stderr)
            emit(real_stdout, error_payload(
                "DEPENDENCY_MISSING",
                f"A required Python package is missing ({exc}). Run scripts\\setup.bat to install it."))
            return 2
        traceback.print_exc(file=sys.stderr)
        emit(real_stdout, error_payload(
            "INTERNAL", "The video analysis failed unexpectedly. See the backend console for details."))
        return 2


if __name__ == "__main__":
    sys.exit(main())