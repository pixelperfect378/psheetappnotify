const express = require('express');
const router = express.Router();
const db = require('../services/db');
const { appendRow, getSheetData } = require('../services/googleSheetsService');

/**
 * POST /api/v1/s/:apiKey
 * Public endpoint to insert data into a sheet using its API key.
 * Expected body: { "values": [val1, val2, ...] } or { "data": { "col1": "val1", ... } }
 */
router.post('/s/:apiKey', async (req, res) => {
    try {
        const { apiKey } = req.params;
        const { values, data } = req.body;

        // Find the sheet and owner tokens by API key
        const watchRes = await db.query(
            'SELECT * FROM watched_sheets WHERE api_key = $1',
            [apiKey]
        );

        if (watchRes.rows.length === 0) {
            return res.status(404).json({ error: 'Invalid API key' });
        }

        const watch = watchRes.rows[0];
        const tokenData = {
            access_token: watch.access_token,
            refresh_token: watch.refresh_token,
            expiry_date: watch.token_expiry ? new Date(watch.token_expiry).getTime() : null
        };

        let valuesToInsert = values;

        // If data object is provided, we need to map it to headers
        if (data && !values) {
            const meta = await getSheetData(watch.spreadsheet_id, watch.sheet_title, 1, 1, tokenData);
            const headers = meta.headers;
            valuesToInsert = headers.map(h => data[h] || '');
        }

        if (!valuesToInsert || !Array.isArray(valuesToInsert)) {
            return res.status(400).json({ error: 'values (array) or data (object) is required' });
        }

        const result = await appendRow(watch.spreadsheet_id, watch.sheet_title, valuesToInsert, tokenData);
        
        return res.json({ 
            success: true, 
            message: 'Data inserted successfully',
            spreadsheetId: watch.spreadsheet_id,
            sheetTitle: watch.sheet_title
        });
    } catch (err) {
        console.error('[PublicAPI] Error:', err.message);
        return res.status(500).json({ error: 'Failed to insert data', detail: err.message });
    }
});

/**
 * GET /api/v1/s/:apiKey
 * Public endpoint to fetch data from a sheet.
 */
router.get('/s/:apiKey', async (req, res) => {
    try {
        const { apiKey } = req.params;
        const page = parseInt(req.query.page || '1', 10);
        const pageSize = parseInt(req.query.pageSize || '50', 10);

        const watchRes = await db.query(
            'SELECT * FROM watched_sheets WHERE api_key = $1',
            [apiKey]
        );

        if (watchRes.rows.length === 0) {
            return res.status(404).json({ error: 'Invalid API key' });
        }

        const watch = watchRes.rows[0];
        const tokenData = {
            access_token: watch.access_token,
            refresh_token: watch.refresh_token,
            expiry_date: watch.token_expiry ? new Date(watch.token_expiry).getTime() : null
        };

        const data = await getSheetData(watch.spreadsheet_id, watch.sheet_title, page, pageSize, tokenData);
        return res.json({ success: true, data });
    } catch (err) {
        console.error('[PublicAPI] Fetch Error:', err.message);
        return res.status(500).json({ error: 'Failed to fetch data', detail: err.message });
    }
});

module.exports = router;
