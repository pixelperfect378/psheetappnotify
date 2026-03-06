const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { registerToken } = require('../services/tokenStore');

/**
 * POST /register-device
 * Registers an FCM device token for the authenticated user.
 *
 * Body:
 * {
 *   "token": "fcm_device_token"
 * }
 */
router.post('/', authMiddleware, async (req, res) => {
    try {
        const { token } = req.body;
        if (!token) {
            return res.status(400).json({ error: 'FCM token is required' });
        }

        const userId = req.user.uid;
        registerToken(userId, token);
        console.log(`[Device] Token registered for user: ${userId}`);
        return res.json({ success: true, message: 'Device token registered' });
    } catch (err) {
        console.error('[Device] Registration error:', err.message);
        return res.status(500).json({ error: 'Failed to register device', detail: err.message });
    }
});

module.exports = router;
