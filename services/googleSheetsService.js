const { google } = require('googleapis');
const credentials = require('../config/credentials');

let sheetsClient = null;

async function getSheetsClient(googleToken = null) {
    let auth;

    if (googleToken) {
        // Use user's OAuth access token
        const oauth2Client = new google.auth.OAuth2();
        oauth2Client.setCredentials({ access_token: googleToken });
        auth = oauth2Client;
    } else if (credentials.google.serviceAccountJson) {
        auth = new google.auth.GoogleAuth({
            credentials: credentials.google.serviceAccountJson,
            scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
        });
    } else if (credentials.google.serviceAccountPath) {
        auth = new google.auth.GoogleAuth({
            keyFile: credentials.google.serviceAccountPath,
            scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
        });
    } else {
        throw new Error('Google service account not configured.');
    }

    return google.sheets({ version: 'v4', auth });
}

/**
 * List sheets metadata for a given spreadsheet ID.
 * Returns array of { sheetId, title, index, rowCount, columnCount }
 */
async function listSheets(spreadsheetId, googleToken = null) {
    const client = await getSheetsClient(googleToken);

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
async function getSheetMeta(spreadsheetId, sheetTitle, googleToken = null) {
    const client = await getSheetsClient(googleToken);

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
async function getSheetData(spreadsheetId, sheetTitle, page = 1, pageSize = 50, googleToken = null) {
    const client = await getSheetsClient(googleToken);

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

module.exports = { listSheets, getSheetMeta, getSheetData };
