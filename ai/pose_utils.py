"""Reusable pose-estimation helpers.

Contains: landmark constants, the PoseSequence container, angle maths, visibility
checks, gap filling and smoothing, camera-view estimation, repetition segmentation
(movement phases), step/extremum detection and cadence (dominant frequency) estimation.
Only NumPy is required here.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import List, Optional, Tuple

import numpy as np

# ---- MediaPipe pose landmark indices ----
NOSE = 0
L_SHOULDER, R_SHOULDER = 11, 12
L_ELBOW, R_ELBOW = 13, 14
L_WRIST, R_WRIST = 15, 16
L_HIP, R_HIP = 23, 24
L_KNEE, R_KNEE = 25, 26
L_ANKLE, R_ANKLE = 27, 28

MIN_VISIBILITY = 0.5


class AnalysisError(Exception):
    """A handled, user-facing analysis failure. `code` is mapped to an HTTP status by Node."""

    is_analysis_error = True

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass
class PoseSequence:
    times: np.ndarray          # (N,) seconds
    pts: np.ndarray            # (N, 33, 2) pixel coordinates, NaN when no pose in that frame
    vis: np.ndarray            # (N, 33) landmark visibility 0..1 (0 when no pose)
    has_pose: np.ndarray       # (N,) bool
    second_person: np.ndarray  # (N,) bool: a similar-sized second person is present
    width: int
    height: int
    fps: float                 # effective sampling rate of this sequence
    brightness: float          # mean grey level 0..255

    @property
    def n(self) -> int:
        return int(len(self.times))

    @property
    def duration(self) -> float:
        if self.n < 2:
            return 0.0
        return float(self.times[-1] - self.times[0] + 1.0 / max(self.fps, 1e-6))


# ---------------------------------------------------------------- statistics helpers
def finite(arr) -> np.ndarray:
    a = np.asarray([np.nan if v is None else v for v in list(arr)], dtype=float)
    return a[np.isfinite(a)]


def safe_median(arr) -> Optional[float]:
    a = finite(arr)
    return float(np.median(a)) if a.size else None


def safe_mean(arr) -> Optional[float]:
    a = finite(arr)
    return float(np.mean(a)) if a.size else None


def safe_std(arr) -> Optional[float]:
    a = finite(arr)
    return float(np.std(a)) if a.size else None


def safe_min(arr) -> Optional[float]:
    a = finite(arr)
    return float(np.min(a)) if a.size else None


def safe_percentile(arr, q: float) -> Optional[float]:
    a = finite(arr)
    return float(np.percentile(a, q)) if a.size else None


def valid_fraction(arr) -> float:
    a = np.asarray(arr, dtype=float)
    return float(np.mean(~np.isnan(a))) if a.size else 0.0


def linear_score(value, best: float, worst: float) -> Optional[float]:
    """100 at `best`, 0 at `worst`, linear in between (works in either direction)."""
    if value is None or not np.isfinite(value):
        return None
    if best == worst:
        return 100.0
    t = (float(value) - worst) / (best - worst)
    return float(np.clip(t, 0.0, 1.0) * 100.0)


# ---------------------------------------------------------------- landmark access
def visible_mask(seq: PoseSequence, indices, min_vis: float = MIN_VISIBILITY) -> np.ndarray:
    idx = list(indices)
    return seq.has_pose & np.all(seq.vis[:, idx] >= min_vis, axis=1)


def point_series(seq: PoseSequence, index: int, min_vis: float = MIN_VISIBILITY) -> np.ndarray:
    """(N, 2) pixel positions of one landmark, NaN where it is not reliably visible."""
    out = seq.pts[:, index, :].copy()
    out[~visible_mask(seq, [index], min_vis)] = np.nan
    return out


def midpoint_series(seq: PoseSequence, i: int, j: int, min_vis: float = MIN_VISIBILITY) -> np.ndarray:
    return (point_series(seq, i, min_vis) + point_series(seq, j, min_vis)) / 2.0


def mean_visibility(seq: PoseSequence, indices) -> float:
    if not seq.has_pose.any():
        return 0.0
    return float(np.mean(seq.vis[seq.has_pose][:, list(indices)]))


def nanmean_rows(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    stack = np.vstack([a, b])
    count = np.sum(~np.isnan(stack), axis=0)
    total = np.nansum(stack, axis=0)
    return np.where(count > 0, total / np.maximum(count, 1), np.nan)


def combine_lr(left: np.ndarray, right: np.ndarray, view: str, left_vis: float, right_vis: float) -> np.ndarray:
    """Side view: use the better-visible (camera-facing) side. Front/back: average both."""
    if view == "side":
        primary, secondary = (left, right) if left_vis >= right_vis else (right, left)
        if np.sum(~np.isnan(primary)) < 0.5 * np.sum(~np.isnan(secondary)):
            return secondary.copy()
        return primary.copy()
    return nanmean_rows(left, right)


# ---------------------------------------------------------------- angles
def calculate_angle(a, b, c) -> float:
    """Angle in degrees at point b formed by a-b-c (2D). NaN for degenerate input."""
    a, b, c = np.asarray(a, float), np.asarray(b, float), np.asarray(c, float)
    v1, v2 = a - b, c - b
    n1, n2 = np.linalg.norm(v1), np.linalg.norm(v2)
    if not np.isfinite(n1) or not np.isfinite(n2) or n1 < 1e-9 or n2 < 1e-9:
        return float("nan")
    cosang = float(np.clip(np.dot(v1, v2) / (n1 * n2), -1.0, 1.0))
    return float(np.degrees(np.arccos(cosang)))


def joint_angle_series(seq: PoseSequence, a: int, b: int, c: int, min_vis: float = MIN_VISIBILITY) -> np.ndarray:
    """Per-frame angle at landmark b (a-b-c). NaN where any of the three is not visible."""
    A, B, C = seq.pts[:, a], seq.pts[:, b], seq.pts[:, c]
    v1, v2 = A - B, C - B
    n1 = np.linalg.norm(v1, axis=1)
    n2 = np.linalg.norm(v2, axis=1)
    with np.errstate(invalid="ignore", divide="ignore"):
        cosang = np.sum(v1 * v2, axis=1) / (n1 * n2)
        ang = np.degrees(np.arccos(np.clip(cosang, -1.0, 1.0)))
    ok = visible_mask(seq, [a, b, c], min_vis) & (n1 > 1e-6) & (n2 > 1e-6)
    ang[~ok] = np.nan
    return ang


def tilt_from_vertical(lower: np.ndarray, upper: np.ndarray) -> np.ndarray:
    """Angle (deg) between the vector lower->upper and 'straight up' in the image.
    0 = vertical with `upper` above `lower`; 90 = horizontal."""
    v = upper - lower
    n = np.linalg.norm(v, axis=1)
    with np.errstate(invalid="ignore", divide="ignore"):
        cosang = -v[:, 1] / n
        ang = np.degrees(np.arccos(np.clip(cosang, -1.0, 1.0)))
    ang[~(n > 1e-6)] = np.nan
    return ang


def torso_length(seq: PoseSequence) -> Optional[float]:
    """Median shoulder-centre to hip-centre distance in pixels (used as a body-size scale)."""
    sm = midpoint_series(seq, L_SHOULDER, R_SHOULDER)
    hm = midpoint_series(seq, L_HIP, R_HIP)
    d = np.linalg.norm(sm - hm, axis=1)
    d = d[np.isfinite(d)]
    if d.size < 5:
        return None
    return float(np.median(d))


def estimate_view(seq: PoseSequence) -> Tuple[Optional[str], Optional[float]]:
    """Returns ('side' | 'frontal', ratio) from shoulder/hip width relative to torso length."""
    ok = visible_mask(seq, [L_SHOULDER, R_SHOULDER, L_HIP, R_HIP])
    if ok.sum() < 5:
        return None, None
    p = seq.pts[ok]
    sh = np.abs(p[:, L_SHOULDER, 0] - p[:, R_SHOULDER, 0])
    hp = np.abs(p[:, L_HIP, 0] - p[:, R_HIP, 0])
    sm = (p[:, L_SHOULDER] + p[:, R_SHOULDER]) / 2.0
    hm = (p[:, L_HIP] + p[:, R_HIP]) / 2.0
    tl = np.maximum(np.linalg.norm(sm - hm, axis=1), 1e-6)
    ratio = float(np.median(((sh + hp) / 2.0) / tl))
    return ("side" if ratio < 0.45 else "frontal"), ratio


def body_line_deviation(seq: PoseSequence, shoulder: int, hip: int, end: int,
                        torso: Optional[float], min_vis: float = MIN_VISIBILITY) -> np.ndarray:
    """Vertical distance of the hip from the straight shoulder->end line, divided by torso length.
    Positive = hip lower in the image than the line (sagging), negative = hip raised (piking).
    Only valid when the body is roughly horizontal in the image."""
    if not torso:
        return np.full(seq.n, np.nan)
    S = point_series(seq, shoulder, min_vis)
    H = point_series(seq, hip, min_vis)
    E = point_series(seq, end, min_vis)
    dx = E[:, 0] - S[:, 0]
    with np.errstate(invalid="ignore", divide="ignore"):
        slope = (E[:, 1] - S[:, 1]) / dx
        y_line = S[:, 1] + (H[:, 0] - S[:, 0]) * slope
        dev = (H[:, 1] - y_line) / torso
    dev[~(np.abs(dx) > 0.8 * torso)] = np.nan
    return dev


# ---------------------------------------------------------------- smoothing
def interpolate_gaps(series, max_gap: int) -> np.ndarray:
    """Linearly fill NaN gaps no longer than max_gap samples; longer gaps stay NaN."""
    s = np.asarray(series, dtype=float).copy()
    n = len(s)
    valid = ~np.isnan(s)
    if valid.sum() < 2:
        return s
    idx = np.arange(n)
    interp = np.interp(idx, idx[valid], s[valid])
    out = s.copy()
    i = 0
    while i < n:
        if np.isnan(s[i]):
            j = i
            while j < n and np.isnan(s[j]):
                j += 1
            if i > 0 and j < n and (j - i) <= max_gap:
                out[i:j] = interp[i:j]
            i = j
        else:
            i += 1
    return out


def median_filter(series, window: int = 5) -> np.ndarray:
    s = np.asarray(series, dtype=float)
    n = len(s)
    h = max(1, window // 2)
    out = np.full(n, np.nan)
    for i in range(n):
        if np.isnan(s[i]):
            continue
        out[i] = np.nanmedian(s[max(0, i - h): i + h + 1])
    return out


def smooth_series(series, window: int = 5) -> np.ndarray:
    """NaN-aware moving average. NaN samples stay NaN (gaps are never invented)."""
    s = np.asarray(series, dtype=float)
    if window <= 1 or len(s) < 3:
        return s.copy()
    if window % 2 == 0:
        window += 1
    kernel = np.ones(window)
    valid = ~np.isnan(s)
    num = np.convolve(np.where(valid, s, 0.0), kernel, mode="same")
    den = np.convolve(valid.astype(float), kernel, mode="same")
    out = np.full_like(s, np.nan)
    ok = valid & (den > 0)
    out[ok] = num[ok] / den[ok]
    return out


def clean_signal(series, fps: float, max_gap_s: float = 0.5, smooth_s: float = 0.15) -> np.ndarray:
    """Fill short gaps, remove spikes (median filter), then smooth."""
    max_gap = max(1, int(round(fps * max_gap_s)))
    s = interpolate_gaps(series, max_gap)
    s = median_filter(s, 3 if fps < 20 else 5)
    return smooth_series(s, max(3, int(round(fps * smooth_s))))


# ---------------------------------------------------------------- repetition (phase) detection
@dataclass
class Excursion:
    """One movement cycle: leave the 'top' zone, reach a minimum, return to the top zone."""
    start: int
    bottom: int
    end: int
    min_value: float
    start_time: float
    bottom_time: float
    end_time: float
    duration: float
    descent_s: float
    ascent_s: float
    finished: bool


def adaptive_high_threshold(values, high_thr: float, partial_thr: float, margin: float, min_gap: float) -> float:
    """Lowers the 'top' threshold when the person never fully extends, but never below partial+min_gap."""
    p = safe_percentile(values, 85)
    if p is None:
        return high_thr
    return float(max(partial_thr + min_gap, min(high_thr, p - margin)))


def find_excursions(values, times, high_thr: float, partial_thr: float, min_duration: float = 0.5) -> List[Excursion]:
    """Finds movement cycles in a 1-D signal that is HIGH at rest and dips during a repetition.

    A cycle starts when the signal falls below `high_thr` after having been at the top and ends
    when it climbs back to `high_thr`. Cycles that never dip to `partial_thr`, or that are shorter
    than `min_duration`, are noise. Cycles still open at the end of the video have finished=False.
    A person staying in one position never produces a cycle, so nothing is counted repeatedly."""
    vals = np.asarray(values, dtype=float)
    out: List[Excursion] = []
    seen_top = False
    last_top = -1
    in_exc = False
    cur_min = np.inf
    cur_min_i = -1
    last_valid = -1

    def close(end_idx: int, finished: bool) -> None:
        duration = float(times[end_idx] - times[last_top])
        if cur_min <= partial_thr and duration >= min_duration:
            out.append(Excursion(
                start=last_top, bottom=cur_min_i, end=end_idx, min_value=float(cur_min),
                start_time=float(times[last_top]), bottom_time=float(times[cur_min_i]),
                end_time=float(times[end_idx]), duration=duration,
                descent_s=float(times[cur_min_i] - times[last_top]),
                ascent_s=float(times[end_idx] - times[cur_min_i]), finished=finished))

    for i in range(len(vals)):
        v = vals[i]
        if np.isnan(v):
            continue
        last_valid = i
        if v >= high_thr:
            if in_exc:
                close(i, True)
                in_exc = False
            seen_top = True
            last_top = i
        elif seen_top:
            if not in_exc:
                in_exc = True
                cur_min = v
                cur_min_i = i
            elif v < cur_min:
                cur_min = v
                cur_min_i = i
    if in_exc and last_valid >= 0:
        close(last_valid, False)
    return out


# ---------------------------------------------------------------- step / cadence helpers
def find_extrema(signal, min_prominence: float) -> List[Tuple[int, int]]:
    """Zig-zag detector. Returns alternating (index, +1 for maximum / -1 for minimum).
    A reversal is accepted only when the signal moves back by at least min_prominence."""
    s = np.asarray(signal, dtype=float)
    idx = np.where(~np.isnan(s))[0]
    if len(idx) < 3:
        return []
    ext: List[Tuple[int, int]] = []
    hi_i = lo_i = int(idx[0])
    hi_v = lo_v = s[hi_i]
    direction = 0
    cand_i, cand_v = hi_i, hi_v
    for i in idx[1:]:
        v = s[i]
        if direction == 0:
            if v > hi_v:
                hi_i, hi_v = int(i), v
            if v < lo_v:
                lo_i, lo_v = int(i), v
            if v - lo_v >= min_prominence:
                ext.append((lo_i, -1))
                direction, cand_i, cand_v = 1, int(i), v
            elif hi_v - v >= min_prominence:
                ext.append((hi_i, 1))
                direction, cand_i, cand_v = -1, int(i), v
        elif direction == 1:
            if v > cand_v:
                cand_i, cand_v = int(i), v
            elif cand_v - v >= min_prominence:
                ext.append((cand_i, 1))
                direction, cand_i, cand_v = -1, int(i), v
        else:
            if v < cand_v:
                cand_i, cand_v = int(i), v
            elif v - cand_v >= min_prominence:
                ext.append((cand_i, -1))
                direction, cand_i, cand_v = 1, int(i), v
    return ext


def dominant_frequency(signal, fs: float, f_min: float, f_max: float) -> Tuple[Optional[float], float]:
    """Dominant frequency (Hz) inside [f_min, f_max] and a periodicity strength 0..1
    (share of the 0.25-6 Hz spectral energy located around the peak)."""
    s = np.asarray(signal, dtype=float)
    valid = ~np.isnan(s)
    if valid.sum() < max(16, int(fs * 2)):
        return None, 0.0
    where = np.where(valid)[0]
    seg = s[where[0]: where[-1] + 1]
    idx = np.arange(len(seg))
    ok = ~np.isnan(seg)
    seg = np.interp(idx, idx[ok], seg[ok])
    seg = seg - seg.mean()
    if float(np.max(np.abs(seg))) < 1e-9:
        return None, 0.0
    seg = seg * np.hanning(len(seg))
    n_fft = int(2 ** np.ceil(np.log2(len(seg) * 8)))
    spec = np.abs(np.fft.rfft(seg, n=n_fft)) ** 2
    freqs = np.fft.rfftfreq(n_fft, d=1.0 / fs)
    band = np.where((freqs >= f_min) & (freqs <= f_max))[0]
    total_mask = (freqs >= 0.25) & (freqs <= min(6.0, fs / 2.0))
    total = float(spec[total_mask].sum())
    if band.size == 0 or total <= 0:
        return None, 0.0
    peak = int(band[np.argmax(spec[band])])
    near = (freqs >= freqs[peak] - 0.2) & (freqs <= freqs[peak] + 0.2)
    return float(freqs[peak]), float(spec[near].sum() / total)