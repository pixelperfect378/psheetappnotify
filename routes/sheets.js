const express = require('express');
const router = express.Router();
const { listSheets, getSheetMeta, getSheetData } = require('../services/googleSheetsService');
const authMiddleware = require('../middleware/authMiddleware');
const https = require('https');

// ─── Drive Sheets (no service-account auth needed — uses user's token) ────────
// ─── Routes ──────────────────────────────────────────────────────────────────
router.use((req, res, next) => {
    console.log(`[Sheets] ${req.method} ${req.url} - Headers:`, JSON.stringify(req.headers));
    next();
});

router.get('/test-health', (req, res) => res.json({ status: 'ok', serverTime: new Date() }));

/**
 * GET /drive-sheets
 * Header: x-google-token: <Google OAuth access token>
 * Returns all of the user's Google Sheets files from Drive.
 */
router.get('/drive-sheets', async (req, res) => {
    const googleToken = req.headers['x-google-token'];
    if (!googleToken) {
        return res.status(400).json({ error: 'Missing x-google-token header' });
    }

    const q = "mimeType='application/vnd.google-apps.spreadsheet'";
    const fields = "files(id,name)";
    const path = `/drive/v3/files?q=${encodeURIComponent(q)}&fields=${encodeURIComponent(fields)}&pageSize=100&orderBy=${encodeURIComponent("modifiedTime desc")}`;

    const options = {
        hostname: 'www.googleapis.com',
        path: path,
        method: 'GET',
        headers: {
            Authorization: `Bearer ${googleToken}`,
        },
    };

    let data = '';
    const driveReq = https.request(options, (driveRes) => {
        driveRes.on('data', chunk => data += chunk);
        driveRes.on('end', () => {
            try {
                const parsed = JSON.parse(data);
                if (parsed.error) {
                    console.error('[Drive API Error]', JSON.stringify(parsed.error, null, 2));
                    return res.status(401).json({ error: parsed.error.message });
                }
                return res.json({ success: true, data: parsed.files || [] });
            } catch (e) {
                return res.status(500).json({ error: 'Failed to parse Drive response' });
            }
        });
    });
    driveReq.on('error', (e) => res.status(500).json({ error: e.message }));
    driveReq.end();
});



// All sheet routes require a valid Firebase token
router.use(authMiddleware);


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
        const googleToken = req.headers['x-google-token'];
        if (!spreadsheetId) {
            return res.status(400).json({ error: 'spreadsheetId query parameter is required' });
        }

        const sheets = await listSheets(spreadsheetId, googleToken);
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
        const googleToken = req.headers['x-google-token'];
        if (parts.length < 2) {
            return res.status(400).json({
                error: 'id must be URL-encoded "spreadsheetId|sheetTitle"',
            });
        }
        const [spreadsheetId, ...titleParts] = parts;
        const sheetTitle = titleParts.join('|');

        const page = Math.max(1, parseInt(req.query.page || '1', 10));
        const pageSize = Math.min(200, Math.max(1, parseInt(req.query.pageSize || '50', 10)));

        const data = await getSheetData(spreadsheetId, sheetTitle, page, pageSize, googleToken);
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
        const googleToken = req.headers['x-google-token'];
        if (!googleToken) {
            return res.status(400).json({ error: 'Missing x-google-token header' });
        }
        if (parts.length < 2) {
            return res.status(400).json({ error: 'id must be "spreadsheetId|sheetTitle"' });
        }
        const [spreadsheetId, ...titleParts] = parts;
        const sheetTitle = titleParts.join('|');

        const meta = await getSheetMeta(spreadsheetId, sheetTitle, googleToken);
        return res.json({ success: true, data: meta });
    } catch (err) {
        console.error('[Sheets] getSheetMeta error:', err.message);
        return res.status(500).json({ error: 'Failed to fetch sheet metadata', detail: err.message });
    }
});

module.exports = router;
