const fs = require('fs');
const path = require('path');

// Simple persistent device token store using a JSON file.
const TOKENS_FILE = path.join(__dirname, '../data/tokens.json');

// Ensure data directory exists
const dataDir = path.dirname(TOKENS_FILE);
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

let tokenStore = new Map(); // userId -> Set<token>

// Load tokens from file on startup
function loadTokens() {
    try {
        if (fs.existsSync(TOKENS_FILE)) {
            const data = JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf8'));
            for (const [userId, tokens] of Object.entries(data)) {
                tokenStore.set(userId, new Set(tokens));
            }
            console.log(`[TokenStore] Loaded ${tokenStore.size} users from persistent storage`);
        }
    } catch (err) {
        console.error('[TokenStore] Failed to load tokens:', err.message);
    }
}

// Save tokens to file
function saveTokens() {
    try {
        const data = {};
        for (const [userId, tokens] of tokenStore.entries()) {
            data[userId] = Array.from(tokens);
        }
        fs.writeFileSync(TOKENS_FILE, JSON.stringify(data, null, 2));
    } catch (err) {
        console.error('[TokenStore] Failed to save tokens:', err.message);
    }
}

loadTokens();

/**
 * Register an FCM token for a user.
 * @param {string} userId
 * @param {string} token
 */
function registerToken(userId, token) {
    if (!tokenStore.has(userId)) {
        tokenStore.set(userId, new Set());
    }
    const userTokens = tokenStore.get(userId);
    if (!userTokens.has(token)) {
        userTokens.add(token);
        saveTokens();
        console.log(`[TokenStore] Registered new token for user ${userId}`);
    }
}

/**
 * Get all FCM tokens stored for a user.
 * @param {string} userId
 * @returns {string[]}
 */
function getTokensForUser(userId) {
    const set = tokenStore.get(userId);
    return set ? Array.from(set) : [];
}

/**
 * Get all registered tokens (useful for broadcast).
 * @returns {string[]}
 */
function getAllTokens() {
    const all = [];
    for (const tokens of tokenStore.values()) {
        all.push(...Array.from(tokens));
    }
    return [...new Set(all)]; // Ensure unique
}

/**
 * Remove a specific token (e.g. when FCM reports it as invalid).
 * @param {string} userId
 * @param {string} token
 */
function removeToken(userId, token) {
    if (tokenStore.has(userId)) {
        if (tokenStore.get(userId).delete(token)) {
            saveTokens();
            console.log(`[TokenStore] Removed token for user ${userId}`);
        }
    } else {
        // Fallback: search all users if userId not provided correctly
        for (const [uid, tokens] of tokenStore.entries()) {
            if (tokens.delete(token)) {
                saveTokens();
                console.log(`[TokenStore] Removed token for user ${uid} (searched)`);
            }
        }
    }
}

module.exports = { registerToken, getTokensForUser, getAllTokens, removeToken };
