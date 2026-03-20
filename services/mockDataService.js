const { v4: uuidv4 } = require('uuid');

// In-memory store for mock data appended during the session
// Format: { "spreadsheetId|sheetTitle": [ [row1], [row2] ] }
const mockStorage = new Map();

const DEFAULT_MOCK_SHEETS = [
    { id: 'mock-psheet-sales', name: '📊 PSheet Sales Demo' },
    { id: 'mock-psheet-inventory', name: '📦 Inventory Tracker (Mock)' },
    { id: 'mock-psheet-leads', name: '🎯 Marketing Leads (Demo)' }
];

const MOCK_TABS = {
    'mock-psheet-sales': [
        { sheetId: 0, title: 'Revenue', index: 0, rowCount: 1000, columnCount: 5, spreadsheetId: 'mock-psheet-sales', spreadsheetTitle: '📊 PSheet Sales Demo' },
        { sheetId: 1, title: 'Expenses', index: 1, rowCount: 1000, columnCount: 4, spreadsheetId: 'mock-psheet-sales', spreadsheetTitle: '📊 PSheet Sales Demo' }
    ],
    'mock-psheet-inventory': [
        { sheetId: 0, title: 'Stock', index: 0, rowCount: 1000, columnCount: 6, spreadsheetId: 'mock-psheet-sales', spreadsheetTitle: '📦 Inventory Tracker (Mock)' }
    ],
    'mock-psheet-leads': [
        { sheetId: 0, title: 'Qualified Leads', index: 0, rowCount: 1000, columnCount: 5, spreadsheetId: 'mock-psheet-sales', spreadsheetTitle: '🎯 Marketing Leads (Demo)' }
    ]
};

const MOCK_DATA = {
    'mock-psheet-sales|Revenue': {
        headers: ['Date', 'Product', 'Amount', 'Customer', 'Status'],
        rows: [
            ['2024-03-20', 'PSheet Premium', '$99.00', 'John Doe', 'Paid'],
            ['2024-03-19', 'API Integration Bundle', '$149.00', 'Jane Smith', 'Pending'],
            ['2024-03-18', 'Custom Alerts Setup', '$49.00', 'Bob Wilson', 'Paid']
        ]
    },
    'mock-psheet-inventory|Stock': {
        headers: ['Item ID', 'Name', 'Category', 'Quantity', 'Reorder Level', 'Supplier'],
        rows: [
            ['ITM-001', 'MacBook Pro', 'Electronics', '15', '5', 'Apple Inc'],
            ['ITM-002', 'Dell Monitor', 'Electronics', '30', '10', 'Dell Technologies']
        ]
    }
};

/**
 * Checks if a spreadsheetId is a mock ID.
 */
function isMock(id) {
    return id && String(id).startsWith('mock-');
}

async function listMockDriveSheets() {
    return DEFAULT_MOCK_SHEETS;
}

async function listMockTabs(spreadsheetId) {
    return MOCK_TABS[spreadsheetId] || [];
}

async function getMockSheetData(spreadsheetId, sheetTitle, page = 1, pageSize = 50) {
    const key = `${spreadsheetId}|${sheetTitle}`;
    const base = MOCK_DATA[key] || { headers: ['Column 1', 'Column 2'], rows: [] };
    
    // Combine base data with appended storage
    const stored = mockStorage.get(key) || [];
    const allRows = [...base.rows, ...stored];
    
    const totalRows = allRows.length;
    const startIndex = (page - 1) * pageSize;
    const endIndex = Math.min(startIndex + pageSize, totalRows);
    const pagedRows = allRows.slice(startIndex, endIndex);

    return {
        spreadsheetId,
        sheetTitle,
        headers: base.headers,
        rows: pagedRows,
        totalRows,
        page,
        pageSize,
        totalPages: Math.ceil(totalRows / pageSize) || 1
    };
}

async function appendMockRow(spreadsheetId, sheetTitle, values) {
    const key = `${spreadsheetId}|${sheetTitle}`;
    if (!mockStorage.has(key)) {
        mockStorage.set(key, []);
    }
    mockStorage.get(key).push(values);
    return { success: true, updatedRange: `${sheetTitle}!A${(MOCK_DATA[key]?.rows.length || 0) + mockStorage.get(key).length}` };
}

module.exports = {
    isMock,
    listMockDriveSheets,
    listMockTabs,
    getMockSheetData,
    appendMockRow
};
