const fs = require('fs');
const path = require('path');
const { getSheetData, getSheetMeta } = require('./googleSheetsService');
const { getAllTokens, getTokensForUser } = require('./tokenStore');
const { sendMulticast } = require('./firebaseService');

const WATCH_FILE = path.join(__dirname, '../data/watched_sheets.json');

// Ensure data directory exists
const dataDir = path.dirname(WATCH_FILE);
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

let watchedSheets = []; // Array of { userId, spreadsheetId, sheetTitle, lastRowCount, lastCheck }

function loadWatchedSheets() {
    try {
        if (fs.existsSync(WATCH_FILE)) {
            watchedSheets = JSON.parse(fs.readFileSync(WATCH_FILE, 'utf8'));
            console.log(`[Watcher] Loaded ${watchedSheets.length} watched sheets`);
        }
    } catch (err) {
        console.error('[Watcher] Failed to load watched sheets:', err.message);
    }
}

function saveWatchedSheets() {
    try {
        fs.writeFileSync(WATCH_FILE, JSON.stringify(watchedSheets, null, 2));
    } catch (err) {
        console.error('[Watcher] Failed to save watched sheets:', err.message);
    }
}

loadWatchedSheets();

async function addWatch(userId, spreadsheetId, sheetTitle) {
    const existing = watchedSheets.find(
        (s) => s.userId === userId && s.spreadsheetId === spreadsheetId && s.sheetTitle === sheetTitle
    );

    if (existing) return existing;

    // Get initial row count
    try {
        const meta = await getSheetMeta(spreadsheetId, sheetTitle);
        const newWatch = {
            userId,
            spreadsheetId,
            sheetTitle,
            lastRowCount: meta.totalRows,
            lastCheck: Date.now(),
        };
        watchedSheets.push(newWatch);
        saveWatchedSheets();
        return newWatch;
    } catch (err) {
        console.error(`[Watcher] Failed to add watch for ${spreadsheetId}:`, err.message);
        throw err;
    }
}

async function removeWatch(userId, spreadsheetId, sheetTitle) {
    watchedSheets = watchedSheets.filter(
        (s) => !(s.userId === userId && s.spreadsheetId === spreadsheetId && s.sheetTitle === sheetTitle)
    );
    saveWatchedSheets();
}

async function checkSheets() {
    console.log(`[Watcher] Checking ${watchedSheets.length} sheets for updates...`);
    for (const watch of watchedSheets) {
        try {
            const meta = await getSheetMeta(watch.spreadsheetId, watch.sheetTitle);

            if (meta.totalRows > watch.lastRowCount) {
                console.log(`[Watcher] New rows detected in ${watch.sheetTitle} (${watch.spreadsheetId})`);

                // Fetch new rows (last ones)
                const data = await getSheetData(watch.spreadsheetId, watch.sheetTitle, 1, 10); // Check recent rows
                // Assuming new rows are at the end, but Google Sheets can be tricky.
                // Simple logic: if row count increased, get the last row.
                const newRowCount = meta.totalRows;
                const newlyAddedCount = newRowCount - watch.lastRowCount;

                // Update watch state
                watch.lastRowCount = newRowCount;
                watch.lastCheck = Date.now();
                saveWatchedSheets();

                // Send notifications
                const tokens = getTokensForUser(watch.userId);
                if (tokens.length > 0) {
                    await sendMulticast(tokens, {
                        title: `New Entry in ${watch.sheetTitle}`,
                        body: `Added ${newlyAddedCount} new row(s).`,
                    }, {
                        sheetId: watch.spreadsheetId,
                        sheetName: watch.sheetTitle,
                        type: 'SHEET_UPDATE',
                    });
                }
            } else {
                watch.lastCheck = Date.now();
            }
        } catch (err) {
            console.error(`[Watcher] Error checking sheet ${watch.spreadsheetId}:`, err.message);
        }
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
