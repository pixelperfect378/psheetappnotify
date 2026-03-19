require('dotenv').config();
const path = require('path');

const credentials = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  allowedOrigin: process.env.ALLOWED_ORIGIN || '*',

  google: {
    serviceAccountPath: process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH
      ? path.resolve(process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH)
      : null,
    serviceAccountJson: process.env.GOOGLE_SERVICE_ACCOUNT_KEY_JSON
      ? JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY_JSON)
      : null,
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    redirectUri: process.env.GOOGLE_REDIRECT_URI || 'https://psheetappnotify-production.up.railway.app/auth/google/callback',
  },

  firebase: {
    serviceAccountPath: process.env.FIREBASE_SERVICE_ACCOUNT_PATH
      ? path.resolve(process.env.FIREBASE_SERVICE_ACCOUNT_PATH)
      : null,
    serviceAccountJson: process.env.FIREBASE_SERVICE_ACCOUNT_JSON
      ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)
      : null,
    projectId: process.env.FIREBASE_PROJECT_ID || '',
  },

  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10),
    max: parseInt(process.env.RATE_LIMIT_MAX || '100', 10),
  },

  apps_script_secret: process.env.APPS_SCRIPT_SECRET || '',
  databaseUrl: process.env.DATABASE_URL || '',
};

module.exports = credentials;
