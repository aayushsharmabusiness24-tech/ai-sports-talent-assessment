"""Video decoding, MediaPipe pose extraction and validation.

Reads the uploaded video frame by frame (about 30 analysed frames per second), runs the
MediaPipe Pose Landmarker on each, tracks the main person, builds a PoseSequence and hands it
to exercise_service for activity-specific analysis.
"""

from __future__ import annotations

import os
import sys
import time
from typing import Dict, List, Tuple

import cv2
import numpy as np

from exercise_service import ACTIVITY_LABELS, analyze_activity
from pose_utils import AnalysisError, PoseSequence

AI_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_PATH = os.path.join(AI_DIR, "model", "pose_landmarker_full.task")
MODEL_URL = ("https://storage.googleapis.com/mediapipe-models/pose_landmarker/"
             "pose_landmarker_full/float16/latest/pose_landmarker_full.task")

TARGET_FPS = 30.0
MAX_SIDE = 640
MAX_ANALYSIS_SECONDS = 150.0
MAX_FRAMES = 4600
MIN_LANDMARKS_FOR_POSE = 8
MIN_VIDEO_SECONDS = 1.5
LOST_FRAMES_RESET = 15


def log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


def load_model_bytes() -> bytes:
    if not os.path.isfile(MODEL_PATH):
        raise AnalysisError(
            "MODEL_MISSING",
            "The pose model file is missing. Run scripts\\setup.bat, or download it from "
            f"{MODEL_URL} and save it as ai\\model\\pose_landmarker_full.task")
    if os.path.getsize(MODEL_PATH) < 1_000_000:
        raise AnalysisError("MODEL_MISSING", "The pose model file looks incomplete. Delete "
                            "ai\\model\\pose_landmarker_full.task and run scripts\\setup.bat again.")
    with open(MODEL_PATH, "rb") as f:
        return f.read()


def create_landmarker(num_poses: int = 2):
    """Returns (landmarker, mediapipe_module)."""
    model_bytes = load_model_bytes()
    try:
        import mediapipe as mp
        from mediapipe.tasks import python as mp_python
        from mediapipe.tasks.python import vision
    except ImportError as exc:
        raise AnalysisError("DEPENDENCY_MISSING", f"MediaPipe is not installed: {exc}. Run scripts\\setup.bat.")
    options = vision.PoseLandmarkerOptions(
        base_options=mp_python.BaseOptions(model_asset_buffer=model_bytes),
        running_mode=vision.RunningMode.VIDEO,
        num_poses=num_poses,
        min_pose_detection_confidence=0.5,
        min_pose_presence_confidence=0.5,
        min_tracking_confidence=0.5,
        output_segmentation_masks=False,
    )
    return vision.PoseLandmarker.create_from_options(options), mp


def self_check() -> Dict:
    """Used by `main.py --check` (setup.bat and /api/health)."""
    problems: List[str] = []
    versions: Dict[str, str] = {}
    for name in ("numpy", "cv2", "mediapipe"):
        try:
            mod = __import__(name)
            versions[name] = getattr(mod, "__version__", "unknown")
        except ImportError as exc:
            problems.append(f"Python package '{name}' is not installed ({exc}). Run scripts\\setup.bat.")
    model_found = os.path.isfile(MODEL_PATH) and os.path.getsize(MODEL_PATH) > 1_000_000
    if not model_found:
        problems.append("Pose model missing or incomplete: ai\\model\\pose_landmarker_full.task "
                        f"(download: {MODEL_URL})")
    if not problems:
        landmarker = None
        try:
            landmarker, mp = create_landmarker()
            blank = np.zeros((256, 256, 3), dtype=np.uint8)
            landmarker.detect_for_video(mp.Image(image_format=mp.ImageFormat.SRGB, data=blank), 0)
        except AnalysisError as exc:
            problems.append(exc.message)
        except Exception as exc:  # noqa: BLE001
            problems.append(f"The pose model failed to load: {exc}")
        finally:
            if landmarker is not None:
                try:
                    landmarker.close()
                except Exception:  # noqa: BLE001
                    pass
    return {"ok": not problems, "python": sys.version.split()[0], "versions": versions,
            "modelFound": bool(model_found), "problems": problems}


def _pose_candidates(result, pw: int, ph: int) -> List[Tuple]:
    cands = []
    for lms in result.pose_landmarks:
        xy = np.array([[lm.x * pw, lm.y * ph] for lm in lms], dtype=float)
        vis = np.array([lm.visibility if lm.visibility is not None else 0.0 for lm in lms], dtype=float)
        good = vis >= 0.5
        if int(good.sum()) < MIN_LANDMARKS_FOR_POSE:
            continue
        height = float(xy[good, 1].max() - xy[good, 1].min())
        centroid = xy[good].mean(axis=0)
        cands.append((xy, vis, height, centroid))
    return cands


def extract_pose_sequence(video_path: str):
    """Returns (PoseSequence, video_info, warnings)."""
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise AnalysisError("VIDEO_UNREADABLE", "The video could not be opened. It may be corrupt or use an "
                            "unsupported codec. Try re-exporting it as MP4 (H.264).")
    warnings: List[str] = []
    landmarker = None
    try:
        fps_meta = float(cap.get(cv2.CAP_PROP_FPS) or 0.0)
        total_meta = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        src_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
        src_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
        fps_ok = 1.0 <= fps_meta <= 240.0
        fps = fps_meta if fps_ok else 30.0
        if not fps_ok:
            warnings.append("The video's frame-rate information was missing; timing was estimated from timestamps.")
        stride = max(1, int(round(fps / TARGET_FPS)))

        landmarker, mp = create_landmarker(num_poses=2)

        times: List[float] = []
        pts_list: List[np.ndarray] = []
        vis_list: List[np.ndarray] = []
        has_pose: List[bool] = []
        second: List[bool] = []
        brightness: List[float] = []
        proc_w = proc_h = 0
        frame_index = -1
        last_ts = -1
        prev_centroid = None
        lost = 0
        truncated = False
        read_failures = 0

        while True:
            if not cap.grab():
                break
            frame_index += 1
            if frame_index % stride != 0:
                continue
            ok, frame = cap.retrieve()
            if not ok or frame is None:
                read_failures += 1
                continue

            t = (frame_index / fps) if fps_ok else float(cap.get(cv2.CAP_PROP_POS_MSEC) or 0.0) / 1000.0
            if times and t <= times[-1]:
                t = times[-1] + 1.0 / TARGET_FPS
            if times and (t - times[0]) > MAX_ANALYSIS_SECONDS or len(times) >= MAX_FRAMES:
                truncated = True
                break

            if proc_w == 0:
                h0, w0 = frame.shape[:2]
                scale = min(1.0, MAX_SIDE / float(max(h0, w0)))
                proc_w, proc_h = max(2, int(round(w0 * scale))), max(2, int(round(h0 * scale)))
                if src_w == 0 or src_h == 0:
                    src_w, src_h = w0, h0
            small = cv2.resize(frame, (proc_w, proc_h), interpolation=cv2.INTER_AREA)
            brightness.append(float(cv2.cvtColor(small, cv2.COLOR_BGR2GRAY).mean()))
            rgb = np.ascontiguousarray(cv2.cvtColor(small, cv2.COLOR_BGR2RGB))

            ts_ms = int(round(t * 1000.0))
            if ts_ms <= last_ts:
                ts_ms = last_ts + 1
            last_ts = ts_ms
            result = landmarker.detect_for_video(
                mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb), ts_ms)

            cands = _pose_candidates(result, proc_w, proc_h)
            times.append(t)
            if not cands:
                pts_list.append(np.full((33, 2), np.nan))
                vis_list.append(np.zeros(33))
                has_pose.append(False)
                second.append(False)
                lost += 1
                if lost > LOST_FRAMES_RESET:
                    prev_centroid = None
                continue

            if prev_centroid is None:
                primary = max(cands, key=lambda c: c[2])
            else:
                primary = min(cands, key=lambda c: float(np.linalg.norm(c[3] - prev_centroid)))
            prev_centroid = primary[3]
            lost = 0
            has_second = any(
                (c is not primary) and c[2] >= 0.5 * primary[2]
                and float(np.linalg.norm(c[3] - primary[3])) >= 0.25 * primary[2]
                for c in cands)
            pts_list.append(primary[0])
            vis_list.append(primary[1])
            has_pose.append(True)
            second.append(bool(has_second))
    finally:
        if landmarker is not None:
            try:
                landmarker.close()
            except Exception:  # noqa: BLE001
                pass
        cap.release()

    if len(times) == 0:
        raise AnalysisError("VIDEO_UNREADABLE", "No frames could be read from the video. The file may be "
                            "corrupt or use an unsupported codec. Try re-exporting it as MP4 (H.264).")
    if read_failures > 0.2 * (len(times) + read_failures):
        warnings.append("Many frames could not be decoded; the video may be partially corrupt.")
    if truncated:
        warnings.append(f"Only the first {int(MAX_ANALYSIS_SECONDS)} seconds of the video were analysed.")

    t_arr = np.asarray(times, dtype=float)
    eff_fps = float(1.0 / np.median(np.diff(t_arr))) if len(t_arr) >= 2 else fps / stride
    if not np.isfinite(eff_fps) or eff_fps <= 0:
        eff_fps = fps / stride
    seq = PoseSequence(
        times=t_arr, pts=np.asarray(pts_list, dtype=float), vis=np.asarray(vis_list, dtype=float),
        has_pose=np.asarray(has_pose, dtype=bool), second_person=np.asarray(second, dtype=bool),
        width=proc_w, height=proc_h, fps=eff_fps,
        brightness=float(np.mean(brightness)) if brightness else 0.0)

    source_duration = (total_meta / fps) if (fps_ok and total_meta > 0) else float(t_arr[-1])
    info = {
        "durationSeconds": round(float(source_duration), 2),
        "analyzedSeconds": round(seq.duration, 2),
        "fps": round(fps, 2),
        "width": src_w,
        "height": src_h,
        "framesAnalyzed": seq.n,
        "framesWithPose": int(seq.has_pose.sum()),
        "poseDetectionRate": round(float(seq.has_pose.mean()), 3),
        "averageBrightness": round(seq.brightness, 1),
    }
    return seq, info, warnings


def analyze_video(video_path: str, activity: str, view: str) -> Dict:
    if activity not in ACTIVITY_LABELS:
        raise AnalysisError("UNSUPPORTED_ACTIVITY",
                            f"Unsupported activity '{activity}'. Choose one of: {', '.join(ACTIVITY_LABELS)}.")
    if not os.path.isfile(video_path):
        raise AnalysisError("VIDEO_UNREADABLE", "The video file could not be found on the server.")

    started = time.time()
    seq, info, warnings = extract_pose_sequence(video_path)
    log(f"[ai] extracted {seq.n} frames in {time.time() - started:.1f}s")

    if seq.n < 10 or seq.duration < MIN_VIDEO_SECONDS:
        raise AnalysisError("VIDEO_TOO_SHORT", "The video is too short to analyse. Record at least a few "
                            "seconds that clearly show the full movement.")

    det_rate = float(seq.has_pose.mean())
    if det_rate < 0.15:
        raise AnalysisError("NO_PERSON", "No person could be detected in the video. Make sure your whole body "
                            "is visible, the lighting is good and the camera is not blocked.")

    penalty = 0.0
    with_pose = seq.has_pose.sum()
    second_rate = float(seq.second_person[seq.has_pose].mean()) if with_pose else 0.0
    if second_rate >= 0.35:
        raise AnalysisError("MULTIPLE_PEOPLE", "More than one person was detected in the video. Record only "
                            "the athlete being assessed, with nobody else in the frame.")
    if second_rate >= 0.05:
        penalty += 0.10
        warnings.append("Another person appeared in part of the video. Results are for the most prominent person.")
    if det_rate < 0.60:
        penalty += 0.05
        warnings.append(f"A person was detected in only {det_rate * 100:.0f}% of frames, so results may be unreliable.")
    if seq.brightness < 55:
        penalty += 0.10
        warnings.append(f"The video is dark (average brightness {seq.brightness:.0f}/255). "
                        "Low light reduces pose accuracy.")

    result = analyze_activity(activity, seq, view, info, warnings, penalty)
    result["video"]["processingSeconds"] = round(time.time() - started, 1)
    return result