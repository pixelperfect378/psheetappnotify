const db = require('./db');

/**
 * Register an FCM token for a user.
 * @param {string} userId
 * @param {string} token
 */
async function registerToken(userId, token) {
    try {
        await db.query(
            'INSERT INTO fcm_tokens (user_id, token) VALUES ($1, $2) ON CONFLICT (user_id, token) DO NOTHING',
            [userId, token]
        );
        console.log(`[TokenStore] Registered token for user ${userId}`);
    } catch (err) {
        console.error('[TokenStore] Failed to register token:', err.message);
    }
}

/**
 * Get all FCM tokens stored for a user.
 * @param {string} userId
 * @returns {Promise<string[]>}
 */
async function getTokensForUser(userId) {
    try {
        const res = await db.query('SELECT token FROM fcm_tokens WHERE user_id = $1', [userId]);
        return res.rows.map(r => r.token);
    } catch (err) {
        console.error('[TokenStore] Failed to get tokens for user:', err.message);
        return [];
    }
}

/**
 * Get all registered tokens (useful for broadcast).
 * @returns {Promise<string[]>}
 */
async function getAllTokens() {
    try {
        const res = await db.query('SELECT DISTINCT token FROM fcm_tokens');
        return res.rows.map(r => r.token);
    } catch (err) {
        console.error('[TokenStore] Failed to get all tokens:', err.message);
        return [];
    }
}

/**
 * Remove a specific token (e.g. when FCM reports it as invalid).
 * @param {string} userId
 * @param {string} token
 */
async function removeToken(userId, token) {
    try {
        if (userId) {
            await db.query('DELETE FROM fcm_tokens WHERE user_id = $1 AND token = $2', [userId, token]);
        } else {
            await db.query('DELETE FROM fcm_tokens WHERE token = $1', [token]);
        }
        console.log(`[TokenStore] Removed token for ${userId || 'unknown user'}`);
    } catch (err) {
        console.error('[TokenStore] Failed to remove token:', err.message);
    }
}

module.exports = { registerToken, getTokensForUser, getAllTokens, removeToken };
