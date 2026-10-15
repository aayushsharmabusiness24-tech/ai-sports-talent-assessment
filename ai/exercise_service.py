"""Activity-specific analysis (push-ups, squats, pull-ups, running).

Every activity has its own signals, thresholds, mistakes and scoring. Scores are weighted
averages of transparent criteria; criteria that cannot be evaluated are excluded and the
weights are re-normalised. If data is insufficient, no score is produced.
"""

from __future__ import annotations

from typing import Dict, List, Optional

import numpy as np

from pose_utils import (
    L_ANKLE, L_ELBOW, L_HIP, L_KNEE, L_SHOULDER, L_WRIST, NOSE,
    R_ANKLE, R_ELBOW, R_HIP, R_KNEE, R_SHOULDER, R_WRIST,
    AnalysisError, PoseSequence, adaptive_high_threshold, body_line_deviation, clean_signal,
    combine_lr, dominant_frequency, estimate_view, find_excursions, find_extrema,
    joint_angle_series, linear_score, mean_visibility, midpoint_series, nanmean_rows,
    point_series, safe_mean, safe_median, safe_min, safe_percentile, safe_std,
    tilt_from_vertical, torso_length, valid_fraction,
)

ACTIVITY_LABELS = {
    "pushups": "Push-ups",
    "squats": "Squats",
    "pullups": "Pull-ups",
    "running": "Running",
}
DISCLAIMER = (
    "Experimental computer-vision estimate based on 2D pose detection. It is not a certified "
    "sports assessment, coaching qualification or medical advice."
)
MIN_COVERAGE = 0.35

SIDE_LANDMARKS = {
    "left": {"shoulder": L_SHOULDER, "elbow": L_ELBOW, "wrist": L_WRIST,
             "hip": L_HIP, "knee": L_KNEE, "ankle": L_ANKLE},
    "right": {"shoulder": R_SHOULDER, "elbow": R_ELBOW, "wrist": R_WRIST,
              "hip": R_HIP, "knee": R_KNEE, "ankle": R_ANKLE},
}


# ---------------------------------------------------------------- small helpers
def r1(x, nd: int = 1):
    return None if x is None or not np.isfinite(x) else round(float(x), nd)


def criterion(key: str, label: str, weight: float, score, explanation: str) -> Dict:
    return {"key": key, "label": label, "weight": weight,
            "score": None if score is None else round(float(score), 1),
            "explanation": explanation}


def combine(criteria: List[Dict]):
    """Weighted mean of the evaluated criteria. Weights are re-normalised and reported."""
    ev = [c for c in criteria if c["score"] is not None]
    total = sum(c["weight"] for c in ev)
    if not ev or total <= 0:
        for c in criteria:
            c["evaluated"] = False
            c["weight"] = 0.0
        return None, criteria
    final = sum(c["score"] * c["weight"] for c in ev) / total
    for c in criteria:
        c["evaluated"] = c["score"] is not None
        c["weight"] = round(c["weight"] / total, 2) if c["evaluated"] else 0.0
    return round(final, 1), criteria


def mistake(code: str, title: str, detail: str, severity: str, reps: Optional[List[int]] = None) -> Dict:
    return {"code": code, "title": title, "detail": detail, "severity": severity, "repetitions": reps or []}


def severity_for(fraction: float) -> str:
    return "high" if fraction >= 0.5 else "medium" if fraction >= 0.25 else "low"


def consistency(durations, depths, cv_range, std_range):
    """Score for how similar the repetitions are (duration variation and depth variation)."""
    if len(durations) < 3:
        return None, None, None
    d = np.asarray(durations, dtype=float)
    cv_d = float(d.std() / d.mean()) if d.mean() > 0 else None
    sd = float(np.std(depths))
    parts = [s for s in (linear_score(cv_d, *cv_range), linear_score(sd, *std_range)) if s is not None]
    return (float(np.mean(parts)) if parts else None), cv_d, sd


def detect_reps(signal, times, high, partial, min_duration, margin, min_gap):
    eff_high = adaptive_high_threshold(signal, high, partial, margin, min_gap)
    excs = find_excursions(signal, times, eff_high, partial, min_duration)
    return eff_high, [e for e in excs if e.finished], [e for e in excs if not e.finished]


def make_rep(n: int, e, signal, complete: bool) -> Dict:
    window = signal[e.start: e.end + 1]
    return {"n": n, "complete": bool(complete), "min": float(e.min_value),
            "max": float(np.nanmax(window)), "duration": float(e.duration),
            "descent": float(e.descent_s), "ascent": float(e.ascent_s),
            "start": e.start, "bottom": e.bottom, "end": e.end}


def rep_numbers(reps: List[Dict], predicate) -> List[int]:
    return [r["n"] for r in reps if predicate(r)]


# ---------------------------------------------------------------- analysis context
class Context:
    def __init__(self, seq: PoseSequence, requested_view: str, video_info: Dict, warnings: List[str], penalty: float):
        self.seq = seq
        self.video = video_info
        self.warnings = list(warnings)
        self.penalty = penalty
        self.requested_view = requested_view
        self.detected_view, self.view_ratio = estimate_view(seq)
        self.view = self._resolve_view()
        self.view_label = "side" if self.view == "side" else "front/back"
        self.torso = torso_length(seq)

    def warn(self, msg: str) -> None:
        if msg not in self.warnings:
            self.warnings.append(msg)

    def _resolve_view(self) -> str:
        req, det, ratio = self.requested_view, self.detected_view, self.view_ratio
        if req not in ("side", "front", "back"):
            if det is None:
                self.warn("The camera view could not be determined automatically; a side view was assumed.")
                return "side"
            if ratio is not None and 0.35 <= ratio <= 0.60:
                self.warn("The camera angle looks diagonal (between side and front). "
                          "Angle-based measurements are less reliable.")
            return det
        chosen = "side" if req == "side" else "frontal"
        if det is not None and ratio is not None:
            if chosen == "side" and ratio > 0.60:
                self.penalty += 0.05
                self.warn("You selected a side view, but the footage looks like a front/back view. "
                          "The analysis used the front/back view.")
                return "frontal"
            if chosen == "frontal" and ratio < 0.35:
                self.penalty += 0.05
                self.warn("You selected a front/back view, but the footage looks like a side view. "
                          "The analysis used the side view.")
                return "side"
        return chosen

    def best_side(self, names: List[str]) -> Dict[str, int]:
        scores = {side: mean_visibility(self.seq, [m[n] for n in names])
                  for side, m in SIDE_LANDMARKS.items()}
        return SIDE_LANDMARKS["left" if scores["left"] >= scores["right"] else "right"]

    def joint_signal(self, left, right) -> np.ndarray:
        l = joint_angle_series(self.seq, *left)
        r = joint_angle_series(self.seq, *right)
        raw = combine_lr(l, r, self.view, mean_visibility(self.seq, left), mean_visibility(self.seq, right))
        return clean_signal(raw, self.seq.fps)

    def torso_tilt_series(self) -> np.ndarray:
        if self.view == "side":
            s = self.best_side(["shoulder", "hip"])
            lower = point_series(self.seq, s["hip"])
            upper = point_series(self.seq, s["shoulder"])
        else:
            lower = midpoint_series(self.seq, L_HIP, R_HIP)
            upper = midpoint_series(self.seq, L_SHOULDER, R_SHOULDER)
        return tilt_from_vertical(lower, upper)

    def confidence(self, key_indices, coverage: float) -> float:
        det = float(np.mean(self.seq.has_pose))
        vis = mean_visibility(self.seq, key_indices)
        val = 0.40 * det + 0.35 * vis + 0.25 * min(1.0, coverage) - self.penalty
        return round(float(np.clip(val, 0.0, 1.0)), 2)


def build_result(ctx: Context, activity: str, status: str, *, reps, incomplete, score, criteria,
                 feedback, mistakes, suggestions, summary, confidence, measured, estimated) -> Dict:
    return {
        "ok": True,
        "status": status,
        "activity": activity,
        "activityLabel": ACTIVITY_LABELS[activity],
        "cameraView": ctx.view_label,
        "repetitions": reps,
        "incompleteRepetitions": incomplete,
        "formScore": score,
        "scoreBreakdown": criteria,
        "feedback": feedback,
        "mistakes": mistakes,
        "suggestions": suggestions,
        "summary": summary,
        "confidence": {"overall": confidence, "warnings": list(ctx.warnings)},
        "metrics": {"measured": measured or {}, "estimated": estimated or {}},
        "video": ctx.video,
        "disclaimer": DISCLAIMER,
    }


def insufficient(ctx: Context, activity: str, reason: str, suggestions: List[str], confidence: float,
                 measured=None, reps=None, incomplete=None, estimated=None) -> Dict:
    return build_result(
        ctx, activity, "insufficient_data", reps=reps, incomplete=incomplete, score=None, criteria=[],
        feedback=[reason], mistakes=[], suggestions=suggestions,
        summary="Not enough reliable data to produce a score: " + reason,
        confidence=confidence, measured=measured, estimated=estimated)


# ---------------------------------------------------------------- shared signal builders
def hip_height_signal(ctx: Context):
    """Relative hip height: 1.0 when standing, lower when the hips drop (units of leg length)."""
    seq = ctx.seq
    hip_mid = midpoint_series(seq, L_HIP, R_HIP)
    hip_y = clean_signal(hip_mid[:, 1], seq.fps)
    if valid_fraction(hip_y) < MIN_COVERAGE:
        return None
    ank_mid = midpoint_series(seq, L_ANKLE, R_ANKLE)
    leg = np.linalg.norm(hip_mid - ank_mid, axis=1)
    leg_len = safe_percentile(leg, 90) if np.isfinite(leg).sum() >= 10 else None
    if leg_len is None or leg_len < 1e-6:
        if not ctx.torso:
            return None
        leg_len = 1.8 * ctx.torso
        ctx.warn("The ankles were not clearly visible, so leg length was approximated from torso length.")
    y_stand = safe_percentile(hip_y, 5)
    return 1.0 - (hip_y - y_stand) / leg_len


def knee_separation_ratio(ctx: Context) -> np.ndarray:
    seq = ctx.seq
    lk, rk = point_series(seq, L_KNEE)[:, 0], point_series(seq, R_KNEE)[:, 0]
    la, ra = point_series(seq, L_ANKLE)[:, 0], point_series(seq, R_ANKLE)[:, 0]
    ks, as_ = np.abs(lk - rk), np.abs(la - ra)
    with np.errstate(invalid="ignore", divide="ignore"):
        ratio = ks / as_
    if ctx.torso:
        ratio[~(as_ > 0.15 * ctx.torso)] = np.nan
    return clean_signal(ratio, seq.fps)


# ================================================================ PUSH-UPS
PU_HIGH, PU_PARTIAL, PU_LOW = 150.0, 130.0, 100.0


def analyze_pushups(ctx: Context) -> Dict:
    seq, act = ctx.seq, "pushups"
    key = [L_SHOULDER, R_SHOULDER, L_ELBOW, R_ELBOW, L_WRIST, R_WRIST, L_HIP, R_HIP]
    elbow = ctx.joint_signal((L_SHOULDER, L_ELBOW, L_WRIST), (R_SHOULDER, R_ELBOW, R_WRIST))
    cov = valid_fraction(elbow)
    conf = ctx.confidence(key, cov)
    tilt = safe_median(ctx.torso_tilt_series())
    measured = {"torsoTiltFromVerticalDeg": r1(tilt)}
    tips = ["Film from the side, about 2-3 metres away, with your whole body in frame.",
            "Use good lighting and a plain background."]

    if cov < MIN_COVERAGE:
        return insufficient(ctx, act, "Your shoulders, elbows and wrists were visible in too few frames.",
                            tips, conf, measured)
    if tilt is not None and tilt < 40:
        return insufficient(ctx, act, "The body looks upright rather than horizontal, so this does not look "
                            "like a push-up. Check that you selected the correct activity.",
                            ["Select the activity that matches the video.", tips[0]], conf, measured)
    if tilt is not None and tilt < 55:
        ctx.warn("The body is not close to horizontal; push-up measurements may be less reliable.")
    if ctx.view != "side":
        ctx.warn("Front/back view: hip sag or pike cannot be judged reliably, so body alignment is not "
                 "scored. A side view is recommended for push-ups.")

    eff_high, finished, unfinished = detect_reps(elbow, seq.times, PU_HIGH, PU_PARTIAL, 0.5, 6.0, 8.0)
    if eff_high < PU_HIGH - 1:
        ctx.warn(f"Arms were rarely fully straightened between repetitions, so the 'top' position "
                 f"was set to {eff_high:.0f} degrees.")
    if unfinished:
        ctx.warn("The video ended in the middle of a repetition; that unfinished repetition was not counted.")
    if not finished:
        return insufficient(ctx, act, "No complete push-up movement cycle (down and back up) was detected.",
                            tips + ["Record at least 2-3 full repetitions."], conf, measured, reps=0, incomplete=0)

    dev = None
    if ctx.view == "side" and ctx.torso:
        side = ctx.best_side(["shoulder", "hip", "ankle"])
        raw = body_line_deviation(seq, side["shoulder"], side["hip"], side["ankle"], ctx.torso)
        if valid_fraction(raw) < 0.3:
            raw = body_line_deviation(seq, side["shoulder"], side["hip"], side["knee"], ctx.torso)
            if valid_fraction(raw) >= 0.3:
                ctx.warn("The ankles were not visible, so the knees were used as the body-line reference; "
                         "the alignment estimate is less reliable.")
        if valid_fraction(raw) >= 0.3:
            dev = clean_signal(raw, seq.fps)

    reps: List[Dict] = []
    for k, e in enumerate(finished, 1):
        r = make_rep(k, e, elbow, e.min_value <= PU_LOW)
        r["dev"] = safe_median(dev[e.start: e.end + 1]) if dev is not None else None
        reps.append(r)
    n_all = len(reps)
    n_complete = sum(1 for r in reps if r["complete"])
    n_incomplete = n_all - n_complete

    depth = safe_mean([linear_score(r["min"], 90, 150) for r in reps])
    completion = 100.0 * n_complete / n_all
    lockout = safe_mean([linear_score(r["max"], 165, 140) for r in reps])
    devs = [r["dev"] for r in reps if r["dev"] is not None]
    align = None
    if dev is not None and len(devs) >= max(1, int(np.ceil(0.5 * n_all))):
        align = safe_mean([linear_score(abs(d), 0.06, 0.30) for d in devs])
    cons, cv_dur, std_depth = consistency([r["duration"] for r in reps], [r["min"] for r in reps],
                                           (0.10, 0.45), (5.0, 25.0))
    mean_min = safe_mean([r["min"] for r in reps])
    mean_max = safe_mean([r["max"] for r in reps])
    med_dev = safe_median(devs)

    criteria = [
        criterion("depth", "Depth", 0.30, depth,
                  f"Per repetition: 100 when the elbows bend to 90 degrees or less, 0 at 150 degrees or more. "
                  f"Average lowest elbow angle: {mean_min:.0f} degrees."),
        criterion("completion", "Completed repetitions", 0.20, completion,
                  f"{n_complete} of {n_all} attempts lowered the elbows to {PU_LOW:.0f} degrees or less and "
                  f"returned to the top position."),
        criterion("alignment", "Body alignment", 0.30, align,
                  (f"Hip distance from the shoulder-to-ankle line relative to torso length: 100 at 6% or less, "
                   f"0 at 30% or more. Median deviation: {abs(med_dev) * 100:.0f}% "
                   f"({'sagging' if med_dev > 0 else 'piked'})." if align is not None else
                   "Not evaluated: this needs a clear side view with shoulders, hips and ankles visible.")),
        criterion("lockout", "Arm extension at the top", 0.10, lockout,
                  f"100 when the elbows straighten to 165 degrees or more at the top, 0 at 140 degrees or less. "
                  f"Average top angle: {mean_max:.0f} degrees."),
        criterion("consistency", "Consistency", 0.10, cons,
                  (f"Combines variation in repetition duration (CV {cv_dur * 100:.0f}%) and depth "
                   f"(std {std_depth:.0f} degrees)." if cons is not None else
                   "Not evaluated: at least 3 repetitions are needed.")),
    ]
    score, criteria = combine(criteria)

    mistakes: List[Dict] = []
    bad = rep_numbers(reps, lambda r: not r["complete"])
    if bad:
        mistakes.append(mistake("incomplete_depth", "Incomplete repetitions",
                                f"{len(bad)} attempt(s) did not lower the elbows to about {PU_LOW:.0f} degrees.",
                                severity_for(len(bad) / n_all), bad))
    sag = rep_numbers(reps, lambda r: r["dev"] is not None and r["dev"] > 0.10)
    pike = rep_numbers(reps, lambda r: r["dev"] is not None and r["dev"] < -0.10)
    if sag:
        mistakes.append(mistake("hip_sag", "Hips sagging", "The hips dropped below the shoulder-ankle line.",
                                severity_for(len(sag) / n_all), sag))
    if pike:
        mistakes.append(mistake("hip_pike", "Hips raised", "The hips rose above the shoulder-ankle line.",
                                severity_for(len(pike) / n_all), pike))
    short = rep_numbers(reps, lambda r: r["max"] < 155)
    if short:
        mistakes.append(mistake("partial_lockout", "Arms not fully straightened at the top",
                                "The elbows did not reach about 155 degrees at the top of these attempts.",
                                severity_for(len(short) / n_all), short))
    if cv_dur is not None and cv_dur > 0.35:
        mistakes.append(mistake("uneven_tempo", "Uneven tempo", "Repetition speed varied noticeably.", "low"))

    feedback: List[str] = []
    if n_complete:
        feedback.append(f"{n_complete} push-up(s) reached the target depth and returned to the top.")
    if n_incomplete:
        feedback.append(f"{n_incomplete} attempt(s) were too shallow to count as complete.")
    if align is not None:
        feedback.append("Your body line stayed fairly straight." if align >= 75 else
                        "Your hips moved away from a straight shoulder-hip-ankle line.")
    feedback.append("Descent averaged %.1f s and ascent %.1f s." % (
        safe_mean([r["descent"] for r in reps]), safe_mean([r["ascent"] for r in reps])))

    suggestions: List[str] = []
    if bad:
        suggestions.append("Lower until your elbows reach about 90 degrees (chest near the floor), then press up fully.")
    if sag:
        suggestions.append("Squeeze your glutes and brace your core to stop your hips sagging.")
    if pike:
        suggestions.append("Lower your hips slightly so shoulders, hips and ankles form one line.")
    if short:
        suggestions.append("Finish each repetition with fully straight arms.")
    if not suggestions:
        suggestions.append("Good control. Keep the same range of motion as you add repetitions.")

    active = max(reps[-1]["end"] and seq.times[reps[-1]["end"]] - seq.times[reps[0]["start"]], 1e-6)
    summary = (f"{n_complete} completed push-up(s) and {n_incomplete} incomplete attempt(s) detected. "
               f"Form score {score:.0f}/100 (experimental estimate).")
    return build_result(
        ctx, act, "completed", reps=n_complete, incomplete=n_incomplete, score=score, criteria=criteria,
        feedback=feedback, mistakes=mistakes, suggestions=suggestions, summary=summary, confidence=conf,
        measured={"analyzedSeconds": r1(seq.duration), "averageLowestElbowAngleDeg": r1(mean_min),
                  "averageTopElbowAngleDeg": r1(mean_max),
                  "averageRepDurationSeconds": r1(safe_mean([r["duration"] for r in reps]), 2),
                  "medianHipDeviationPercent": r1(None if med_dev is None else med_dev * 100),
                  "torsoTiltFromVerticalDeg": r1(tilt)},
        estimated={"repetitionsPerMinute": r1(n_complete / active * 60.0)})


# ================================================================ SQUATS
SQ_HIGH, SQ_PARTIAL, SQ_LOW = 160.0, 140.0, 105.0       # knee angle (degrees), side view
SQF_HIGH, SQF_PARTIAL, SQF_LOW = 0.96, 0.90, 0.78       # relative hip height, front/back view


def analyze_squats(ctx: Context) -> Dict:
    seq, act = ctx.seq, "squats"
    key = [L_HIP, R_HIP, L_KNEE, R_KNEE, L_ANKLE, R_ANKLE, L_SHOULDER, R_SHOULDER]
    side = ctx.view == "side"
    hip_s = hip_height_signal(ctx)
    tips = ["Film from the side (best) or the front, 2-3 metres away, with head to feet in frame.",
            "Keep the camera still."]

    if side:
        signal = ctx.joint_signal((L_HIP, L_KNEE, L_ANKLE), (R_HIP, R_KNEE, R_ANKLE))
        high, partial, low, margin, gap = SQ_HIGH, SQ_PARTIAL, SQ_LOW, 6.0, 8.0
    else:
        signal = hip_s if hip_s is not None else np.full(seq.n, np.nan)
        high, partial, low, margin, gap = SQF_HIGH, SQF_PARTIAL, SQF_LOW, 0.03, 0.03
        ctx.warn("Front/back view: squat depth is estimated from how far the hips drop because knee angles "
                 "are unreliable from the front. A side view gives a more detailed analysis.")
    cov = valid_fraction(signal)
    conf = ctx.confidence(key, cov)
    tilt = safe_median(ctx.torso_tilt_series())
    measured = {"torsoTiltFromVerticalDeg": r1(tilt)}

    if cov < MIN_COVERAGE:
        return insufficient(ctx, act, "Your hips, knees and ankles were visible in too few frames.",
                            tips, conf, measured)
    if tilt is not None and tilt > 70:
        return insufficient(ctx, act, "The torso looks horizontal, so this does not look like a squat. "
                            "Check that you selected the correct activity.",
                            ["Select the activity that matches the video.", tips[0]], conf, measured)

    eff_high, finished, unfinished = detect_reps(signal, seq.times, high, partial, 0.7, margin, gap)
    if unfinished:
        ctx.warn("The video ended in the middle of a repetition; that unfinished repetition was not counted.")
    if not finished:
        return insufficient(ctx, act, "No complete squat movement cycle (down and back up) was detected.",
                            tips + ["Record at least 2-3 full repetitions."], conf, measured, reps=0, incomplete=0)

    lean = hip_ang = ratio = None
    stand_ratio = None
    if side:
        lean = clean_signal(ctx.torso_tilt_series(), seq.fps)
        hip_ang = ctx.joint_signal((L_SHOULDER, L_HIP, L_KNEE), (R_SHOULDER, R_HIP, R_KNEE))
    else:
        ratio = knee_separation_ratio(ctx)
        stand_ratio = safe_median(ratio[signal >= eff_high]) if valid_fraction(ratio) > 0.2 else None

    reps: List[Dict] = []
    for k, e in enumerate(finished, 1):
        r = make_rep(k, e, signal, e.min_value <= low)
        b = e.bottom
        near = slice(max(0, b - 2), b + 3)
        r["drop"] = float(1.0 - np.nanmin(hip_s[e.start: e.end + 1])) if hip_s is not None else None
        if side:
            r["lean"] = safe_median(lean[near])
            r["hip_angle"] = safe_min(hip_ang[e.start: e.end + 1])
        else:
            rb = safe_median(ratio[near])
            r["valgus"] = (rb / stand_ratio) if (rb is not None and stand_ratio) else None
            r["drop"] = float(1.0 - e.min_value)
        reps.append(r)
    n_all = len(reps)
    n_complete = sum(1 for r in reps if r["complete"])
    n_incomplete = n_all - n_complete

    if side:
        depth = safe_mean([linear_score(r["min"], 85, 135) for r in reps])
        depth_txt = (f"Per repetition: 100 at a knee angle of 85 degrees or less, 0 at 135 degrees or more. "
                     f"Average lowest knee angle: {safe_mean([r['min'] for r in reps]):.0f} degrees.")
        depth_list = [r["min"] for r in reps]
        std_rng = (5.0, 25.0)
        lockout = safe_mean([linear_score(r["max"], 170, 150) for r in reps])
        leans = [r["lean"] for r in reps if r["lean"] is not None]
        lean_score = safe_mean([linear_score(v, 45, 75) for v in leans]) if leans else None
    else:
        depth = safe_mean([linear_score(r["drop"], 0.33, 0.08) for r in reps])
        depth_txt = (f"Estimated from hip drop relative to leg length: 100 at a 33% drop or more, 0 at 8% or less. "
                     f"Average drop: {safe_mean([r['drop'] for r in reps]) * 100:.0f}%.")
        depth_list = [r["drop"] for r in reps]
        std_rng = (0.02, 0.10)
        lockout = lean_score = None
    valg = [r["valgus"] for r in reps if r.get("valgus") is not None]
    knee_align = safe_mean([linear_score(v, 0.95, 0.65) for v in valg]) if (not side and valg) else None
    completion = 100.0 * n_complete / n_all
    cons, cv_dur, std_depth = consistency([r["duration"] for r in reps], depth_list, (0.10, 0.45), std_rng)

    criteria = [
        criterion("depth", "Squat depth", 0.30, depth, depth_txt),
        criterion("completion", "Completed repetitions", 0.20, completion,
                  f"{n_complete} of {n_all} attempts reached the target depth and returned to standing."),
        criterion("torso", "Torso position", 0.15, lean_score,
                  (f"Forward torso lean at the bottom: 100 at 45 degrees or less, 0 at 75 degrees or more. "
                   f"Average: {safe_mean(leans):.0f} degrees." if lean_score is not None else
                   "Not evaluated: needs a side view.")),
        criterion("lockout", "Standing position", 0.10, lockout,
                  ("100 when the knees straighten to 170 degrees or more at the top, 0 at 150 or less."
                   if lockout is not None else "Not evaluated: needs a side view.")),
        criterion("knee_alignment", "Knee alignment", 0.15, knee_align,
                  ("Knee spacing at the bottom compared with standing: 100 at 95% or more, 0 at 65% or less "
                   "(smaller values suggest knees caving inward)." if knee_align is not None else
                   "Not evaluated: needs a front/back view with knees and ankles visible.")),
        criterion("consistency", "Consistency", 0.10, cons,
                  (f"Combines variation in repetition duration (CV {cv_dur * 100:.0f}%) and depth."
                   if cons is not None else "Not evaluated: at least 3 repetitions are needed.")),
    ]
    score, criteria = combine(criteria)

    mistakes: List[Dict] = []
    shallow = rep_numbers(reps, lambda r: not r["complete"])
    if shallow:
        mistakes.append(mistake("shallow_squat", "Shallow squats",
                                f"{len(shallow)} attempt(s) did not reach the target depth.",
                                severity_for(len(shallow) / n_all), shallow))
    if side:
        lean_bad = rep_numbers(reps, lambda r: r.get("lean") is not None and r["lean"] > 65)
        if lean_bad:
            mistakes.append(mistake("forward_lean", "Excessive forward lean",
                                    "The torso leaned far forward at the bottom of these squats.",
                                    severity_for(len(lean_bad) / n_all), lean_bad))
        weak = rep_numbers(reps, lambda r: r["max"] < 160)
        if weak:
            mistakes.append(mistake("no_lockout", "Not fully standing between repetitions",
                                    "The knees did not fully straighten at the top.",
                                    severity_for(len(weak) / n_all), weak))
    else:
        cave = rep_numbers(reps, lambda r: r.get("valgus") is not None and r["valgus"] < 0.80)
        if cave:
            mistakes.append(mistake("knees_caving", "Knees moving inward",
                                    "The knees moved closer together than the feet at the bottom.",
                                    severity_for(len(cave) / n_all), cave))
    fast = safe_mean([r["descent"] for r in reps])
    if fast is not None and fast < 0.5:
        mistakes.append(mistake("fast_descent", "Dropping quickly",
                                "The descent was very fast; a controlled lowering is safer.", "low"))

    feedback = [f"{n_complete} squat(s) reached the target depth and returned to standing."]
    if n_incomplete:
        feedback.append(f"{n_incomplete} attempt(s) were too shallow to count as complete.")
    feedback.append("Descent averaged %.1f s and ascent %.1f s." % (
        safe_mean([r["descent"] for r in reps]), safe_mean([r["ascent"] for r in reps])))
    if not side:
        feedback.append("Knee and hip angles were not assessed from the front/back view.")

    suggestions: List[str] = []
    if shallow:
        suggestions.append("Sit back and down until your thighs are about parallel to the floor.")
    if side and any(m["code"] == "forward_lean" for m in mistakes):
        suggestions.append("Keep your chest up and push your hips back to reduce forward lean.")
    if any(m["code"] == "knees_caving" for m in mistakes):
        suggestions.append("Push your knees out in line with your toes as you descend and stand up.")
    if any(m["code"] == "no_lockout" for m in mistakes):
        suggestions.append("Stand fully tall at the top of each repetition.")
    if not suggestions:
        suggestions.append("Good depth and control. Keep your movement consistent as fatigue builds.")

    summary = (f"{n_complete} completed squat(s) and {n_incomplete} incomplete attempt(s) detected. "
               f"Form score {score:.0f}/100 (experimental estimate).")
    return build_result(
        ctx, act, "completed", reps=n_complete, incomplete=n_incomplete, score=score, criteria=criteria,
        feedback=feedback, mistakes=mistakes, suggestions=suggestions, summary=summary, confidence=conf,
        measured={"analyzedSeconds": r1(seq.duration),
                  "averageLowestKneeAngleDeg": r1(safe_mean([r["min"] for r in reps])) if side else None,
                  "averageMinHipAngleDeg": r1(safe_mean([r.get("hip_angle") for r in reps])) if side else None,
                  "averageHipDropPercentOfLegLength": r1(
                      None if safe_mean([r["drop"] for r in reps]) is None
                      else safe_mean([r["drop"] for r in reps]) * 100),
                  "averageRepDurationSeconds": r1(safe_mean([r["duration"] for r in reps]), 2),
                  "averageDescentSeconds": r1(safe_mean([r["descent"] for r in reps]), 2),
                  "averageAscentSeconds": r1(safe_mean([r["ascent"] for r in reps]), 2)},
        estimated={})


# ================================================================ PULL-UPS
PL_HIGH, PL_PARTIAL, PL_LOW = 150.0, 120.0, 90.0
PL_MIN_RISE = 0.25   # shoulder rise in torso lengths required for a complete pull-up


def analyze_pullups(ctx: Context) -> Dict:
    seq, act = ctx.seq, "pullups"
    key = [L_SHOULDER, R_SHOULDER, L_ELBOW, R_ELBOW, L_WRIST, R_WRIST, L_HIP, R_HIP]
    elbow = ctx.joint_signal((L_SHOULDER, L_ELBOW, L_WRIST), (R_SHOULDER, R_ELBOW, R_WRIST))
    cov = valid_fraction(elbow)
    conf = ctx.confidence(key, cov)
    tilt = safe_median(ctx.torso_tilt_series())
    measured = {"torsoTiltFromVerticalDeg": r1(tilt)}
    tips = ["Film from the front, back or side with your arms, shoulders and hips in frame.",
            "Make sure your hands and elbows are visible while hanging and at the top."]

    sh_y = nanmean_rows(point_series(seq, L_SHOULDER)[:, 1], point_series(seq, R_SHOULDER)[:, 1])
    wr_y = nanmean_rows(point_series(seq, L_WRIST)[:, 1], point_series(seq, R_WRIST)[:, 1])
    both = ~np.isnan(sh_y) & ~np.isnan(wr_y)
    hands_up = None
    if ctx.torso and both.mean() >= 0.3:
        hands_up = float(np.mean((sh_y[both] - wr_y[both]) > 0.2 * ctx.torso))
    measured["framesWithHandsAboveShouldersPercent"] = r1(None if hands_up is None else hands_up * 100)

    if cov < MIN_COVERAGE:
        return insufficient(ctx, act, "Your elbows and wrists were visible in too few frames, so arm movement "
                            "could not be measured reliably.", tips, conf, measured)
    if tilt is not None and tilt > 60:
        return insufficient(ctx, act, "The body looks horizontal (like a push-up) rather than hanging "
                            "vertically, so this does not look like a pull-up. Check the selected activity.",
                            ["Select the activity that matches the video.", tips[0]], conf, measured)
    if hands_up is not None and hands_up < 0.20:
        return insufficient(ctx, act, "The hands are rarely above the shoulders, so a pull-up hang was not "
                            "detected. Check the selected activity and camera framing.",
                            ["Select the activity that matches the video.", tips[1]], conf, measured)
    if hands_up is None:
        ctx.warn("The hands or bar were not clearly visible, so the pull-up position could not be confirmed.")

    eff_high, finished, unfinished = detect_reps(elbow, seq.times, PL_HIGH, PL_PARTIAL, 0.8, 6.0, 8.0)
    if eff_high < PL_HIGH - 1:
        ctx.warn(f"Arms were rarely fully extended between repetitions, so the 'hang' position was set "
                 f"to {eff_high:.0f} degrees.")
    if unfinished:
        ctx.warn("The video ended in the middle of a repetition; that unfinished repetition was not counted.")
    if not finished:
        return insufficient(ctx, act, "No complete pull-up movement cycle (hang, pull, lower) was detected.",
                            tips + ["Record at least 2-3 full repetitions."], conf, measured, reps=0, incomplete=0)

    sh_clean = clean_signal(sh_y, seq.fps)
    tilt_clean = clean_signal(ctx.torso_tilt_series(), seq.fps) if ctx.view == "side" else None
    nose = point_series(seq, NOSE, 0.6)
    lw, rw = point_series(seq, L_WRIST, 0.6), point_series(seq, R_WRIST, 0.6)

    reps: List[Dict] = []
    for k, e in enumerate(finished, 1):
        rise = None
        if ctx.torso and np.isfinite(sh_clean[e.start]):
            ymin = safe_min(sh_clean[e.start: e.end + 1])
            rise = None if ymin is None else float((sh_clean[e.start] - ymin) / ctx.torso)
        complete = e.min_value <= PL_LOW and (rise is None or rise >= PL_MIN_RISE)
        r = make_rep(k, e, elbow, complete)
        r["rise"] = rise
        r["swing"] = safe_std(tilt_clean[e.start: e.end + 1]) if tilt_clean is not None else None
        near = slice(max(0, e.bottom - 2), e.bottom + 3)
        hand_ys = [safe_median(lw[near, 1]), safe_median(rw[near, 1])]
        hand_ys = [h for h in hand_ys if h is not None]
        nose_y = safe_median(nose[near, 1])
        r["head_at_hands"] = (bool(nose_y <= min(hand_ys)) if (nose_y is not None and hand_ys) else None)
        reps.append(r)
    n_all = len(reps)
    n_complete = sum(1 for r in reps if r["complete"])
    n_incomplete = n_all - n_complete

    rom = safe_mean([linear_score(r["min"], 70, 130) for r in reps])
    ext = safe_mean([linear_score(r["max"], 165, 135) for r in reps])
    completion = 100.0 * n_complete / n_all
    swings = [r["swing"] for r in reps if r["swing"] is not None]
    control = safe_mean([linear_score(v, 4.0, 15.0) for v in swings]) if (ctx.view == "side" and swings) else None
    cons, cv_dur, std_depth = consistency([r["duration"] for r in reps], [r["min"] for r in reps],
                                           (0.10, 0.45), (5.0, 25.0))
    mean_min = safe_mean([r["min"] for r in reps])
    mean_max = safe_mean([r["max"] for r in reps])
    mean_rise = safe_mean([r["rise"] for r in reps])

    criteria = [
        criterion("range", "Pulling range (elbow flexion)", 0.30, rom,
                  f"Per repetition: 100 when the elbows bend to 70 degrees or less, 0 at 130 or more. "
                  f"Average lowest elbow angle: {mean_min:.0f} degrees."),
        criterion("extension", "Arm extension at the bottom", 0.25, ext,
                  f"100 when the arms straighten to 165 degrees or more, 0 at 135 or less. "
                  f"Average: {mean_max:.0f} degrees."),
        criterion("completion", "Completed repetitions", 0.20, completion,
                  f"{n_complete} of {n_all} attempts bent the elbows to {PL_LOW:.0f} degrees or less, raised the "
                  f"shoulders by at least {PL_MIN_RISE:.2f} torso lengths and returned to a hang."),
        criterion("control", "Body control (swing)", 0.15, control,
                  ("Variation in torso angle during each repetition: 100 at 4 degrees or less, 0 at 15 or more."
                   if control is not None else "Not evaluated: needs a clear side view.")),
        criterion("consistency", "Consistency", 0.10, cons,
                  (f"Combines variation in repetition duration (CV {cv_dur * 100:.0f}%) and pulling range."
                   if cons is not None else "Not evaluated: at least 3 repetitions are needed.")),
    ]
    score, criteria = combine(criteria)

    mistakes: List[Dict] = []
    bad = rep_numbers(reps, lambda r: not r["complete"])
    if bad:
        mistakes.append(mistake("incomplete_pull", "Incomplete repetitions",
                                f"{len(bad)} attempt(s) did not pull high enough or bend the elbows enough.",
                                severity_for(len(bad) / n_all), bad))
    short = rep_numbers(reps, lambda r: r["max"] < 155)
    if short:
        mistakes.append(mistake("partial_extension", "Arms not fully extended at the bottom",
                                "The elbows did not reach about 155 degrees between repetitions.",
                                severity_for(len(short) / n_all), short))
    swing = rep_numbers(reps, lambda r: r["swing"] is not None and r["swing"] > 12)
    if swing:
        mistakes.append(mistake("body_swing", "Body swinging", "The torso angle varied a lot, suggesting swinging or kipping.",
                                severity_for(len(swing) / n_all), swing))

    feedback = [f"{n_complete} pull-up(s) met the elbow-flexion and shoulder-rise criteria."]
    if n_incomplete:
        feedback.append(f"{n_incomplete} attempt(s) were incomplete.")
    feedback.append("The bar and grip are not detected, so chin-over-bar clearance and grip quality are NOT verified.")
    checked = [r["head_at_hands"] for r in reps if r["complete"] and r["head_at_hands"] is not None]
    estimated: Dict = {"averageShoulderRiseTorsoLengths": r1(mean_rise, 2)}
    if checked:
        estimated["headReachedHandLevelReps"] = int(sum(checked))
        estimated["headHandLevelRepsChecked"] = len(checked)
        feedback.append("Head height relative to the hands was checked as a rough indicator only; the bar itself "
                        "is not detected.")

    suggestions: List[str] = []
    if bad:
        suggestions.append("Pull until your elbows are well bent and your chest rises towards the bar.")
    if short:
        suggestions.append("Lower under control to fully straight arms before each new repetition.")
    if swing:
        suggestions.append("Brace your core and legs to reduce swinging for stricter repetitions.")
    if not suggestions:
        suggestions.append("Good range of motion. Keep control on the way down.")

    summary = (f"{n_complete} completed pull-up(s) and {n_incomplete} incomplete attempt(s) detected. "
               f"Form score {score:.0f}/100 (experimental estimate).")
    return build_result(
        ctx, act, "completed", reps=n_complete, incomplete=n_incomplete, score=score, criteria=criteria,
        feedback=feedback, mistakes=mistakes, suggestions=suggestions, summary=summary, confidence=conf,
        measured={"analyzedSeconds": r1(seq.duration), "averageLowestElbowAngleDeg": r1(mean_min),
                  "averageExtendedElbowAngleDeg": r1(mean_max),
                  "averageRepDurationSeconds": r1(safe_mean([r["duration"] for r in reps]), 2),
                  "framesWithHandsAboveShouldersPercent": measured["framesWithHandsAboveShouldersPercent"],
                  "torsoTiltFromVerticalDeg": r1(tilt)},
        estimated=estimated)


# ================================================================ RUNNING
def analyze_running(ctx: Context) -> Dict:
    seq, act = ctx.seq, "running"
    key = [L_SHOULDER, R_SHOULDER, L_HIP, R_HIP, L_KNEE, R_KNEE, L_ANKLE, R_ANKLE]
    fs = seq.fps
    tips = ["Film from the side (best) or front/back, with the whole body visible, for at least 5-10 seconds.",
            "Keep the camera steady and make sure both legs are visible."]
    la, ra = point_series(seq, L_ANKLE), point_series(seq, R_ANKLE)

    # per-frame body-size scale (handles a runner moving towards/away from the camera)
    if not ctx.torso:
        return insufficient(ctx, act, "The shoulders and hips were not visible long enough to estimate body size.",
                            tips, ctx.confidence(key, 0.0))
    scale = np.linalg.norm(midpoint_series(seq, L_SHOULDER, R_SHOULDER) - midpoint_series(seq, L_HIP, R_HIP), axis=1)
    scale = clean_signal(scale, fs)
    scale = np.where(np.isnan(scale), ctx.torso, np.clip(scale, 0.5 * ctx.torso, 2.0 * ctx.torso))

    dx = clean_signal((la[:, 0] - ra[:, 0]) / scale, fs, 0.3, 0.08)
    dy = clean_signal((la[:, 1] - ra[:, 1]) / scale, fs, 0.3, 0.08)
    cov = max(valid_fraction(dx), valid_fraction(dy))
    conf = ctx.confidence(key, cov)
    tilt_raw = ctx.torso_tilt_series()
    tilt_med = safe_median(tilt_raw)
    measured = {"analyzedSeconds": r1(seq.duration)}

    if seq.duration < 3.0:
        return insufficient(ctx, act, "The video is too short (under 3 seconds) to analyse running reliably.",
                            tips, conf, measured)
    if cov < 0.4:
        return insufficient(ctx, act, "Both ankles were visible in too few frames.", tips, conf, measured)
    if tilt_med is not None and tilt_med > 50:
        return insufficient(ctx, act, "The torso does not look upright, so this does not look like running. "
                            "Check the selected activity.", ["Select the activity that matches the video.", tips[0]],
                            conf, measured)

    best = None
    for name, sig in (("horizontal", dx), ("vertical", dy)):
        f, strength = dominant_frequency(sig, fs, 0.6, 2.2)
        p2p = (safe_percentile(sig, 95) or 0.0) - (safe_percentile(sig, 5) or 0.0)
        if f is not None and (best is None or strength > best["strength"]):
            best = {"name": name, "sig": sig, "f": f, "strength": strength, "p2p": p2p}
    if best is None or best["strength"] < 0.20:
        return insufficient(ctx, act, "No regular alternating leg movement was detected. The footage may not show "
                            "running, or the legs may be hidden.", tips, conf, measured)
    if best["p2p"] < 0.15:
        return insufficient(ctx, act, "The legs barely moved relative to the body, so no running pattern was found.",
                            tips, conf, measured)

    sig = best["sig"]
    ext = find_extrema(sig, max(0.05, 0.30 * best["p2p"]))
    if len(ext) < 6:
        return insufficient(ctx, act, "Too few steps were detected to evaluate running form.", tips, conf, measured)

    idx = np.array([i for i, _ in ext])
    signs = np.array([s for _, s in ext])
    step_times = seq.times[idx]
    intervals = np.diff(step_times)
    plausible = intervals[(intervals > 0.12) & (intervals < 1.5)]
    if plausible.size < 5:
        return insufficient(ctx, act, "The detected steps were not regular enough to evaluate.", tips, conf, measured)

    med_int = float(np.median(plausible))
    cadence_spec = 2.0 * best["f"] * 60.0
    cadence_ext = 60.0 / med_int
    if abs(cadence_spec - cadence_ext) / cadence_spec > 0.15:
        ctx.warn("Two cadence methods disagreed by more than 15%, so the cadence value is only approximate.")
    if ctx.view != "side":
        ctx.warn("From a front/back view, left-right symmetry values can be affected by camera angle.")
    ctx.warn("Distance, speed and acceleration are not reported: they need camera calibration or known distances.")

    cv_steps = float(np.std(plausible) / np.mean(plausible))
    n_irregular = int(np.sum((intervals < 0.6 * med_int) | (intervals > 1.5 * med_int)))

    vals = sig[idx]
    pos, neg = vals[signs > 0], -vals[signs < 0]
    amp_asym = None
    if pos.size >= 2 and neg.size >= 2 and (pos.mean() + neg.mean()) > 0:
        amp_asym = float(abs(pos.mean() - neg.mean()) / ((pos.mean() + neg.mean()) / 2.0))
    a_int = [intervals[i] for i in range(len(intervals)) if signs[i] > 0 and 0.12 < intervals[i] < 1.5]
    b_int = [intervals[i] for i in range(len(intervals)) if signs[i] < 0 and 0.12 < intervals[i] < 1.5]
    t_asym = None
    if len(a_int) >= 2 and len(b_int) >= 2:
        t_asym = float(abs(np.mean(a_int) - np.mean(b_int)) / np.mean(a_int + b_int))

    lean = clean_signal(tilt_raw, fs)
    lean_med, lean_std = safe_median(lean), safe_std(lean)

    reg_score = linear_score(cv_steps, 0.05, 0.25)
    sym_parts = [s for s in (linear_score(amp_asym, 0.08, 0.45), linear_score(t_asym, 0.04, 0.25)) if s is not None]
    sym_score = float(np.mean(sym_parts)) if sym_parts else None
    posture = None
    if ctx.view == "side" and lean_med is not None:
        posture = 100.0 if lean_med <= 20 else linear_score(lean_med, 20, 45)
    stability = linear_score(lean_std, 3.0, 10.0)

    criteria = [
        criterion("regularity", "Stride timing regularity", 0.35, reg_score,
                  f"Variation of the time between steps: 100 at 5% or less, 0 at 25% or more. Measured: {cv_steps * 100:.0f}%."),
        criterion("symmetry", "Left-right symmetry", 0.25, sym_score,
                  ("Difference between left-leading and right-leading step reach and timing: 100 at small "
                   "differences (about 8% reach / 4% timing), 0 at large ones (45% / 25%)."
                   if sym_score is not None else "Not evaluated: too few alternating steps.")),
        criterion("posture", "Trunk posture", 0.20, posture,
                  (f"Forward trunk lean: 100 at 20 degrees or less, 0 at 45 degrees or more. Median: {lean_med:.0f} degrees."
                   if posture is not None else "Not evaluated: needs a side view.")),
        criterion("stability", "Trunk stability", 0.20, stability,
                  (f"Variation of trunk angle during the run: 100 at 3 degrees or less, 0 at 10 or more. "
                   f"Measured: {lean_std:.1f} degrees." if stability is not None else "Not evaluated.")),
    ]
    score, criteria = combine(criteria)
    if score is None:
        return insufficient(ctx, act, "Not enough measurements could be evaluated.", tips, conf, measured)

    hip_y = clean_signal(midpoint_series(seq, L_HIP, R_HIP)[:, 1], fs)
    bounce = None
    if valid_fraction(hip_y) > 0.4:
        bounce = ((safe_percentile(hip_y, 95) - safe_percentile(hip_y, 5)) / ctx.torso)

    mistakes: List[Dict] = []
    if n_irregular:
        mistakes.append(mistake("irregular_steps", "Irregular step timing",
                                f"{n_irregular} step interval(s) were much longer or shorter than usual "
                                f"(possible stumbles, pauses or detection glitches).", severity_for(n_irregular / len(intervals))))
    if sym_score is not None and sym_score < 50:
        mistakes.append(mistake("asymmetry", "Left-right asymmetry",
                                "One leg's reach or timing differed noticeably from the other.", "medium"))
    if posture is not None and lean_med > 30:
        mistakes.append(mistake("excess_lean", "Large forward trunk lean",
                                f"Median trunk lean was about {lean_med:.0f} degrees.", "medium"))
    if stability is not None and stability < 40:
        mistakes.append(mistake("unstable_trunk", "Unstable trunk", "The trunk angle varied a lot during running.", "medium"))

    feedback = [
        f"Estimated cadence: about {cadence_spec:.0f} steps per minute (estimate, not a measured value).",
        f"{len(ext)} steps were detected over {seq.duration:.0f} seconds.",
        "Distance, speed and acceleration are not calculated because the video has no calibration.",
    ]
    feedback.append("Step timing was steady." if reg_score is not None and reg_score >= 75
                    else "Step timing varied from step to step.")
    suggestions: List[str] = []
    if reg_score is not None and reg_score < 60:
        suggestions.append("Practise a steady rhythm, for example with a metronome or music at your target cadence.")
    if sym_score is not None and sym_score < 60:
        suggestions.append("Check for a limp or tightness on one side; film again from a perpendicular angle to confirm.")
    if posture is not None and lean_med > 25:
        suggestions.append("Run tall with a slight lean from the ankles, not the waist.")
    if stability is not None and stability < 60:
        suggestions.append("Strengthen your core and keep your torso quiet while your legs move.")
    if not suggestions:
        suggestions.append("Running movement looks consistent. Repeat on a longer clip to confirm.")

    summary = (f"Estimated cadence about {cadence_spec:.0f} steps/min with {len(ext)} detected steps. "
               f"Movement-consistency score {score:.0f}/100 (experimental estimate).")
    return build_result(
        ctx, act, "completed", reps=None, incomplete=None, score=score, criteria=criteria, feedback=feedback,
        mistakes=mistakes, suggestions=suggestions, summary=summary, confidence=conf,
        measured={"analyzedSeconds": r1(seq.duration),
                  "medianTrunkLeanDeg": r1(lean_med if ctx.view == "side" else None),
                  "trunkAngleVariationDeg": r1(lean_std)},
        estimated={"cadenceStepsPerMinute": r1(cadence_spec, 0), "detectedSteps": len(ext),
                   "medianStepIntervalSeconds": r1(med_int, 2),
                   "stepTimingVariationPercent": r1(cv_steps * 100),
                   "verticalBounceTorsoLengths": r1(bounce, 2),
                   "legSignalUsed": best["name"], "rhythmStrength": r1(best["strength"], 2)})


ANALYZERS = {
    "pushups": analyze_pushups,
    "squats": analyze_squats,
    "pullups": analyze_pullups,
    "running": analyze_running,
}


def analyze_activity(activity: str, seq: PoseSequence, requested_view: str, video_info: Dict,
                     warnings: List[str], penalty: float) -> Dict:
    fn = ANALYZERS.get(activity)
    if fn is None:
        raise AnalysisError("UNSUPPORTED_ACTIVITY", f"Unsupported activity: {activity}")
    ctx = Context(seq, requested_view, video_info, warnings, penalty)
    result = fn(ctx)
    if result["confidence"]["overall"] < 0.5:
        ctx.warn("Overall analysis confidence is low. Results may be unreliable.")
        result["confidence"]["warnings"] = list(ctx.warnings)
    return result