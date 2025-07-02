const express = require('express');
const { google } = require('googleapis');
const { OpenAI } = require('openai');

const app = express();
app.use(express.json());

// --- CONFIGURATION ---
const SPREADSHEET_ID = 'https://docs.google.com/spreadsheets/d/1Y00IU8KxRe-sTSmMyAAErFfL_dVd891vpvOXWfX_5A0/edit?gid=0#gid=0'; // Find this in your Google Sheet URL
const SHEET_NAME = 'Sheet1';

// --- AUTHENTICATION (Follow these steps carefully) ---
// 1. Go to https://console.cloud.google.com/
// 2. Create a new project.
// 3. Go to "APIs & Services" -> "Enabled APIs & services". Click "+ ENABLE APIS AND SERVICES".
// 4. Search for "Google Sheets API" and "Google Drive API" and enable both.
// 5. Go to "APIs & Services" -> "Credentials".
// 6. Click "+ CREATE CREDENTIALS" -> "Service Account".
// 7. Give it a name (e.g., "sheets-writer"), click "Create and Continue", then "Done".
// 8. On the Credentials page, find your new service account and click on it.
// 9. Go to the "KEYS" tab. Click "ADD KEY" -> "Create new key". Choose "JSON" and create it.
//    A JSON file will be downloaded. This is your credentials file.
// 10. **IMPORTANT:** Open your Google Sheet, click "Share", and share it with the `client_email` found inside your downloaded JSON file. Give it "Editor" access.
//
// To deploy, you will set these environment variables in Vercel, not here.
const credentials = {
  "type": "service_account",
  "project_id": process.env.GOOGLE_PROJECT_ID,
  "private_key_id": process.env.GOOGLE_PRIVATE_KEY_ID,
  "private_key": process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'), // Vercel needs this replace
  "client_email": process.env.GOOGLE_CLIENT_EMAIL,
  "client_id": process.env.GOOGLE_CLIENT_ID,
  "auth_uri": "https://accounts.google.com/o/oauth2/auth",
  "token_uri": "https://oauth2.googleapis.com/token",
  "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
  "client_x509_cert_url": process.env.GOOGLE_CLIENT_X509_CERT_URL
};

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

// Set up Google Sheets client
const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const sheets = google.sheets({ version: 'v4', auth });


// --- API ROUTES ---

// This handles ALL requests. We check the 'action' in the body.
app.post('/api', async (req, res) => {
  // Add CORS headers to allow requests from your extension
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle pre-flight requests for CORS
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { action, data } = req.body;

  try {
    if (action === 'saveDocument') {
      const result = await saveDocument(data);
      res.json(result);
    } else if (action === 'searchDocuments') {
      const result = await searchDocuments(data.query);
      res.json(result);
    } else {
      res.status(400).json({ status: 'error', message: 'Invalid action' });
    }
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
});

// --- HELPER FUNCTIONS ---

async function saveDocument(data) {
  const { url, title, content } = data;
  const tags = await getTagsFromOpenAI(content);
  if (tags.status === 'error') return tags;

  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A:D`,
    valueInputOption: 'USER_ENTERED',
    resource: {
      values: [[new Date(), url, title, tags]],
    },
  });
  return { status: 'success', message: 'Document saved!', tags };
}

async function searchDocuments(query) {
    const response = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: SHEET_NAME,
    });
    const data = response.data.values || [];
    const results = [];
    const lowerCaseQuery = query.toLowerCase();

    for (let i = 1; i < data.length; i++) {
        const rowTitle = data[i][2] ? data[i][2].toLowerCase() : '';
        const rowTags = data[i][3] ? data[i][3].toLowerCase() : '';
        if (rowTitle.includes(lowerCaseQuery) || rowTags.includes(lowerCaseQuery)) {
            results.push({ url: data[i][1], title: data[i][2], tags: data[i][3] });
        }
    }
    return { status: 'success', results: results.slice(0, 50) };
}

async function getTagsFromOpenAI(textContent) {
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [{ role: 'user', content: `Generate 5-10 comma-separated keywords for: "${textContent.substring(0, 2000)}"` }],
    });
    return completion.choices[0].message.content.trim();
  } catch (error) {
    return { status: 'error', message: `OpenAI Error: ${error.message}` };
  }
}

// Export the app for Vercel
module.exports = app;