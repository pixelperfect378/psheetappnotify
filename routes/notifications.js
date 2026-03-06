const express = require('express');
const router = express.Router();
const { sendMulticast } = require('../services/firebaseService');
const { getAllTokens } = require('../services/tokenStore');
const credentials = require('../config/credentials');

/**
 * GET /
 * Returns status info for the notification endpoint.
 */
router.get('/', (req, res) => {
    res.json({
        service: 'Notification Service',
        status: 'online',
        methods: ['POST'],
        usage: 'POST to /notification with a valid secret to send push notifications.'
    });
});

/**
 * POST /notification
 * Called by Google Apps Script when a new row is added.
 *
 * Body:
 * {
 *   "secret":     "shared secret from .env",
 *   "sheetName":  "Leads",
 *   "sheetId":    "spreadsheet_id",
 *   "firstValue": "John Doe",
 *   "message":    "New entry added"
 * }
 */
router.post('/', async (req, res) => {
    console.log(`[Notification] Incoming request: ${JSON.stringify(req.body)}`);
    try {
        const { secret, sheetName, sheetId, firstValue, message } = req.body;

        // Basic secret validation
        if (!credentials.appsScriptSecret || secret !== credentials.appsScriptSecret) {
            console.warn(`[Notification] Invalid secret attempt: ${secret}`);
            return res.status(403).json({ error: 'Forbidden: invalid secret' });
        }

        const title = `📊 ${sheetName}`;
        const body = `${firstValue} — ${message || 'New entry added'}`;

        const tokens = getAllTokens();
        if (tokens.length === 0) {
            console.warn('[Notification] No registered device tokens to notify.');
            return res.json({ success: true, sent: 0, message: 'No devices registered' });
        }

        const result = await sendMulticast(tokens, { title, body }, {
            sheetId: sheetId || '',
            sheetName: sheetName || '',
            firstValue: firstValue || '',
        });

        return res.json({
            success: true,
            sent: result?.successCount || 0,
            failed: result?.failureCount || 0,
        });
    } catch (err) {
        console.error('[Notification] Error sending notification:', err.message);
        return res.status(500).json({ error: 'Failed to send notification', detail: err.message });
    }
});

module.exports = router;
