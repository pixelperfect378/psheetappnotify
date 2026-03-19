const { getSheetMeta, getSheetData } = require('./googleSheetsService');
const { getTokensForUser } = require('./tokenStore');
const { sendMulticast } = require('./firebaseService');
const db = require('./db');

/**
 * Add a sheet to the watch list.
 * @param {string} userId 
 * @param {string} spreadsheetId 
 * @param {string} sheetTitle 
 */
async function addWatch(userId, spreadsheetId, sheetTitle) {
    try {
        // Get initial row count
        const meta = await getSheetMeta(spreadsheetId, sheetTitle);
        
        const res = await db.query(
            `INSERT INTO watched_sheets (user_id, spreadsheet_id, sheet_title, last_row_count)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (user_id, spreadsheet_id, sheet_title) 
             DO UPDATE SET last_row_count = EXCLUDED.last_row_count, last_check = CURRENT_TIMESTAMP
             RETURNING *`,
            [userId, spreadsheetId, sheetTitle, meta.totalRows]
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
                // Note: In a real production app, we'd need a stored Google Token for the user
                // or use the service account if the sheet is shared with it.
                // For now, we attempt with service account (default in getSheetMeta if no token provided).
                const meta = await getSheetMeta(watch.spreadsheet_id, watch.sheet_title);

                if (meta.total_rows > watch.last_row_count) {
                    console.log(`[Watcher] New rows detected in ${watch.sheet_title} (${watch.spreadsheet_id})`);

                    const newlyAddedCount = meta.total_rows - watch.last_row_count;

                    // Update watch state in DB
                    await db.query(
                        'UPDATE watched_sheets SET last_row_count = $1, last_check = CURRENT_TIMESTAMP WHERE id = $2',
                        [meta.total_rows, watch.id]
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
