const admin = require('firebase-admin');
const credentials = require('../config/credentials');

let initialized = false;

function initializeFirebase() {
    if (initialized) return;

    let serviceAccount;
    if (credentials.firebase.serviceAccountPath) {
        serviceAccount = require(credentials.firebase.serviceAccountPath);
    } else {
        throw new Error(
            'Firebase service account not configured. Set FIREBASE_SERVICE_ACCOUNT_PATH in .env'
        );
    }

    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: credentials.firebase.projectId,
    });

    initialized = true;
    console.log('[Firebase] Admin SDK initialized');
}

/**
 * Send an FCM notification to a single device token.
 * @param {string} token - FCM registration token
 * @param {object} notification - { title, body }
 * @param {object} data  - additional key/value string pairs
 */
async function sendPushNotification(token, notification, data = {}) {
    initializeFirebase();

    const stringData = {};
    for (const [k, v] of Object.entries(data)) {
        stringData[k] = String(v);
    }

    const message = {
        token,
        notification: {
            title: notification.title,
            body: notification.body,
        },
        data: stringData,
        android: {
            priority: 'high',
            notification: {
                channelId: 'sheet_updates',
                sound: 'default'
            },
        },
    };

    const response = await admin.messaging().send(message);
    console.log('[Firebase] FCM message sent:', response);
    return response;
}

/**
 * Send a notification to multiple device tokens.
 * @param {string[]} tokens
 * @param {object} notification
 * @param {object} data
 */
async function sendMulticast(tokens, notification, data = {}) {
    initializeFirebase();

    if (!tokens || tokens.length === 0) return null;

    const stringData = {};
    for (const [k, v] of Object.entries(data)) {
        stringData[k] = String(v);
    }

    const message = {
        tokens,
        notification: {
            title: notification.title,
            body: notification.body,
        },
        data: stringData,
        android: {
            priority: 'high',
            notification: {
                channelId: 'sheet_updates',
                sound: 'default',
            },
        },
    };

    const response = await admin.messaging().sendEachForMulticast(message);
    console.log(
        `[Firebase] Multicast: ${response.successCount} success / ${response.failureCount} fail`
    );
    return response;
}

/**
 * Verify a Firebase ID token and return the decoded token.
 * @param {string} idToken
 */
async function verifyIdToken(idToken) {
    initializeFirebase();
    return admin.auth().verifyIdToken(idToken);
}

module.exports = { sendPushNotification, sendMulticast, verifyIdToken };
