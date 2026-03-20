const express = require('express');
const router = express.Router();
const { listSheets, getSheetMeta, getSheetData, getDriveClientByUserId } = require('../services/googleSheetsService');
const authMiddleware = require('../middleware/authMiddleware');
const https = require('https');

// ─── Drive Sheets (no service-account auth needed — uses user's token) ────────
// ─── Routes ──────────────────────────────────────────────────────────────────
router.use((req, res, next) => {
    console.log(`[Sheets] ${req.method} ${req.url} - Headers:`, JSON.stringify(req.headers));
    next();
});

router.get('/test-health', (req, res) => res.json({ status: 'ok', serverTime: new Date() }));

// All sheet routes require a valid Firebase token
router.use(authMiddleware);

/**
 * GET /drive-sheets
 * Header: x-google-token: <Google OAuth access token>
 * Returns all of the user's Google Sheets files from Drive.
 */
router.get('/drive-sheets', async (req, res) => {
    const googleToken = req.headers['x-google-token'];
    const userId = req.user?.uid;

    try {
        let drive;
        if (googleToken) {
            const { google } = require('googleapis');
            const auth = new google.auth.OAuth2();
            auth.setCredentials({ access_token: googleToken });
            drive = google.drive({ version: 'v3', auth });
        } else if (userId) {
            drive = await getDriveClientByUserId(userId);
        } else {
            return res.status(401).json({ error: 'Authentication required' });
        }

        const response = await drive.files.list({
            q: "mimeType='application/vnd.google-apps.spreadsheet'",
            fields: "files(id,name)",
            pageSize: 100,
            orderBy: "modifiedTime desc"
        });

        return res.json({ success: true, data: response.data.files || [] });
    } catch (err) {
        console.error('[Sheets] drive-sheets error:', err.message);
        return res.status(500).json({ error: 'Failed to fetch drive sheets', detail: err.message });
    }
});



/**
 * GET /sheets
 * Query params:
 *   spreadsheetId (required) — the Google Spreadsheet ID from its URL
 *
 * Returns list of sheet tabs with metadata.
 */
router.get('/', async (req, res) => {
    try {
        const { spreadsheetId } = req.query;
        const authData = googleToken || req.user?.uid;
        if (!spreadsheetId) {
            return res.status(400).json({ error: 'spreadsheetId query parameter is required' });
        }

        const sheets = await listSheets(spreadsheetId, authData);
        return res.json({ success: true, data: sheets });
    } catch (err) {
        console.error('[Sheets] listSheets error:', err.message);
        return res.status(500).json({ error: 'Failed to fetch sheets', detail: err.message });
    }
});

/**
 * GET /sheet/:id
 * Route param:
 *   id — URL-encoded "spreadsheetId|sheetTitle"  (use | as separator)
 * Query params:
 *   page     (default 1)
 *   pageSize (default 50, max 200)
 *
 * Returns paginated data rows for the sheet tab.
 */
router.get('/:id', async (req, res) => {
    try {
        const parts = decodeURIComponent(req.params.id).split('|');
        const authData = googleToken || req.user?.uid;
        if (parts.length < 2) {
            return res.status(400).json({
                error: 'id must be URL-encoded "spreadsheetId|sheetTitle"',
            });
        }
        const [spreadsheetId, ...titleParts] = parts;
        const sheetTitle = titleParts.join('|');

        const page = Math.max(1, parseInt(req.query.page || '1', 10));
        const pageSize = Math.min(200, Math.max(1, parseInt(req.query.pageSize || '50', 10)));

        const data = await getSheetData(spreadsheetId, sheetTitle, page, pageSize, authData);
        return res.json({ success: true, data });
    } catch (err) {
        console.error('[Sheets] getSheetData error:', err.message);
        return res.status(500).json({ error: 'Failed to fetch sheet data', detail: err.message });
    }
});

/**
 * GET /sheet/:id/meta
 * Same :id format as above.
 * Returns headers, column count, total rows.
 */
router.get('/:id/meta', async (req, res) => {
    try {
        const parts = decodeURIComponent(req.params.id).split('|');
        const authData = googleToken || req.user?.uid;
        if (parts.length < 2) {
            return res.status(400).json({ error: 'id must be "spreadsheetId|sheetTitle"' });
        }
        const [spreadsheetId, ...titleParts] = parts;
        const sheetTitle = titleParts.join('|');

        const meta = await getSheetMeta(spreadsheetId, sheetTitle, authData);
        return res.json({ success: true, data: meta });
    } catch (err) {
        console.error('[Sheets] getSheetMeta error:', err.message);
        return res.status(500).json({ error: 'Failed to fetch sheet metadata', detail: err.message });
    }
});

const { addWatch, removeWatch } = require('../services/watcherService');

/**
 * POST /sheets/watch
 * Registers a sheet for real-time monitoring.
 */
router.post('/watch', async (req, res) => {
    try {
        const { spreadsheetId, sheetTitle } = req.body;
        const userId = req.user.uid;
        if (!spreadsheetId || !sheetTitle) {
            return res.status(400).json({ error: 'spreadsheetId and sheetTitle are required' });
        }

        const googleToken = req.headers['x-google-token'];
        // Pass userId if googleToken is missing - addWatch will use it
        const watch = await addWatch(userId, spreadsheetId, sheetTitle, { access_token: googleToken });
        return res.json({ success: true, data: watch });
    } catch (err) {
        console.error('[Sheets] watch error:', err.message);
        return res.status(500).json({ error: 'Failed to register watch', detail: err.message });
    }
});

/**
 * POST /sheets/unwatch
 * Unregisters a sheet from monitoring.
 */
router.post('/unwatch', async (req, res) => {
    try {
        const { spreadsheetId, sheetTitle } = req.body;
        const userId = req.user.uid;
        await removeWatch(userId, spreadsheetId, sheetTitle);
        return res.json({ success: true, message: 'Watch removed' });
    } catch (err) {
        console.error('[Sheets] unwatch error:', err.message);
        return res.status(500).json({ error: 'Failed to remove watch', detail: err.message });
    }
});

const { createSpreadsheet, appendRow } = require('../services/googleSheetsService');
const { v4: uuidv4 } = require('uuid');
const db = require('../services/db');

/**
 * POST /sheets/create
 * Creates a new spreadsheet and automatically watches it.
 */
router.post('/create', async (req, res) => {
    try {
        const googleToken = req.headers['x-google-token'];
        const userId = req.user.uid;
        const authData = googleToken || userId;
        
        const title = req.body?.title || "Default Sheet";
        const headers = req.body?.headers || [];

        const newSheet = await createSpreadsheet(title, headers, authData);
        
        // Automatically watch the first sheet of the new spreadsheet
        const firstSheetTitle = newSheet.sheets[0].title;
        // The watch will now use the stored tokens for this user
        await addWatch(userId, newSheet.spreadsheetId, firstSheetTitle);

        return res.json({ success: true, data: newSheet });
    } catch (err) {
        console.error('[Sheets] create error:', err.message);
        return res.status(500).json({ error: 'Failed to create spreadsheet', detail: err.message });
    }
});

/**
 * POST /sheet/:id/append
 * Appends a row to the specified sheet.
 */
router.post('/:id/append', async (req, res) => {
    try {
        const googleToken = req.headers['x-google-token'];
        const userId = req.user?.uid;
        const authData = googleToken || userId;
        const { values } = req.body;
        const parts = decodeURIComponent(req.params.id).split('|');

        if (parts.length < 2) {
            return res.status(400).json({ error: 'Invalid sheet ID format' });
        }
        if (!values || !Array.isArray(values)) {
            return res.status(400).json({ error: 'values must be an array' });
        }

        const [spreadsheetId, ...titleParts] = parts;
        const sheetTitle = titleParts.join('|');

        const result = await appendRow(spreadsheetId, sheetTitle, values, authData);
        return res.json({ success: true, data: result });
    } catch (err) {
        console.error('[Sheets] append error:', err.message);
        return res.status(500).json({ error: 'Failed to append data', detail: err.message });
    }
});

/**
 * GET /sheet/:id/api-key
 * Generates or retrieves the unique API key for this sheet.
 */
router.get('/:id/api-key', async (req, res) => {
    try {
        const parts = decodeURIComponent(req.params.id).split('|');
        const userId = req.user.uid;
        if (parts.length < 2) return res.status(400).json({ error: 'Invalid ID' });
        
        const [spreadsheetId, ...titleParts] = parts;
        const sheetTitle = titleParts.join('|');

        // Check if watch exists and has a key
        const watchRes = await db.query(
            'SELECT api_key FROM watched_sheets WHERE user_id = $1 AND spreadsheet_id = $2 AND sheet_title = $3',
            [userId, spreadsheetId, sheetTitle]
        );

        if (watchRes.rows.length === 0) {
            return res.status(404).json({ error: 'Sheet is not being watched. Watch it first to generate an API.' });
        }

        let apiKey = watchRes.rows[0].api_key;
        if (!apiKey) {
            apiKey = uuidv4();
            await db.query(
                'UPDATE watched_sheets SET api_key = $1 WHERE user_id = $2 AND spreadsheet_id = $3 AND sheet_title = $4',
                [apiKey, userId, spreadsheetId, sheetTitle]
            );
        }

        return res.json({ success: true, apiKey });
    } catch (err) {
        console.error('[Sheets] api-key error:', err.message);
        return res.status(500).json({ error: 'Failed to handle API key', detail: err.message });
    }
});

const { addSheet } = require('../services/googleSheetsService');

/**
 * POST /sheets/:spreadsheetId/add-sheet
 * Adds a new tab (sheet) to an existing spreadsheet.
 */
router.post('/:spreadsheetId/add-sheet', async (req, res) => {
    try {
        const { spreadsheetId } = req.params;
        const { title, headers } = req.body;
        const googleToken = req.headers['x-google-token'];
        const userId = req.user?.uid;
        const authData = googleToken || userId;

        if (!title) {
            return res.status(400).json({ error: 'Sheet title is required' });
        }

        const result = await addSheet(spreadsheetId, title, headers, authData);
        return res.json({ success: true, data: result });
    } catch (err) {
        console.error('[Sheets] addSheet error:', err.message);
        return res.status(500).json({ error: 'Failed to add sheet', detail: err.message });
    }
});

module.exports = router;
