const { google } = require('googleapis');
const credentials = require('../config/credentials');
const db = require('./db');

let sheetsClient = null;

async function getSheetsClient(tokenData = null) {
    let auth;

    if (tokenData && typeof tokenData === 'object') {
        const oauth2Client = new google.auth.OAuth2(
            credentials.google.clientId,
            credentials.google.clientSecret,
            credentials.google.redirectUri
        );
        oauth2Client.setCredentials({
            access_token: tokenData.access_token,
            refresh_token: tokenData.refresh_token,
            expiry_date: tokenData.expiry_date
        });
        auth = oauth2Client;
    } else if (typeof tokenData === 'string') {
        // Legacy support for raw access token string
        const oauth2Client = new google.auth.OAuth2(
            credentials.google.clientId,
            credentials.google.clientSecret,
            credentials.google.redirectUri
        );
        oauth2Client.setCredentials({ access_token: tokenData });
        auth = oauth2Client;
    } else if (credentials.google.serviceAccountJson) {
        auth = new google.auth.GoogleAuth({
            credentials: credentials.google.serviceAccountJson,
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });
    } else if (credentials.google.serviceAccountPath) {
        auth = new google.auth.GoogleAuth({
            keyFile: credentials.google.serviceAccountPath,
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });
    } else {
        throw new Error('Google service account not configured.');
    }

    return google.sheets({ version: 'v4', auth });
}

/**
 * Get an authorized Sheets client for a specific user from stored tokens.
 * Handles auto-refresh of tokens.
 */
async function getSheetsClientByUserId(userId) {
    const res = await db.query(
        'SELECT access_token, refresh_token, token_expiry FROM watched_sheets WHERE user_id = $1 AND refresh_token IS NOT NULL LIMIT 1',
        [userId]
    );

    if (res.rows.length === 0) {
        // Fallback to service account if no user tokens found
        return getSheetsClient(null);
    }

    const { access_token, refresh_token, token_expiry } = res.rows[0];
    
    const oauth2Client = new google.auth.OAuth2(
        credentials.google.clientId,
        credentials.google.clientSecret,
        credentials.google.redirectUri
    );

    oauth2Client.setCredentials({
        access_token,
        refresh_token,
        expiry_date: token_expiry ? new Date(token_expiry).getTime() : null
    });

    // Handle token refresh events
    oauth2Client.on('tokens', async (tokens) => {
        console.log(`[Sheets] Tokens refreshed for user ${userId}`);
        const { access_token, refresh_token, expiry_date } = tokens;
        const expiryDate = expiry_date ? new Date(expiry_date) : null;

        await db.query(`
            UPDATE watched_sheets 
            SET access_token = $1, 
                refresh_token = COALESCE($2, refresh_token), 
                token_expiry = COALESCE($3, token_expiry)
            WHERE user_id = $4
        `, [access_token, refresh_token, expiryDate, userId]);
    });

    return google.sheets({ version: 'v4', auth: oauth2Client });
}

/**
 * Get an authorized Drive client.
 */
async function getDriveClientByUserId(userId) {
    const res = await db.query(
        'SELECT access_token, refresh_token, token_expiry FROM watched_sheets WHERE user_id = $1 AND refresh_token IS NOT NULL LIMIT 1',
        [userId]
    );

    let auth;
    if (res.rows.length === 0) {
        auth = new google.auth.GoogleAuth({
            credentials: credentials.google.serviceAccountJson,
            scopes: ['https://www.googleapis.com/auth/drive.readonly', 'https://www.googleapis.com/auth/drive.file'],
        });
    } else {
        const { access_token, refresh_token, token_expiry } = res.rows[0];
        const oauth2Client = new google.auth.OAuth2(
            credentials.google.clientId,
            credentials.google.clientSecret,
            credentials.google.redirectUri
        );
        oauth2Client.setCredentials({
            access_token,
            refresh_token,
            expiry_date: token_expiry ? new Date(token_expiry).getTime() : null
        });
        auth = oauth2Client;
    }

    return google.drive({ version: 'v3', auth });
}

async function getSheetsClientInternal(authData) {
    if (authData && typeof authData === 'string' && authData.length > 50) {
        // Assume it's a token
        return getSheetsClient(authData);
    } else if (authData && (typeof authData === 'string' || typeof authData === 'number')) {
        // Assume it's a userId
        return getSheetsClientByUserId(authData);
    }
    // Fallback to service account
    return getSheetsClient(null);
}

/**
 * List sheets metadata for a given spreadsheet ID.
 * Returns array of { sheetId, title, index, rowCount, columnCount }
 */
async function listSheets(spreadsheetId, authData = null) {
    const client = await getSheetsClientInternal(authData);

    console.log(`[Sheets] Fetching tabs for spreadsheet: ${spreadsheetId}`);
    const response = await client.spreadsheets.get({
        spreadsheetId,
        fields: 'properties,sheets.properties',
    });

    const spreadsheet = response.data;
    const sheets = (spreadsheet.sheets || []).map((s) => ({
        sheetId: s.properties.sheetId,
        title: s.properties.title,
        index: s.properties.index,
        rowCount: s.properties.gridProperties?.rowCount || 0,
        columnCount: s.properties.gridProperties?.columnCount || 0,
        spreadsheetId,
        spreadsheetTitle: spreadsheet.properties?.title || '',
    }));

    return sheets;
}

/**
 * Get metadata for a specific sheet (tab) in a spreadsheet.
 */
async function getSheetMeta(spreadsheetId, sheetTitle, authData = null) {
    const client = await getSheetsClientInternal(authData);

    // Fetch only a single row for headers
    const headerRes = await client.spreadsheets.values.get({
        spreadsheetId,
        range: `${sheetTitle}!1:1`,
    });

    const headers = (headerRes.data.values?.[0] || []).filter(Boolean);

    // Row count via spreadsheet properties
    const metaRes = await client.spreadsheets.get({
        spreadsheetId,
        fields: 'sheets.properties',
    });

    const sheet = metaRes.data.sheets?.find(
        (s) => s.properties.title === sheetTitle
    );

    return {
        spreadsheetId,
        sheetTitle,
        headers,
        columnCount: headers.length,
        totalRows: sheet ? sheet.properties.gridProperties?.rowCount || 0 : 0,
    };
}

/**
 * Fetch sheet data with dynamic range detection (A1:Z).
 * Returns { headers, rows, totalRows }
 */
async function getSheetData(spreadsheetId, sheetTitle, page = 1, pageSize = 50, authData = null) {
    const client = await getSheetsClientInternal(authData);

    // Dynamic range — let Sheets API determine the last column
    const fullRange = `${sheetTitle}!A1:Z`;

    const response = await client.spreadsheets.values.get({
        spreadsheetId,
        range: fullRange,
        valueRenderOption: 'UNFORMATTED_VALUE',
        dateTimeRenderOption: 'FORMATTED_STRING',
    });

    const allValues = response.data.values || [];
    if (allValues.length === 0) {
        return {
            spreadsheetId,
            sheetTitle,
            headers: [],
            rows: [],
            totalRows: 0,
            page,
            pageSize,
            totalPages: 0,
        };
    }

    const headers = allValues[0].map((h) => String(h));
    const dataRows = allValues.slice(1); // skip header row

    // Normalise rows so each has the same number of columns
    const normalised = dataRows.map((row) => {
        const padded = Array(headers.length).fill('');
        row.forEach((cell, i) => {
            if (i < headers.length) padded[i] = String(cell ?? '');
        });
        return padded;
    });

    // Pagination
    const totalRows = normalised.length;
    const startIndex = (page - 1) * pageSize;
    const endIndex = Math.min(startIndex + pageSize, totalRows);
    const pagedRows = normalised.slice(startIndex, endIndex);

    return {
        spreadsheetId,
        sheetTitle,
        headers,
        rows: pagedRows,
        totalRows,
        page,
        pageSize,
        totalPages: Math.ceil(totalRows / pageSize) || 1,
    };
}

/**
 * Create a new Google Spreadsheet.
 */
async function createSpreadsheet(title, headers = [], authData = null) {
    const client = await getSheetsClientInternal(authData);

    const resource = {
        properties: { title },
    };

    if (headers && headers.length > 0) {
        resource.sheets = [
            {
                properties: { title: 'Sheet1' },
                data: [
                    {
                        startRow: 0,
                        startColumn: 0,
                        rowData: [
                            {
                                values: headers.map((h) => ({
                                    userEnteredValue: { stringValue: h },
                                })),
                            },
                        ],
                    },
                ],
            },
        ];
    }

    const response = await client.spreadsheets.create({
        resource,
        fields: 'spreadsheetId,spreadsheetUrl,properties.title,sheets.properties',
    });

    return {
        spreadsheetId: response.data.spreadsheetId,
        spreadsheetUrl: response.data.spreadsheetUrl,
        title: response.data.properties.title,
        sheets: response.data.sheets.map((s) => ({
            sheetId: s.properties.sheetId,
            title: s.properties.title,
        })),
    };
}

/**
 * Append a row of data to a specific sheet.
 */
async function appendRow(spreadsheetId, range, values, authData = null) {
    const client = await getSheetsClientInternal(authData);

    const response = await client.spreadsheets.values.append({
        spreadsheetId,
        range,
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        resource: {
            values: [values],
        },
    });

    return response.data;
}

/**
 * Add a new sheet (tab) to an existing spreadsheet.
 */
async function addSheet(spreadsheetId, title, headers = [], authData = null) {
    const client = await getSheetsClientInternal(authData);

    // 1. Add the sheet
    const addSheetRes = await client.spreadsheets.batchUpdate({
        spreadsheetId,
        resource: {
            requests: [
                {
                    addSheet: {
                        properties: { title },
                    },
                },
            ],
        },
    });

    const newSheetId = addSheetRes.data.replies[0].addSheet.properties.sheetId;

    // 2. If headers provided, set them
    if (headers && headers.length > 0) {
        await client.spreadsheets.values.update({
            spreadsheetId,
            range: `${title}!1:1`,
            valueInputOption: 'USER_ENTERED',
            resource: {
                values: [headers],
            },
        });
    }

    return {
        spreadsheetId,
        sheetId: newSheetId,
        title,
    };
}

module.exports = {
    listSheets,
    getSheetMeta,
    getSheetData,
    createSpreadsheet,
    appendRow,
    addSheet,
    getSheetsClientByUserId,
    getDriveClientByUserId,
};
