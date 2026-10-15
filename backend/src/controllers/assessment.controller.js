const fs = require('fs');
const path = require('path');
const { db } = require('../database/db');
const AppError = require('../utils/AppError');
const { analyzeVideo } = require('../services/ai.service');
const { generateCoaching } = require('../services/coach.service');

const ACTIVITIES = {
  pushups: 'Push-ups',
  squats: 'Squats',
  pullups: 'Pull-ups',
  running: 'Running',
};
const CAMERA_VIEWS = ['auto', 'side', 'front', 'back'];

const insertAssessment = db.prepare(
  `INSERT INTO assessments (user_id, exercise_type, camera_view, video_filename, status)
   VALUES (?, ?, ?, ?, 'processing')`
);
const completeAssessment = db.prepare(
  `UPDATE assessments
      SET status = ?, repetitions = ?, incomplete_repetitions = ?, form_score = ?,
          feedback_json = ?, result_json = ?, processing_ms = ?, completed_at = datetime('now')
    WHERE id = ?`
);
const failAssessment = db.prepare(
  `UPDATE assessments
      SET status = 'failed', error_code = ?, error_message = ?, processing_ms = ?,
          completed_at = datetime('now')
    WHERE id = ?`
);
const findOwned = db.prepare('SELECT * FROM assessments WHERE id = ? AND user_id = ?');
const listOwned = db.prepare(
  `SELECT * FROM assessments WHERE user_id = ?
    ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`
);
const countOwned = db.prepare('SELECT COUNT(*) AS total FROM assessments WHERE user_id = ?');

function parseJson(text, fallback) {
  if (!text) return fallback;
  try {
    return JSON.parse(text);
  } catch (err) {
    return fallback;
  }
}

function toIso(sqliteDate) {
  return sqliteDate ? `${sqliteDate.replace(' ', 'T')}Z` : null;
}

function toAssessment(row) {
  if (!row) return null;
  return {
    id: row.id,
    exerciseType: row.exercise_type,
    exerciseLabel: ACTIVITIES[row.exercise_type] || row.exercise_type,
    cameraView: row.camera_view,
    videoFilename: row.video_filename,
    status: row.status,
    repetitions: row.repetitions,
    incompleteRepetitions: row.incomplete_repetitions,
    formScore: row.form_score,
    feedback: parseJson(row.feedback_json, []),
    result: parseJson(row.result_json, null),
    error: row.error_code ? { code: row.error_code, message: row.error_message } : null,
    processingMs: row.processing_ms,
    createdAt: toIso(row.created_at),
    completedAt: toIso(row.completed_at),
  };
}

function parseId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw new AppError(400, 'INVALID_ID', 'Assessment id must be a positive whole number.');
  }
  return id;
}

async function createAssessment(req, res, next) {
  const file = req.file;
  try {
    if (!file) {
      throw new AppError(400, 'NO_VIDEO', 'No video file was received. Choose a video and try again.');
    }

    const activity = String(req.body.activity || '').toLowerCase();
    if (!ACTIVITIES[activity]) {
      throw new AppError(
        400,
        'UNSUPPORTED_ACTIVITY',
        `Unsupported activity. Choose one of: ${Object.keys(ACTIVITIES).join(', ')}.`
      );
    }

    const cameraView = String(req.body.cameraView || 'auto').toLowerCase();
    if (!CAMERA_VIEWS.includes(cameraView)) {
      throw new AppError(
        400,
        'INVALID_CAMERA_VIEW',
        `Invalid camera view. Choose one of: ${CAMERA_VIEWS.join(', ')}.`
      );
    }

    const safeName = path
      .basename(file.originalname || 'video')
      .replace(/[^\w.\- ]/g, '_')
      .slice(0, 120);

    const info = insertAssessment.run(req.user.id, activity, cameraView, safeName);
    const assessmentId = Number(info.lastInsertRowid);
    const started = Date.now();

    let analysis;
    try {
      analysis = await analyzeVideo({ videoPath: file.path, activity, cameraView });
    } catch (err) {
      failAssessment.run(
        err.code || 'AI_FAILURE',
        err.message || 'Analysis failed.',
        Date.now() - started,
        assessmentId
      );
      err.assessmentId = assessmentId;
      throw err;
    }
    analysis.coaching = await generateCoaching(analysis);
    completeAssessment.run(
      analysis.status,
      analysis.repetitions,
      analysis.incompleteRepetitions,
      analysis.formScore,
      JSON.stringify(analysis.feedback),
      JSON.stringify(analysis),
      Date.now() - started,
      assessmentId
    );

    const row = findOwned.get(assessmentId, req.user.id);
    res.status(201).json({ assessment: toAssessment(row) });
  } catch (err) {
    next(err);
  } finally {
    // Temporary video is always deleted.
    if (file && file.path) fs.promises.unlink(file.path).catch(() => {});
  }
}

function listAssessments(req, res, next) {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 500);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    const rows = listOwned.all(req.user.id, limit, offset);
    const { total } = countOwned.get(req.user.id);
    res.json({ total, assessments: rows.map(toAssessment) });
  } catch (err) {
    next(err);
  }
}

function getAssessment(req, res, next) {
  try {
    const id = parseId(req.params.id);
    const row = findOwned.get(id, req.user.id);
    if (!row) throw new AppError(404, 'ASSESSMENT_NOT_FOUND', 'Assessment not found.');
    res.json({ assessment: toAssessment(row) });
  } catch (err) {
    next(err);
  }
}

function getAssessmentStatus(req, res, next) {
  try {
    const id = parseId(req.params.id);
    const row = findOwned.get(id, req.user.id);
    if (!row) throw new AppError(404, 'ASSESSMENT_NOT_FOUND', 'Assessment not found.');
    res.json({
      id: row.id,
      status: row.status,
      error: row.error_code ? { code: row.error_code, message: row.error_message } : null,
      completedAt: toIso(row.completed_at),
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { createAssessment, listAssessments, getAssessment, getAssessmentStatus };