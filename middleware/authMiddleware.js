const { verifyIdToken } = require('../services/firebaseService');

/**
 * Middleware to verify Firebase ID token from Authorization header.
 * Attaches decoded token to req.user.
 */
async function authMiddleware(req, res, next) {
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Missing or invalid Authorization header' });
    }

    const idToken = authHeader.split('Bearer ')[1].trim();
    try {
        const decodedToken = await verifyIdToken(idToken);
        req.user = decodedToken; // { uid, email, ... }
        next();
    } catch (err) {
        console.error('[Auth] Token verification failed:', err.message);
        return res.status(403).json({ error: 'Invalid or expired token' });
    }
}

module.exports = authMiddleware;
