require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const credentials = require('./config/credentials');

// Routes
const sheetsRouter = require('./routes/sheets');
const notificationsRouter = require('./routes/notifications');
const deviceRouter = require('./routes/device');

const app = express();

// ─── Security ───────────────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({
    origin: credentials.allowedOrigin,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Rate limiting (all routes)
const limiter = rateLimit({
    windowMs: credentials.rateLimit.windowMs,
    max: credentials.rateLimit.max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later.' },
});
app.use(limiter);

// ─── Body Parsing & Logging ─────────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));
app.use(morgan(credentials.nodeEnv === 'production' ? 'combined' : 'dev'));

// ─── Health Check ───────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        version: '1.0.0',
    });
});

// ─── API Routes ─────────────────────────────────────────────────────────────
app.use('/sheets', sheetsRouter);
app.use('/sheet', sheetsRouter);           // alias
app.use('/notification', notificationsRouter);
app.use('/notifications', notificationsRouter); // alias
app.use('/register-device', deviceRouter);

// ─── 404 Handler ────────────────────────────────────────────────────────────
app.use((req, res) => {
    res.status(404).json({ error: `Route ${req.method} ${req.path} not found` });
});

// ─── Global Error Handler ───────────────────────────────────────────────────
app.use((err, req, res, _next) => {
    console.error('[Server] Unhandled error:', err);
    res.status(500).json({
        error: 'Internal server error',
        ...(credentials.nodeEnv !== 'production' && { detail: err.message }),
    });
});

// ─── Start ───────────────────────────────────────────────────────────────────
const PORT = credentials.port;
const HOST = '0.0.0.0'; // Bind to all interfaces (external access)
app.listen(PORT, HOST, () => {
    console.log(`✅ SheetNotify backend running on http://${credentials.host || '10.100.192.215'}:${PORT} [${credentials.nodeEnv}]`);
});

module.exports = app;
