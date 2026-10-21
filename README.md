# Fansi Store + Silai MVP — Google Sheets integration (experimental)

## What changed
- Keeps IndexedDB local-first entry storage and its pending sync queue.
- Adds Google Apps Script URL + API token fields under Settings & Sync.
- Adds an experimental Google Sheets sync adapter for Products, Sales, Tailoring Orders, Customers, Payments and Expenses.
- Includes `AppsScript_Code.gs`, a server version where both pull and write require `API_TOKEN`.

## Important limitations
1. This is an integration prototype, not production-ready accounting software.
2. The API token entered in browser settings is visible to anyone using that browser/devtools. Do not use this shared-token design for real customer/payment data or a public staff app.
3. Google Apps Script ContentService redirects and browser CORS restrictions can prevent direct `fetch()` calls from a separately hosted PWA. If the app reports a CORS/network error, use a small authenticated server-side proxy or host the UI in a compatible architecture; do not disable browser security.
4. This prototype uses last-updated timestamp comparison, not full conflict resolution. Google Sheet edits are pulled on manual/online sync; do not edit the same record on two devices simultaneously until conflict rules are improved.
5. Sheet schema mapping is basic. Existing rows should be backed up before testing. Test only with dummy records first.
6. Service-worker offline caching works only when served from HTTPS (or localhost). Opening `index.html` as a file is not supported.

## Setup
1. Make a backup copy of the Google Sheet and export the app's local data if you have already entered anything.
2. In Apps Script, set Script Property `API_TOKEN` to a long random value. Never put that value in chat.
3. Replace the current Apps Script code with `AppsScript_Code.gs` contents. Confirm `SPREADSHEET_ID` is your sheet ID.
4. Run `setupSheets()` once from the editor. If it reports a header mismatch, stop and check the first row instead of deleting data.
5. Deploy > Manage deployments > Edit the Web App deployment > select a new version > Deploy. Keep the deployment restricted where your usage allows. The current “Anyone” setting is not recommended for sensitive business records.
6. Host the PWA on HTTPS.
7. Open Settings & Sync in the app, paste the Web App URL and the same API token, and save.
8. Use only dummy data. Create a test product, press Sync now, and check the `Products` tab. Then test pull on a second browser/device. If a CORS/network error occurs, direct browser-to-Apps-Script calls are blocked in this deployment and a backend proxy is needed.
9. Test offline: open the hosted app once while online, then go offline and add a dummy entry. It should stay in IndexedDB and show pending sync. Reconnect and press Sync now. Verify the sheet has exactly one row for that ID.

## Supported local-to-sheet mapping
- `products` -> `Products`
- `sales` -> `Sales`
- `tailoring` -> `Tailoring_Orders`
- `customers` -> `Customers`
- `payments` -> `Payments`
- `expenses` -> `Expenses`

The MVP currently does not fully implement authentication or owner/staff/karigar role permissions. Do not use it as the sole accounting record until security, backups, conflict handling and end-to-end sync have been verified.
