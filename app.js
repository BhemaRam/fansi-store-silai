/* Fansi Store + Silai MVP
   Offline-first local database: IndexedDB. Cloud sync: optional Supabase.
   Configure Supabase in Settings before using cross-device sync.
*/
const DB_NAME = "fansi-silai-db";
const DB_VERSION = 1;
const STORES = ["products","sales","tailoring","customers","expenses","payments","suppliers","syncQueue","settings"];
const $ = (s, root=document) => root.querySelector(s);
const $$ = (s, root=document) => [...root.querySelectorAll(s)];
const rupees = n => new Intl.NumberFormat("en-IN",{style:"currency",currency:"INR",maximumFractionDigits:2}).format(Number(n)||0);
const today = () => new Date().toISOString().slice(0,10);
const uid = () => crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
let db, activeView = "dashboard", activeFormType = "", toastTimer;
let supabaseClient = null;
let sheetsSyncBusy = false;
let searchTerm = "";

function openDB(){
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open(DB_NAME,DB_VERSION);
    req.onupgradeneeded=()=>{
      const d=req.result;
      for(const name of STORES) if(!d.objectStoreNames.contains(name)) d.createObjectStore(name,{keyPath:"id"});
    };
    req.onsuccess=()=>resolve(req.result); req.onerror=()=>reject(req.error);
  });
}
function all(store){
  return new Promise((resolve,reject)=>{const r=db.transaction(store,"readonly").objectStore(store).getAll();r.onsuccess=()=>resolve(r.result||[]);r.onerror=()=>reject(r.error);});
}
function get(store,id){
  return new Promise((resolve,reject)=>{const r=db.transaction(store,"readonly").objectStore(store).get(id);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
}
function put(store,value){
  return new Promise((resolve,reject)=>{const tx=db.transaction(store,"readwrite");tx.objectStore(store).put(value);tx.oncomplete=()=>resolve(value);tx.onerror=()=>reject(tx.error);});
}
function remove(store,id){
  return new Promise((resolve,reject)=>{const tx=db.transaction(store,"readwrite");tx.objectStore(store).delete(id);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});
}
async function setting(key, value){
  if(arguments.length===1){const row=await get("settings",key);return row?.value;}
  await put("settings",{id:key,value});return value;
}
async function queueChange(table,record,operation="upsert"){
  const item={id:uid(),table,record,operation,created_at:new Date().toISOString(),attempts:0};
  await put("syncQueue",item);
  updateSyncBadge();
}
function toast(message){
  const el=$("#toast");el.textContent=message;el.classList.add("show");clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove("show"),3000);
}
function esc(v=""){return String(v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function tag(status){
  const s=(status||"pending").toLowerCase();let cls=s==="completed"||s==="delivered"||s==="paid"?"":"pending";
  if(["in progress","ready"].includes(s))cls="done";
  return `<span class="tag ${cls}">${esc(status||"Pending")}</span>`;
}
function emptyRow(cols,msg="Abhi koi entry nahi hai."){return `<tr><td colspan="${cols}" class="empty">${esc(msg)}</td></tr>`;}
function pageHead(title,desc,buttonText,action){
  return `<section class="page-heading"><div><p class="eyebrow">FANSI STORE + SILAI</p><h2>${title}</h2><p class="muted">${desc}</p></div>${buttonText?`<button class="button" data-action="${action}">＋ ${buttonText}</button>`:""}</section>`;
}
function tablePanel(title,subtitle,headers,rows,extra=""){
  return `<section class="panel"><div class="panel-head"><div><h3>${title}</h3><p>${subtitle}</p></div>${extra}</div><div class="table-wrap"><table><thead><tr>${headers.map(h=>`<th>${h}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div></section>`;
}
async function totals(){
  const [sales,expenses,payments,tailoring,products,queue]=await Promise.all([all("sales"),all("expenses"),all("payments"),all("tailoring"),all("products"),all("syncQueue")]);
  const daySales=sales.filter(x=>x.date===today()).reduce((s,x)=>s+Number(x.total||0),0);
  const dayExpense=expenses.filter(x=>x.date===today()).reduce((s,x)=>s+Number(x.amount||0),0);
  const outstanding=sales.reduce((s,x)=>s+Math.max(0,Number(x.total||0)-Number(x.paid||0)),0)+tailoring.reduce((s,x)=>s+Math.max(0,Number(x.charge||0)-Number(x.paid||0)),0);
  const stockValue=products.reduce((s,x)=>s+Number(x.stock||0)*Number(x.cost||0),0);
  return {sales,expenses,payments,tailoring,products,queue,daySales,dayExpense,outstanding,stockValue,allSales:sales.reduce((s,x)=>s+Number(x.total||0),0)};
}
async function render(){
  const root=$("#viewRoot");
  if(activeView==="dashboard") return renderDashboard(root);
  if(activeView==="stock") return renderStock(root);
  if(activeView==="sales") return renderSales(root);
  if(activeView==="tailoring") return renderTailoring(root);
  if(activeView==="khata") return renderKhata(root);
  if(activeView==="expenses") return renderExpenses(root);
  if(activeView==="reports") return renderReports(root);
  if(activeView==="settings") return renderSettings(root);
}
async function renderDashboard(root){
  const t=await totals();
  root.innerHTML=`
    <div class="stats">
      <article class="stat-card"><div class="stat-top">Aaj ki Sales <span class="stat-icon">₹</span></div><div class="stat-value">${rupees(t.daySales)}</div><div class="stat-foot">Today's recorded sales</div></article>
      <article class="stat-card"><div class="stat-top">Aaj ka Kharcha <span class="stat-icon">↗</span></div><div class="stat-value">${rupees(t.dayExpense)}</div><div class="stat-foot">Expenses entered today</div></article>
      <article class="stat-card"><div class="stat-top">Customer Dues <span class="stat-icon">▣</span></div><div class="stat-value">${rupees(t.outstanding)}</div><div class="stat-foot">Sales + silai unpaid balance</div></article>
      <article class="stat-card"><div class="stat-top">Stock Value <span class="stat-icon">▤</span></div><div class="stat-value">${rupees(t.stockValue)}</div><div class="stat-foot">Based on current stock cost</div></article>
    </div>
    <div class="content-grid">
      <div>${tablePanel("Recent activity","Latest entries from this device",["Type","Details","Date","Amount"],recentRows(t),`<button class="text-button" data-view="reports">View reports →</button>`)}</div>
      <div class="panel"><div class="panel-head"><div><h3>Quick actions</h3><p>Roz ke kaam jaldi add karein</p></div></div><div class="quick-actions">
        <button class="quick-action" data-action="add-sale"><span class="qa-icon">₹</span><span><b>New sale</b><small>Bill / kapde ki bikri</small></span></button>
        <button class="quick-action" data-action="add-product"><span class="qa-icon">▤</span><span><b>Add stock</b><small>Kapda / purchase</small></span></button>
        <button class="quick-action" data-action="add-tailoring"><span class="qa-icon">✂</span><span><b>Silai order</b><small>New customer order</small></span></button>
        <button class="quick-action" data-action="add-expense"><span class="qa-icon">↗</span><span><b>Add expense</b><small>Kharcha entry</small></span></button>
      </div><p class="footer-note">Offline entries are saved in this browser's local database. Sync status is shown at the top.</p></div>
    </div>`;
}
function recentRows(t){
  const rows=[
    ...t.sales.map(x=>({type:"Sale",detail:x.customer||x.item||"Counter sale",date:x.date,amount:x.total})),
    ...t.tailoring.map(x=>({type:"Silai",detail:x.customer||x.garment||"Tailoring order",date:x.date,amount:x.charge})),
    ...t.expenses.map(x=>({type:"Expense",detail:x.category||x.note||"Expense",date:x.date,amount:-Number(x.amount||0)}))
  ].sort((a,b)=>(b.date||"").localeCompare(a.date||"")).slice(0,7);
  return rows.length?rows.map(x=>`<tr><td>${esc(x.type)}</td><td><strong>${esc(x.detail)}</strong></td><td>${esc(x.date||"—")}</td><td>${rupees(x.amount)}</td></tr>`).join(""):emptyRow(4);
}
async function renderStock(root){
  const items=await all("products");
  const filtered=items.filter(x=>`${x.name} ${x.category} ${x.sku}`.toLowerCase().includes(searchTerm));
  root.innerHTML=pageHead("Stock & Purchase","Kapde, accessories aur stock quantity manage karein.","Add stock","add-product")+`
  <div class="toolbar"><input class="search" id="searchBox" placeholder="Search kapda, category, SKU..." value="${esc(searchTerm)}"><div class="mini-kpis"><span class="mini-kpi">Items: <b>${items.length}</b></span><span class="mini-kpi">Low stock: <b>${items.filter(x=>Number(x.stock)<=Number(x.lowStock||0)).length}</b></span></div></div>
  ${tablePanel("Inventory","Quantity meter ya pieces mein enter karein",["Item / SKU","Category","Unit","Stock","Cost / unit","Sell / unit","Status",""],filtered.length?filtered.map(x=>`<tr><td><strong>${esc(x.name)}</strong><br><small>${esc(x.sku||"No SKU")}</small></td><td>${esc(x.category||"—")}</td><td>${esc(x.unit||"piece")}</td><td>${Number(x.stock||0)}</td><td>${rupees(x.cost)}</td><td>${rupees(x.price)}</td><td>${Number(x.stock||0)<=Number(x.lowStock||0)?'<span class="tag pending">Low stock</span>':'<span class="tag">In stock</span>'}</td><td><button class="text-button" data-edit-product="${x.id}">Edit</button></td></tr>`).join(""):emptyRow(8,"Stock item nahi mila.") )}`;
}
async function renderSales(root){
  const sales=(await all("sales")).sort((a,b)=>(b.date||"").localeCompare(a.date||""));
  const filtered=sales.filter(x=>`${x.customer} ${x.item} ${x.paymentMethod} ${x.date}`.toLowerCase().includes(searchTerm));
  root.innerHTML=pageHead("Sales & Billing","Kapde ki bikri aur received payments record karein.","New sale","add-sale")+`
  <div class="toolbar"><input class="search" id="searchBox" placeholder="Search customer, item, date..." value="${esc(searchTerm)}"><div class="mini-kpis"><span class="mini-kpi">Bills: <b>${sales.length}</b></span><span class="mini-kpi">Total sales: <b>${rupees(sales.reduce((s,x)=>s+Number(x.total||0),0))}</b></span></div></div>
  ${tablePanel("Sales ledger","Each sale is stored locally first",["Bill ID","Date","Customer","Item","Qty","Total","Paid","Due","Payment"],filtered.length?filtered.map(x=>`<tr><td><strong>${esc(x.billNo||x.id.slice(0,8))}</strong></td><td>${esc(x.date)}</td><td>${esc(x.customer||"Walk-in")}</td><td>${esc(x.item||"—")}</td><td>${Number(x.qty||0)} ${esc(x.unit||"")}</td><td>${rupees(x.total)}</td><td>${rupees(x.paid)}</td><td>${rupees(Math.max(0,Number(x.total||0)-Number(x.paid||0)))}</td><td>${esc(x.paymentMethod||"—")}</td></tr>`).join(""):emptyRow(9) )}`;
}
async function renderTailoring(root){
  const orders=(await all("tailoring")).sort((a,b)=>(b.date||"").localeCompare(a.date||""));
  const filtered=orders.filter(x=>`${x.customer} ${x.phone} ${x.garment} ${x.status} ${x.deliveryDate}`.toLowerCase().includes(searchTerm));
  root.innerHTML=pageHead("Silai Orders","Customer measurements, advance aur delivery track karein.","New silai order","add-tailoring")+`
  <div class="toolbar"><input class="search" id="searchBox" placeholder="Search customer, garment, status..." value="${esc(searchTerm)}"><div class="mini-kpis"><span class="mini-kpi">Orders: <b>${orders.length}</b></span><span class="mini-kpi">Pending: <b>${orders.filter(x=>!["Completed","Delivered"].includes(x.status)).length}</b></span></div></div>
  ${tablePanel("Tailoring register","Measurements ko customer ke order ke saath save karein",["Order","Customer","Phone","Garment","Delivery","Charge","Paid","Due","Status"],filtered.length?filtered.map(x=>`<tr><td><strong>${esc(x.orderNo||x.id.slice(0,8))}</strong></td><td>${esc(x.customer)}</td><td>${esc(x.phone||"—")}</td><td>${esc(x.garment)}</td><td>${esc(x.deliveryDate||"—")}</td><td>${rupees(x.charge)}</td><td>${rupees(x.paid)}</td><td>${rupees(Math.max(0,Number(x.charge||0)-Number(x.paid||0)))}</td><td>${tag(x.status)}</td></tr>`).join(""):emptyRow(9) )}`;
}
async function renderKhata(root){
  const [customers,sales,orders,payments]=await Promise.all([all("customers"),all("sales"),all("tailoring"),all("payments")]);
  const people=new Map();
  const add=(name,kind,amount)=>{if(!name)return;const key=name.trim().toLowerCase();const p=people.get(key)||{name,kind,due:0,paid:0};p.due+=amount;people.set(key,p);};
  sales.forEach(x=>add(x.customer,"Customer",Math.max(0,Number(x.total||0)-Number(x.paid||0))));
  orders.forEach(x=>add(x.customer,"Customer",Math.max(0,Number(x.charge||0)-Number(x.paid||0))));
  customers.forEach(x=>{const p=people.get(x.name.toLowerCase())||{name:x.name,kind:"Customer",due:0,paid:0};p.phone=x.phone;people.set(x.name.toLowerCase(),p);});
  const customerRows=[...people.values()].filter(x=>(x.name+" "+(x.phone||"")).toLowerCase().includes(searchTerm)).map(x=>'<tr><td><strong>'+esc(x.name)+'</strong></td><td>'+esc(x.phone||"—")+'</td><td>'+esc(x.kind)+'</td><td>'+rupees(x.due)+'</td><td><button class="text-button" data-pay-customer="'+esc(x.name)+'">Add payment</button></td></tr>').join("")||emptyRow(5);
  const paymentRows=payments.sort((a,b)=>(b.date||"").localeCompare(a.date||"")).slice(0,20).map(x=>'<tr><td>'+esc(x.date)+'</td><td>'+esc(x.person)+'</td><td>'+rupees(x.amount)+'</td><td>'+esc(x.method)+'</td><td>'+esc(x.note||"—")+'</td></tr>').join("")||emptyRow(5);
  root.innerHTML=pageHead("Khata / Payments","Customer balance aur payment history manage karein.","Record payment","add-payment")+
    '<div class="toolbar"><input class="search" id="searchBox" placeholder="Search customer name..." value="'+esc(searchTerm)+'"><div class="mini-kpis"><span class="mini-kpi">Customers: <b>'+people.size+'</b></span><span class="mini-kpi">Total due: <b>'+rupees([...people.values()].reduce((s,x)=>s+x.due,0))+'</b></span></div></div>'+
    tablePanel("Customer ledger","Due amounts sales aur silai orders se calculate hote hain",["Customer","Phone","Type","Outstanding due","Action"],customerRows)+
    '<div style="height:16px"></div>'+tablePanel("Recent payments","Payment entries recorded",["Date","Customer / Supplier","Amount","Method","Note"],paymentRows);
}
async function renderExpenses(root){
  const expenses=(await all("expenses")).sort((a,b)=>(b.date||"").localeCompare(a.date||""));
  const filtered=expenses.filter(x=>`${x.category} ${x.note} ${x.date} ${x.paymentMethod}`.toLowerCase().includes(searchTerm));
  root.innerHTML=pageHead("Expenses","Rent, electricity, wages, thread aur other expenses.","Add expense","add-expense")+`
  <div class="toolbar"><input class="search" id="searchBox" placeholder="Search category, note, date..." value="${esc(searchTerm)}"><div class="mini-kpis"><span class="mini-kpi">Entries: <b>${expenses.length}</b></span><span class="mini-kpi">Total expense: <b>${rupees(expenses.reduce((s,x)=>s+Number(x.amount||0),0))}</b></span></div></div>
  ${tablePanel("Expense ledger","Har expense ki receipt/note record karein",["Date","Category","Description","Payment method","Amount"],filtered.map(x=>`<tr><td>${esc(x.date)}</td><td><strong>${esc(x.category)}</strong></td><td>${esc(x.note||"—")}</td><td>${esc(x.paymentMethod||"Cash")}</td><td>${rupees(x.amount)}</td></tr>`).join("")||emptyRow(5))}`;
}
async function renderReports(root){
  const t=await totals();const months={};
  [...t.sales.map(x=>({date:x.date,in:Number(x.total||0),out:0})),...t.expenses.map(x=>({date:x.date,in:0,out:Number(x.amount||0)}))].forEach(x=>{const m=(x.date||today()).slice(0,7);months[m] ||= {sales:0,expenses:0};months[m].sales+=x.in;months[m].expenses+=x.out;});
  root.innerHTML=pageHead("Reports","Sales, expenses aur estimated operating result.","Export CSV","export-csv")+`
  <div class="stats"><article class="stat-card"><div class="stat-top">All-time recorded sales</div><div class="stat-value">${rupees(t.allSales)}</div><div class="stat-foot">Gross sales total</div></article><article class="stat-card"><div class="stat-top">All-time expenses</div><div class="stat-value">${rupees(t.expenses.reduce((s,x)=>s+Number(x.amount||0),0))}</div><div class="stat-foot">Recorded expense total</div></article><article class="stat-card"><div class="stat-top">Estimated difference</div><div class="stat-value">${rupees(t.allSales-t.expenses.reduce((s,x)=>s+Number(x.amount||0),0))}</div><div class="stat-foot">Sales minus expenses only</div></article><article class="stat-card"><div class="stat-top">Stock at cost</div><div class="stat-value">${rupees(t.stockValue)}</div><div class="stat-foot">Not included in estimated difference</div></article></div>
  <div class="notice">Note: This is a basic cash/operations view, not a complete accounting profit calculation. Proper gross profit needs item-level cost of goods sold, returns, taxes and adjustments.</div><div style="height:16px"></div>
  ${tablePanel("Monthly summary","Recorded sales and expenses by month",["Month","Sales","Expenses","Difference"],Object.keys(months).sort().reverse().map(m=>`<tr><td><strong>${esc(m)}</strong></td><td>${rupees(months[m].sales)}</td><td>${rupees(months[m].expenses)}</td><td>${rupees(months[m].sales-months[m].expenses)}</td></tr>`).join("")||emptyRow(4))}`;
}
async function renderSettings(root){
  const url=await setting("sheetsUrl")||"", token=await setting("sheetsToken")||"", shop=await setting("shopName")||"Fansi Store + Silai", pending=(await all("syncQueue")).length;
  root.innerHTML=pageHead("Settings & Sync","Shop profile, Google Sheets sync aur data backup.")+`
  <div class="settings-grid">
    <section class="settings-card"><h3>Shop profile</h3><p>Apne business ka display name set karein.</p><div class="field"><label>Shop name</label><input id="shopName" value="${esc(shop)}"></div><button class="button" data-action="save-shop">Save shop name</button></section>
    <section class="settings-card"><h3>Offline status</h3><p>Current device ke local database ki details.</p><div class="mini-kpis"><span class="mini-kpi">Pending sync: <b>${pending}</b></span><span class="mini-kpi">Browser: <b>IndexedDB</b></span></div><p>Local data isi browser/device mein hota hai. Browser data clear karne se unsynced entries delete ho sakti hain.</p><button class="button secondary" data-action="export-json">Export local backup (JSON)</button></section>
    <section class="settings-card"><h3>Google Sheets connection (testing)</h3><p>Paste your deployed Apps Script Web App URL. Configure the matching API token in Apps Script Script Properties. Do not use this shared-token approach for sensitive production data.</p>
      <div class="field"><label>Apps Script Web App URL</label><input id="sheetsUrl" type="url" placeholder="https://script.google.com/macros/s/.../exec" value="${esc(url)}"></div>
      <div class="field"><label>API token (testing only)</label><input id="sheetsToken" type="password" autocomplete="off" placeholder="Same value as API_TOKEN Script Property" value="${esc(token)}"></div>
      <button class="button" data-action="save-sheets">Save connection</button> <button class="button secondary" data-action="sync-now">Sync pending</button>
      <p id="sheetsHelp" class="help">First update Apps Script so both upload and pull are authenticated. Browser-to-Apps-Script CORS/redirect behavior must be tested on your hosted app before real data is used.</p>
    </section>
    <section class="settings-card"><h3>Owner & staff access</h3><p>This MVP does not yet implement production-grade sign-in or owner/staff/karigar permissions.</p><div class="notice">A token stored in browser settings is visible to that browser's user. Do not use this method for real customer/payment records or public staff deployments.</div></section>
  </div>
  <p class="footer-note">Export JSON backups regularly. Local offline records are stored separately on each device and become shared only after successful sync.</p>`;
}
const forms={
  "add-product":{title:"Add stock / purchase",store:"products",fields:[
    ["name","Kapde / item ka naam","text",true],["sku","SKU / item code","text"],["category","Category","text"],["unit","Unit","select",true,["meter","piece","set","roll","other"]],["stock","Quantity received / current stock","number",true],["cost","Purchase cost per unit (₹)","number",true],["price","Selling price per unit (₹)","number",true],["lowStock","Low-stock alert threshold","number"],["supplier","Supplier name","text"],["date","Purchase date","date",true]
  ]},
  "add-sale":{title:"New sale / bill",store:"sales",fields:[
    ["customer","Customer name (blank = walk-in)","text"],["phone","Mobile number","tel"],["item","Item / kapde ka naam","text",true],["productId","Stock item (optional)","product"],["qty","Quantity sold","number",true],["unit","Unit","select",true,["meter","piece","set","roll","other"]],["price","Selling price per unit (₹)","number",true],["total","Total bill (₹)","number",true],["paid","Payment received (₹)","number",true],["paymentMethod","Payment method","select",true,["Cash","UPI","Bank","Credit / Udhaar","Mixed"]],["date","Sale date","date",true],["note","Note","text"]
  ]},
  "add-tailoring":{title:"New silai order",store:"tailoring",fields:[
    ["customer","Customer name","text",true],["phone","Mobile number","tel",true],["garment","Garment / silai type","text",true],["measurements","Measurements (e.g. chest, waist, length)","textarea"],["charge","Total silai charge (₹)","number",true],["paid","Advance / paid (₹)","number",true],["deliveryDate","Delivery date","date",true],["status","Order status","select",true,["Pending","In progress","Ready","Delivered","Completed"]],["date","Order date","date",true],["note","Design / fitting notes","textarea"]
  ]},
  "add-expense":{title:"Add expense",store:"expenses",fields:[
    ["category","Expense category","select",true,["Rent","Electricity","Salary / Karigar","Thread / Buttons","Transport","Repair","Packaging","Other"]],["amount","Amount (₹)","number",true],["paymentMethod","Payment method","select",true,["Cash","UPI","Bank","Credit"]],["date","Expense date","date",true],["note","Description / bill reference","text"],["paidTo","Paid to","text"]
  ]},
  "add-payment":{title:"Record payment",store:"payments",fields:[
    ["person","Customer / supplier name","text",true],["amount","Payment amount (₹)","number",true],["type","Payment type","select",true,["Customer received","Supplier paid","Advance for silai","Other"]],["method","Method","select",true,["Cash","UPI","Bank","Other"]],["date","Payment date","date",true],["note","Note / reference","text"]
  ]}
};
function fieldHTML(f){
  const [name,label,type,required,opts]=f;let input="";
  if(type==="select")input=`<select name="${name}" ${required?"required":""}>${opts.map(o=>`<option>${esc(o)}</option>`).join("")}</select>`;
  else if(type==="product")input=`<select name="${name}"><option value="">No stock link</option></select>`;
  else if(type==="textarea")input=`<textarea name="${name}" ${required?"required":""}></textarea>`;
  else input=`<input name="${name}" type="${type}" ${required?"required":""} ${type==="number"?'min="0" step="0.01"':""} ${name==="date"?'value="'+today()+'"':""}>`;
  return `<div class="field ${type==="textarea"?"full":""}"><label>${esc(label)}${required?' *':""}</label>${input}</div>`;
}
async function openForm(type, preset={}){
  const def=forms[type];if(!def)return;
  activeFormType=type;$("#dialogTitle").textContent=def.title;
  $("#dialogFields").innerHTML=def.fields.map(fieldHTML).join("");
  if(type==="add-sale"){
    const products=await all("products"),sel=$('[name="productId"]');
    sel.innerHTML=`<option value="">No stock link</option>`+products.map(p=>`<option value="${esc(p.id)}">${esc(p.name)} · stock ${p.stock} ${esc(p.unit)}</option>`).join("");
    sel.addEventListener("change",()=>{const p=products.find(x=>x.id===sel.value);if(p){$('[name="item"]').value=p.name;$('[name="unit"]').value=p.unit;$('[name="price"]').value=p.price;$('[name="total"]').value=(Number(p.price)||0)*(Number($('[name="qty"]').value)||1);}});
    $('[name="qty"]').addEventListener("input",()=>{$('[name="total"]').value=(Number($('[name="price"]').value)||0)*(Number($('[name="qty"]').value)||0);});
    $('[name="price"]').addEventListener("input",()=>{$('[name="total"]').value=(Number($('[name="price"]').value)||0)*(Number($('[name="qty"]').value)||0);});
  }
  for(const [k,v] of Object.entries(preset)){const el=$(`[name="${k}"]`);if(el)el.value=v;}
  $("#entryDialog").showModal();
}
async function saveForm(){
  const def=forms[activeFormType];if(!def)return;
  const form=$("#entryForm"),data={};
  for(const f of def.fields){const el=form.elements.namedItem(f[0]);if(el)data[f[0]]=el.value;}
  const numeric=["stock","cost","price","lowStock","qty","total","paid","charge","amount"];
  numeric.forEach(k=>{if(k in data)data[k]=Number(data[k]||0);});
  const id=uid();data.id=id;data.created_at=new Date().toISOString();data.updated_at=data.created_at;
  if(activeFormType==="add-product"){data.lowStock=Number(data.lowStock||0);data.stock=Number(data.stock||0);}
  if(activeFormType==="add-sale"){
    data.billNo="BILL-"+Date.now().toString().slice(-7);
    if(data.productId){
      const p=await get("products",data.productId);
      if(p){p.stock=Number(p.stock||0)-Number(data.qty||0);p.updated_at=new Date().toISOString();await put("products",p);await queueChange("products",p);}
    }
  }
  if(activeFormType==="add-tailoring")data.orderNo="SIL-"+Date.now().toString().slice(-7);
  if(activeFormType==="add-payment"){
    // Payments are recorded in the ledger; allocation to a specific invoice is not yet included in this MVP.
    data.person=data.person.trim();
  }
  await put(def.store,data);await queueChange(def.store,data);
  if(activeFormType==="add-product"&&data.supplier){
    const supplier={id:uid(),name:data.supplier,phone:"",created_at:new Date().toISOString()};await put("suppliers",supplier);
  }
  $("#entryDialog").close();$("#entryForm").reset();toast("Entry saved on this device.");await render();updateSyncBadge();
}
async function editProduct(id){
  const p=await get("products",id);if(!p)return;
  await openForm("add-product",p);
}
async function saveSupabase(){
  const url=$("#supabaseUrl")?.value.trim(),key=$("#supabaseKey")?.value.trim();
  if(!url||!key){toast("Supabase URL aur key dono enter karein.");return;}
  await setting("supabaseUrl",url);await setting("supabaseKey",key);
  try{
    if(!window.supabase?.createClient)throw new Error("Supabase JS library load nahi hui. Internet check karein.");
    supabaseClient=window.supabase.createClient(url,key);
    const {error}=await supabaseClient.from("sync_records").select("id").limit(1);
    if(error)throw error;
    $("#supabaseHelp").textContent="Cloud connection successful. Ab Sync now try karein.";
    toast("Supabase connected.");updateSyncBadge();
  }catch(e){$("#supabaseHelp").textContent="Connection check failed: "+e.message+" — schema and policies verify karein.";toast("Connection check failed. Settings check karein.");}
}
async function initSupabase(){
  const url=await setting("supabaseUrl"),key=await setting("supabaseKey");
  if(url&&key&&window.supabase?.createClient){supabaseClient=window.supabase.createClient(url,key);}
}
const SHEET_TYPES = {
  products:"Products", sales:"Sales", tailoring:"Tailoring_Orders",
  customers:"Customers", payments:"Payments", expenses:"Expenses"
};
function toSheetData(type, r){
  const common={id:r.id,updatedAt:r.updated_at||r.updatedAt||new Date().toISOString(),deleted:false};
  if(type==="products") return {...common,name:r.name||"",sku:r.sku||"",category:r.category||"",quantity:Number(r.stock||r.quantity||0),purchasePrice:Number(r.cost||r.purchasePrice||0),sellingPrice:Number(r.price||r.sellingPrice||0)};
  if(type==="sales") return {...common,billNo:r.billNo||r.id,customerId:r.customerId||"",date:r.date||"",itemsJson:JSON.stringify([{item:r.item||"",qty:Number(r.qty||0),unit:r.unit||"",price:Number(r.price||0),productId:r.productId||""}]),subtotal:Number(r.total||0),discount:0,total:Number(r.total||0),paid:Number(r.paid||0),paymentStatus:Number(r.paid||0)>=Number(r.total||0)?"paid":"partial"};
  if(type==="tailoring") return {...common,orderNo:r.orderNo||r.id,customerId:r.customerId||"",customerName:r.customer||r.customerName||"",phone:r.phone||"",measurementsJson:JSON.stringify(r.measurements||{}),itemsJson:JSON.stringify([{garment:r.garment||""}]),orderDate:r.date||"",deliveryDate:r.deliveryDate||"",amount:Number(r.charge||0),paid:Number(r.paid||0),status:r.status||"Pending",notes:r.note||""};
  if(type==="customers") return {...common,name:r.name||"",phone:r.phone||"",address:r.address||"",openingBalance:Number(r.openingBalance||0)};
  if(type==="payments") return {...common,customerId:r.customerId||"",referenceId:r.referenceId||"",date:r.date||"",amount:Number(r.amount||0),method:r.method||r.paymentMethod||"",notes:r.note||""};
  if(type==="expenses") return {...common,date:r.date||"",category:r.category||"",description:r.note||r.description||"",amount:Number(r.amount||0),paidBy:r.paidTo||r.paidBy||""};
  return {...common,...r};
}
function fromSheetData(type, d){
  const common={id:String(d.id),updated_at:d.updatedAt?new Date(d.updatedAt).toISOString():new Date().toISOString(),created_at:d.updatedAt?new Date(d.updatedAt).toISOString():new Date().toISOString()};
  if(type==="products") return {...common,name:d.name||"",sku:d.sku||"",category:d.category||"",stock:Number(d.quantity||0),cost:Number(d.purchasePrice||0),price:Number(d.sellingPrice||0),unit:"meter",lowStock:0};
  if(type==="sales"){
    let item={};try{item=JSON.parse(d.itemsJson||"[]")[0]||{}}catch(_){}
    return {...common,billNo:d.billNo||d.id,customerId:d.customerId||"",date:d.date||"",item:item.item||"",qty:Number(item.qty||0),unit:item.unit||"",price:Number(item.price||0),productId:item.productId||"",total:Number(d.total||0),paid:Number(d.paid||0),paymentMethod:"",customer:""};
  }
  if(type==="tailoring"){
    let item={};try{item=JSON.parse(d.itemsJson||"[]")[0]||{}}catch(_){}
    let measurements={};try{measurements=JSON.parse(d.measurementsJson||"{}")}catch(_){}
    return {...common,orderNo:d.orderNo||d.id,customerId:d.customerId||"",customer:d.customerName||"",phone:d.phone||"",garment:item.garment||"",measurements, date:d.orderDate||"",deliveryDate:d.deliveryDate||"",charge:Number(d.amount||0),paid:Number(d.paid||0),status:d.status||"Pending",note:d.notes||""};
  }
  if(type==="customers") return {...common,name:d.name||"",phone:d.phone||"",address:d.address||"",openingBalance:Number(d.openingBalance||0)};
  if(type==="payments") return {...common,customerId:d.customerId||"",referenceId:d.referenceId||"",date:d.date||"",amount:Number(d.amount||0),method:d.method||"",note:d.notes||"",person:""};
  if(type==="expenses") return {...common,date:d.date||"",category:d.category||"",note:d.description||"",amount:Number(d.amount||0),paidTo:d.paidBy||"",paymentMethod:""};
  return {...common,...d};
}
async function sheetsRequest(payload){
  const url=await setting("sheetsUrl"), token=await setting("sheetsToken");
  if(!url||!token) throw new Error("Settings mein Apps Script URL aur testing token configure karein.");
  // text/plain avoids a JSON preflight request; Apps Script redirects/CORS may still block browser access.
  const response=await fetch(url,{method:"POST",mode:"cors",redirect:"follow",headers:{"Content-Type":"text/plain;charset=UTF-8"},body:JSON.stringify({...payload,token})});
  if(!response.ok) throw new Error("HTTP "+response.status);
  const result=await response.json();
  if(!result.ok) throw new Error(result.error||"Apps Script request failed");
  return result;
}
async function syncNow(){
  if(sheetsSyncBusy)return;
  if(!navigator.onLine){toast("Internet nahi hai. Entries local save hain; online aane par sync hongi.");return;}
  const url=await setting("sheetsUrl"),token=await setting("sheetsToken");
  if(!url||!token){toast("Settings mein Google Sheets URL aur API token configure karein.");activeView="settings";await render();return;}
  sheetsSyncBusy=true;
  const pending=(await all("syncQueue")).sort((a,b)=>a.created_at.localeCompare(b.created_at));
  setStatus("Syncing…","syncing");
  try{
    for(const item of pending){
      const type=SHEET_TYPES[item.table];
      if(!type) { item.attempts=(item.attempts||0)+1;item.last_error="Unsupported local store: "+item.table;await put("syncQueue",item);continue; }
      const result=await sheetsRequest({records:[{type,id:item.record.id,data:toSheetData(item.table,item.record)}]});
      if(!result.results||!result.results[0]||!result.results[0].ok) throw new Error(result.results?.[0]?.error||"Write not confirmed");
      await remove("syncQueue",item.id);
    }
    // Pull remote rows for each supported store. Apps Script must implement authenticated POST pull.
    for(const [localType,sheetType] of Object.entries(SHEET_TYPES)){
      const result=await sheetsRequest({action:"pull",type:sheetType});
      const records=result.records||[];
      for(const remote of records){
        if(!remote.id||remote.deleted===true||String(remote.deleted).toLowerCase()==="true")continue;
        const local=fromSheetData(localType,remote), existing=await get(localType,local.id);
        const remoteTime=Date.parse(local.updated_at||"")||0, localTime=Date.parse(existing?.updated_at||"")||0;
        if(!existing||remoteTime>localTime) await put(localType,local);
      }
    }
    setStatus("Google Sheets sync complete","online");
    toast("Google Sheets sync complete.");
  }catch(e){
    console.error("Sheets sync failed",e);
    setStatus("Sync issue","offline");
    toast("Sync fail hua: "+e.message);
  }finally{
    sheetsSyncBusy=false;updateSyncBadge();await render();
  }
}
function setStatus(text,cls){const el=$("#syncStatus");el.textContent=text;el.className="status "+cls;}
async function updateSyncBadge(){
  const pending=(await all("syncQueue")).length;
  if(!navigator.onLine)setStatus(`Offline · ${pending} pending`,"offline");
  else if(pending)setStatus(`${pending} pending sync`,"offline");
  else if(supabaseClient)setStatus("Cloud connected","online");
  else setStatus("Local mode","offline");
}
async function exportJSON(){
  const data={exported_at:new Date().toISOString(),stores:{}};
  for(const s of STORES)data.stores[s]=await all(s);
  const blob=new Blob([JSON.stringify(data,null,2)],{type:"application/json"});
  const url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=`fansi-silai-backup-${today()}.json`;a.click();URL.revokeObjectURL(url);toast("Backup file exported.");
}
async function exportCSV(){
  const [sales,expenses,tailoring,products]=await Promise.all([all("sales"),all("expenses"),all("tailoring"),all("products")]);
  const rows=[["type","date","name_or_item","amount","paid","status"]];
  sales.forEach(x=>rows.push(["sale",x.date,x.customer||x.item,x.total,x.paid,"recorded"]));
  expenses.forEach(x=>rows.push(["expense",x.date,x.category,x.amount,"", "recorded"]));
  tailoring.forEach(x=>rows.push(["tailoring",x.date,x.customer,x.charge,x.paid,x.status]));
  products.forEach(x=>rows.push(["stock","",x.name,Number(x.stock||0),x.cost,"current"]));
  const csv=rows.map(r=>r.map(v=>`"${String(v??"").replace(/"/g,'""')}"`).join(",")).join("\r\n");
  const url=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8;"})),a=document.createElement("a");a.href=url;a.download=`fansi-silai-report-${today()}.csv`;a.click();URL.revokeObjectURL(url);toast("CSV report exported.");
}
document.addEventListener("click",async e=>{
  const nav=e.target.closest("[data-view]");if(nav){activeView=nav.dataset.view;searchTerm="";$$(".nav-item").forEach(x=>x.classList.toggle("active",x.dataset.view===activeView));await render();return;}
  const action=e.target.closest("[data-action]")?.dataset.action;
  if(action==="quick-sale"||action==="add-sale"||action==="add-product"||action==="add-tailoring"||action==="add-expense"||action==="add-payment"){await openForm(action==="quick-sale"?"add-sale":action);return;}
  if(action==="save-shop"){await setting("shopName",$("#shopName").value.trim()||"Fansi Store + Silai");toast("Shop name saved.");return;}
  if(action==="save-sheets"){await setting("sheetsUrl",$("#sheetsUrl").value.trim());await setting("sheetsToken",$("#sheetsToken").value.trim());toast("Google Sheets connection settings saved on this device.");await render();return;}
  if(action==="save-supabase"){await saveSupabase();return;}
  if(action==="sync-now"){await syncNow();return;}
  if(action==="export-json"){await exportJSON();return;}
  if(action==="export-csv"){await exportCSV();return;}
  const edit=e.target.closest("[data-edit-product]");if(edit){await editProduct(edit.dataset.editProduct);return;}
  const pay=e.target.closest("[data-pay-customer]");if(pay){await openForm("add-payment",{person:pay.dataset.payCustomer,type:"Customer received"});return;}
});
$("#entryForm").addEventListener("submit",e=>{e.preventDefault();saveForm().catch(err=>{console.error(err);toast("Entry save nahi hui: "+err.message);});});
$("#saveEntry").addEventListener("click",e=>{e.preventDefault();saveForm().catch(err=>{console.error(err);toast("Entry save nahi hui: "+err.message);});});
document.addEventListener("input",e=>{if(e.target.id==="searchBox"){searchTerm=e.target.value.toLowerCase();render();}});
$("#syncNow").addEventListener("click",syncNow);
window.addEventListener("online",()=>{updateSyncBadge();syncNow();});
window.addEventListener("offline",updateSyncBadge);
if("serviceWorker" in navigator && location.protocol!=="file:")window.addEventListener("load",()=>navigator.serviceWorker.register("./sw.js").catch(console.warn));
(async function boot(){
  try{db=await openDB();await initSupabase();await render();await updateSyncBadge();}
  catch(e){console.error(e);$("#viewRoot").innerHTML=`<div class="notice">App database start nahi ho paya. Is app ko local file ki tarah open karne ke bajay local web server ya HTTPS hosting par run karein. Detail: ${esc(e.message)}</div>`;}
})();
