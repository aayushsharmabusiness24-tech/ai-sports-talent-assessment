const express = require('express');
const config = require('../config');
const { checkDatabase } = require('../database/db');
const { checkAiService } = require('../services/ai.service');
const { ALLOWED_EXTENSIONS } = require('../middleware/upload');

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const database = checkDatabase();
    const ai = await checkAiService();
    const ok = database.ok && ai.ok;

    res.json({
      status: ok ? 'ok' : 'degraded',
      time: new Date().toISOString(),
      database,
      ai,
      limits: {
        maxUploadMb: config.maxUploadMb,
        allowedExtensions: ALLOWED_EXTENSIONS,
        aiTimeoutSeconds: Math.round(config.aiTimeoutMs / 1000),
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;