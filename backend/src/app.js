const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const config = require('./config');
const AppError = require('./utils/AppError');
const { notFound, errorHandler } = require('./middleware/errorHandler');

const healthRoutes = require('./routes/health.routes');
const authRoutes = require('./routes/auth.routes');
const assessmentRoutes = require('./routes/assessment.routes');

const app = express();

const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1):\d+$/;
const allowedOrigins = new Set(config.frontendOrigins);

app.disable('x-powered-by');
app.use(helmet());
app.use(
  cors({
    origin: (origin, cb) => {
      // No Origin header = same-origin / curl / server-to-server.
      if (!origin || allowedOrigins.has(origin) || LOCAL_ORIGIN.test(origin)) {
        return cb(null, true);
      }
      return cb(new AppError(403, 'CORS_BLOCKED', 'This origin is not allowed to use the API.'));
    },
  })
);
app.use(express.json({ limit: '1mb' }));

app.use('/api/health', healthRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/assessments', assessmentRoutes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;