const { getSheetMeta, getSheetData } = require('./googleSheetsService');
const { getTokensForUser } = require('./tokenStore');
const { sendMulticast } = require('./firebaseService');
const db = require('./db');

/**
 * Add a sheet to the watch list.
 * @param {string} userId 
 * @param {string} spreadsheetId 
 * @param {string} sheetTitle 
 * @param {object} tokenData - { access_token, refresh_token, expiry_date }
 */
async function addWatch(userId, spreadsheetId, sheetTitle, tokenData = {}) {
    try {
        // Get initial row count using the provided token
        const meta = await getSheetMeta(spreadsheetId, sheetTitle, tokenData.access_token);
        
        const tokenExpiry = tokenData.expiry_date ? new Date(tokenData.expiry_date) : null;

        const res = await db.query(
            `INSERT INTO watched_sheets 
             (user_id, spreadsheet_id, sheet_title, last_row_count, access_token, refresh_token, token_expiry)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT (user_id, spreadsheet_id, sheet_title) 
             DO UPDATE SET 
                last_row_count = EXCLUDED.last_row_count, 
                access_token = EXCLUDED.access_token,
                refresh_token = COALESCE(EXCLUDED.refresh_token, watched_sheets.refresh_token),
                token_expiry = EXCLUDED.token_expiry,
                last_check = CURRENT_TIMESTAMP
             RETURNING *`,
            [userId, spreadsheetId, sheetTitle, meta.totalRows, tokenData.access_token, tokenData.refresh_token, tokenExpiry]
        );
        
        console.log(`[Watcher] Added/Updated watch for user ${userId}: ${sheetTitle}`);
        return res.rows[0];
    } catch (err) {
        console.error(`[Watcher] Failed to add watch for ${spreadsheetId}:`, err.message);
        throw err;
    }
}

/**
 * Remove a sheet from the watch list.
 */
async function removeWatch(userId, spreadsheetId, sheetTitle) {
    try {
        await db.query(
            'DELETE FROM watched_sheets WHERE user_id = $1 AND spreadsheet_id = $2 AND sheet_title = $3',
            [userId, spreadsheetId, sheetTitle]
        );
        console.log(`[Watcher] Removed watch for user ${userId}: ${sheetTitle}`);
    } catch (err) {
        console.error('[Watcher] Failed to remove watch:', err.message);
    }
}

/**
 * Main polling function to check all watched sheets.
 */
async function checkSheets() {
    try {
        const res = await db.query('SELECT * FROM watched_sheets');
        const watchedSheets = res.rows;
        
        if (watchedSheets.length === 0) return;
        
        console.log(`[Watcher] Checking ${watchedSheets.length} sheets for updates...`);
        
        for (const watch of watchedSheets) {
            try {
                // Pass the stored tokens (access, refresh, expiry) to the service
                const tokenData = {
                    access_token: watch.access_token,
                    refresh_token: watch.refresh_token,
                    expiry_date: watch.token_expiry ? new Date(watch.token_expiry).getTime() : null
                };

                const meta = await getSheetMeta(watch.spreadsheet_id, watch.sheet_title, tokenData);

                if (meta.totalRows > watch.last_row_count) {
                    console.log(`[Watcher] New rows detected in ${watch.sheet_title} (${watch.spreadsheet_id})`);

                    const newlyAddedCount = meta.totalRows - watch.last_row_count;

                    // Update watch state in DB
                    await db.query(
                        'UPDATE watched_sheets SET last_row_count = $1, last_check = CURRENT_TIMESTAMP WHERE id = $2',
                        [meta.totalRows, watch.id]
                    );

                    // Send notifications
                    const tokens = await getTokensForUser(watch.user_id);
                    if (tokens.length > 0) {
                        await sendMulticast(tokens, {
                            title: `New Entry in ${watch.sheet_title}`,
                            body: `Added ${newlyAddedCount} new row(s).`,
                        }, {
                            sheetId: watch.spreadsheet_id,
                            sheetName: watch.sheet_title,
                            type: 'SHEET_UPDATE',
                        });
                    }
                } else {
                    await db.query('UPDATE watched_sheets SET last_check = CURRENT_TIMESTAMP WHERE id = $1', [watch.id]);
                }
            } catch (err) {
                console.error(`[Watcher] Error checking sheet ${watch.spreadsheet_id}:`, err.message);
            }
        }
    } catch (err) {
        console.error('[Watcher] Global check error:', err.message);
    }
}

// Start polling every minute
let intervalId = null;
function startWatching(intervalMs = 60000) {
    if (intervalId) return;
    intervalId = setInterval(checkSheets, intervalMs);
    console.log(`[Watcher] Started polling service (Interval: ${intervalMs}ms)`);
}

function stopWatching() {
    if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
    }
}

module.exports = { addWatch, removeWatch, startWatching, stopWatching };
