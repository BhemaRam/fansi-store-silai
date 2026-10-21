const SPREADSHEET_ID = '1HZEAzlC-BTdwzvGIEhsvE_y4UOeC0Ec97TuzfpM-5WE';
const SHEETS = {
  Products: ['id','name','sku','category','quantity','purchasePrice','sellingPrice','updatedAt','deleted'],
  Purchases: ['id','supplier','invoiceNo','date','total','paymentStatus','updatedAt','deleted'],
  Sales: ['id','billNo','customerId','date','itemsJson','subtotal','discount','total','paid','paymentStatus','updatedAt','deleted'],
  Tailoring_Orders: ['id','orderNo','customerId','customerName','phone','measurementsJson','itemsJson','orderDate','deliveryDate','amount','paid','status','notes','updatedAt','deleted'],
  Customers: ['id','name','phone','address','openingBalance','updatedAt','deleted'],
  Payments: ['id','customerId','referenceId','date','amount','method','notes','updatedAt','deleted'],
  Expenses: ['id','date','category','description','amount','paidBy','updatedAt','deleted'],
  Staff: ['id','name','phone','role','active','updatedAt','deleted'],
  Sync_Log: ['id','recordType','recordId','action','timestamp','status']
};

function doGet() {
  // Health check only. Do not expose sheet data through unauthenticated GET.
  return jsonOutput({ok:true, service:'Fansi Store Management API', message:'API running. Authenticated POST required.'});
}
function doPost(e) {
  const lock=LockService.getScriptLock();
  try {
    const body=JSON.parse((e&&e.postData&&e.postData.contents)||'{}');
    const expectedToken=PropertiesService.getScriptProperties().getProperty('API_TOKEN');
    if(!expectedToken || !body.token || body.token!==expectedToken)
      return jsonOutput({ok:false,error:'Unauthorized'});
    if(body.action==='pull') return jsonOutput(pullRecords_(body));
    const records=Array.isArray(body.records)?body.records:[];
    if(records.length>200) return jsonOutput({ok:false,error:'Maximum 200 records per request'});
    lock.waitLock(20000);
    const results=records.map(record=>{
      try{return upsertRecord_(record);}
      catch(err){return {ok:false,id:record&&record.id,error:String(err.message||err)};}
    });
    return jsonOutput({ok:results.every(r=>r.ok),results});
  } catch(err) {
    return jsonOutput({ok:false,error:String(err.message||err)});
  } finally { if(lock.hasLock()) lock.releaseLock(); }
}
function setupSheets() {
  const ss=SpreadsheetApp.openById(SPREADSHEET_ID);
  Object.keys(SHEETS).forEach(name=>{
    let sheet=ss.getSheetByName(name); if(!sheet)sheet=ss.insertSheet(name);
    const headers=SHEETS[name];
    if(sheet.getLastRow()===0){sheet.getRange(1,1,1,headers.length).setValues([headers]);sheet.setFrozenRows(1);}
    else {
      const existing=sheet.getRange(1,1,1,sheet.getLastColumn()).getDisplayValues()[0];
      if(existing.join('|')!==headers.join('|'))throw new Error('Header mismatch in "'+name+'". Check row 1.');
    }
  });
  return 'Setup complete';
}
function upsertRecord_(record) {
  if(!record||!record.id||!record.type||!record.data)throw new Error('Each record needs type, id and data');
  const type=String(record.type);
  if(!Object.prototype.hasOwnProperty.call(SHEETS,type)||type==='Sync_Log')throw new Error('Unsupported record type: '+type);
  const data=record.data;
  if(String(data.id)!==String(record.id))throw new Error('Record ID mismatch');
  const sheet=SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(type);
  const headers=SHEETS[type];
  const rowValues=headers.map(header=>{
    const value=data[header];
    if(value===undefined||value===null)return '';
    if(typeof value==='object')return JSON.stringify(value);
    // Avoid writing user-entered values as spreadsheet formulas.
    if(typeof value==='string' && /^[=+\-@]/.test(value))return "'"+value;
    return value;
  });
  const lastRow=sheet.getLastRow();let existingRow=0;
  if(lastRow>=2){
    const ids=sheet.getRange(2,1,lastRow-1,1).getDisplayValues();
    for(let i=0;i<ids.length;i++){if(ids[i][0]===String(record.id)){existingRow=i+2;break;}}
  }
  if(existingRow){
    const updatedCol=headers.indexOf('updatedAt')+1;
    if(updatedCol>0){
      const oldValue=sheet.getRange(existingRow,updatedCol).getValue();
      const oldTime=oldValue?new Date(oldValue).getTime():0;
      const newTime=data.updatedAt?new Date(data.updatedAt).getTime():0;
      if(oldTime>newTime)return {ok:true,id:record.id,status:'kept-newer-server-record'};
    }
    sheet.getRange(existingRow,1,1,headers.length).setValues([rowValues]);
  } else sheet.appendRow(rowValues);
  logSync_(type,record.id,existingRow?'update':'insert');
  return {ok:true,id:record.id,status:existingRow?'updated':'inserted'};
}
function pullRecords_(params) {
  const type=String(params.type||'');
  if(!Object.prototype.hasOwnProperty.call(SHEETS,type)||type==='Sync_Log')throw new Error('Provide a valid type parameter');
  const sheet=SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(type);
  const lastRow=sheet.getLastRow();if(lastRow<2)return {ok:true,records:[]};
  const headers=SHEETS[type];
  const rows=sheet.getRange(2,1,lastRow-1,headers.length).getValues();
  const since=params.since?new Date(params.since).getTime():0;
  const records=rows.map(row=>{
    const data={};headers.forEach((header,i)=>data[header]=row[i]);return data;
  }).filter(data=>{
    const updated=data.updatedAt?new Date(data.updatedAt).getTime():0;
    return updated>=since;
  });
  return {ok:true,records};
}
function logSync_(type,id,action) {
  SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName('Sync_Log').appendRow([
    Utilities.getUuid(),type,id,action,new Date().toISOString(),'success'
  ]);
}
function jsonOutput(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}
