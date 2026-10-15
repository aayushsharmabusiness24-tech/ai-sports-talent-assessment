const express = require('express');
const { authenticate } = require('../middleware/auth');
const { uploadVideo } = require('../middleware/upload');
const {
  createAssessment,
  listAssessments,
  getAssessment,
  getAssessmentStatus,
} = require('../controllers/assessment.controller');

const router = express.Router();

// Every assessment route requires a logged-in user (checked BEFORE the upload is accepted).
router.use(authenticate);

router.post('/', uploadVideo, createAssessment);
router.get('/', listAssessments);
router.get('/:id/status', getAssessmentStatus);
router.get('/:id', getAssessment);

module.exports = router;