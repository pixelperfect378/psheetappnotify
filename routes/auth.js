const express = require('express');
const router = express.Router();
const { google } = require('googleapis');
const credentials = require('../config/credentials');
const db = require('../services/db');
const authMiddleware = require('../middleware/authMiddleware');

// Initialize OAuth2 client with explicit validation
if (!credentials.google.clientId || !credentials.google.clientSecret) {
  console.error('[Auth] Error: Google OAuth credentials not found in environment.');
}

const oauth2Client = new google.auth.OAuth2(
  credentials.google.clientId,
  credentials.google.clientSecret,
  credentials.google.redirectUri
);

/**
 * GET /auth/google
 * Step 1: Redirect user to Google for consent.
 * access_type=offline and prompt=consent are MANDATORY to get a refresh_token.
 */
router.get('/google', (req, res) => {
  const scopes = [
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive.file'
  ];

  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: scopes,
    // You can pass state if you need to carry info through the redirect
    state: req.query.userId || 'anonymous' 
  });

  res.redirect(url);
});

/**
 * GET /auth/google/callback
 * Step 2: Handle redirect from Google, exchange code for tokens, and UPSERT into DB.
 */
router.get('/google/callback', async (req, res) => {
  const { code, state } = req.query;
  const userId = state; // We used state to pass userId in this example

  try {
    console.log('[Auth] Exchanging code for tokens...');
    console.log('[Auth] Used Client ID:', credentials.google.clientId);
    
    if (!code) throw new Error('No code provided in callback');

    const { tokens } = await oauth2Client.getToken(code);
    console.log('[Auth] Received tokens for user:', userId);

    const { access_token, refresh_token, expiry_date } = tokens;
    
    // Save tokens into watched_sheets (or a dedicated users table if preferred)
    // Here we UPSERT based on user_id. 
    // Note: In a real app, you might want a separate 'user_tokens' table.
    // For now, we'll update all entries for this user in watched_sheets.
    
    const tokenExpiry = expiry_date ? new Date(expiry_date) : null;

    // Use a transaction or a simple update
    await db.query(`
      UPDATE watched_sheets 
      SET 
        access_token = $1, 
        refresh_token = COALESCE($2, refresh_token), 
        token_expiry = $3 
      WHERE user_id = $4
    `, [access_token, refresh_token, tokenExpiry, userId]);

    // If no records updated, it means the user hasn't watched any sheets yet.
    // That's fine, the tokens will be useful once they do.

    res.send('<h1>Authentication Successful!</h1><p>You can close this window and return to the app.</p>');
  } catch (error) {
    console.error('[Auth] Error during callback:', error.message);
    res.status(500).send('Authentication failed: ' + error.message);
  }
});

module.exports = router;
