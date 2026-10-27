# Fansi Store + Silai (Google Sheets sync, Owner/Staff login)

## Setup (ek baar)
1. Google Sheet ka backup/copy rakhein. Sheet ID `AppsScript_Code.gs` me `SPREADSHEET_ID` me check karein.
2. Apps Script me poora `AppsScript_Code.gs` paste karein.
3. Project Settings > Script Properties me do values add karein:
   - `OWNER_PIN` = 6+ digit PIN (sirf malik ke liye)
   - `STAFF_PIN` = alag 6+ digit PIN (staff ke liye)
4. Editor me `setupSheets` run karein (permission allow karein). Isse tabs + headers ban jaate hain (ya `Fansi_Store_Management_fixed.xlsx` wale ready headers verify hote hain). Purane khaali `Purchases`/`Staff` tabs delete kar sakte hain.
5. Deploy > New deployment > Web app: Execute as **Me**, Who has access **Anyone**. Web App URL copy karein.
   (Code badalne par: Manage deployments > Edit > New version > Deploy. URL wahi rahega.)
6. Folder ko HTTPS par host karein (Netlify / Cloudflare Pages / GitHub Pages: sab free).
7. Phone par link kholein, URL + PIN daal kar login karein.
   - Android: Chrome > menu > Install app / Add to Home screen
   - iPhone: Safari > Share > Add to Home Screen

## Kaise sync hota hai
- Entry pehle phone me save (offline bhi), queue me jaati hai.
- Online hote hi (aur har 45 sec) queue Sheet me jaati hai, phir naye changes Sheet se aate hain.
- Stock "delta" se badalta hai (Stock_Moves tab), isliye 2 phone ki sale mil kar sahi stock deti hai.
- Server har record par apna time (updatedAt) lagata hai; sync sirf naye changes pull karta hai.

## Roles
- Owner: sab kuch + Expenses + Reports + Delete (stock item).
- Staff: stock, sales, silai, khata. Expenses/Reports nahi dikhte, delete nahi kar sakta.

## Dhyan rakhein
- Sheet ke `Stock_Moves` aur `Products.quantity` ko manually mat badlein (stock galat ho sakta hai).
- Sheet me manual edit karna ho to `updatedAt` column me abhi ka ISO time daalein, warna phones tak change nahi pahunchega.
- Same record ko do phone par ek saath edit karenge to aakhri sync jeetega.
- Abhi delete sirf stock item ke liye hai.
- Backup: Settings se JSON export + Google Sheet ki copy regular lein.
