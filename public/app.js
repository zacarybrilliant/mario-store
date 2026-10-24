/* Mario Store frontend: PostgreSQL-backed through the Node.js API, with cached data for offline use. */
const DB_KEY = "mario_store_local_v1";
const SESSION_KEY = "mario_store_session_v1";

const $ = id => document.getElementById(id);
const money = n => "₱" + Number(n || 0).toLocaleString("en-PH",{minimumFractionDigits:2,maximumFractionDigits:2});
const uid = prefix => prefix + "_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2,7);
const esc = s => String(s ?? "").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));

let state = loadDB();
let session = loadSession();
// Do not trust legacy local-only sessions from the old demo build.
if(session && !session.user){session=null;localStorage.removeItem(SESSION_KEY);}
// Remove any legacy plaintext credentials from the browser cache.
state.users=state.users.map(({password,password_hash,...safe})=>safe);
let currentPage = "dashboard";
let cart = [];
let reportRange = "month";

function blankDB(){
  return {version:2,users:[],products:[],sales:[],stockMovements:[]};
}
function loadDB(){
  try{
    const db=JSON.parse(localStorage.getItem(DB_KEY)||"null")||blankDB();
    db.users ||= []; db.products ||= []; db.sales ||= []; db.stockMovements ||= [];
    return db;
  }catch(e){return blankDB();}
}
function saveDB(){localStorage.setItem(DB_KEY,JSON.stringify(state));}
function loadSession(){try{return JSON.parse(localStorage.getItem(SESSION_KEY)||"null")}catch{return null}}
function saveSession(){localStorage.setItem(SESSION_KEY,JSON.stringify(session))}
function toast(msg){const t=$("toast");t.textContent=msg;t.classList.add("show");clearTimeout(window._toast);window._toast=setTimeout(()=>t.classList.remove("show"),2600)}
function isOwner(){return session?.role==="Owner"}
function currentUser(){return session?.user || (session ? state.users.find(u=>u.id===session.id) : null)}
async function api(path, options={}) { return window.MarioStoreAPI.api(path, options); }
async function refreshFromServer(){
  const results = await Promise.all([
    api('/products'),
    api('/sales'),
    isOwner() ? api('/users') : Promise.resolve({users:[currentUser()].filter(Boolean)}),
    isOwner() ? api('/stock-movements') : Promise.resolve({stockMovements:state.stockMovements||[]})
  ]);
  state.products=results[0].products||[];
  state.sales=results[1].sales||[];
  state.users=results[2].users||[];
  state.stockMovements=results[3].stockMovements||[];
  // Cache only application data, never passwords or password hashes.
  saveDB();
  return state;
}
async function tryRefreshFromServer(){
  if(!navigator.onLine || !window.MarioStoreAPI.getToken()) return false;
  try { await refreshFromServer(); return true; }
  catch(error) { console.warn('Using cached store data:',error.message); return false; }
}
function cacheOfflinePassword(email,password){
  // Local-only offline verifier. Server-side authentication still uses bcrypt.
  const salt=localStorage.getItem('mario_store_offline_salt')||crypto.randomUUID();
  localStorage.setItem('mario_store_offline_salt',salt);
  return crypto.subtle.digest('SHA-256',new TextEncoder().encode(salt+':'+email+':'+password))
    .then(buf=>localStorage.setItem('mario_store_offline_verifier',Array.from(new Uint8Array(buf)).map(x=>x.toString(16).padStart(2,'0')).join('')));
}
async function verifyOfflinePassword(email,password){
  const salt=localStorage.getItem('mario_store_offline_salt'), expected=localStorage.getItem('mario_store_offline_verifier');
  if(!salt||!expected)return false;
  const buf=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(salt+':'+email+':'+password));
  const actual=Array.from(new Uint8Array(buf)).map(x=>x.toString(16).padStart(2,'0')).join('');
  return actual===expected && (session?.user?.email||'').toLowerCase()===email.toLowerCase();
}
function login(){
  $("loginForm").onsubmit=async e=>{
    e.preventDefault();
    const email=$("loginEmail").value.trim().toLowerCase(), password=$("loginPassword").value;
    const submit=$("loginForm").querySelector('button[type="submit"]');
    submit.disabled=true;
    try {
      if(navigator.onLine){
        const result=await api('/auth/login',{method:'POST',body:JSON.stringify({email,password})});
        session={id:result.user.id,role:result.user.role,user:result.user};
        saveSession(); window.MarioStoreAPI.setToken(result.token);
        await cacheOfflinePassword(email,password);
        await refreshFromServer();
        startApp();
      } else {
        const ok=await verifyOfflinePassword(email,password);
        if(!ok) throw new Error('Offline sign-in is available only on this device after a successful online sign-in.');
        startApp();
        toast('Offline mode: sales will sync when connection returns.');
      }
    } catch(error){toast(error.message||'Could not sign in');}
    finally {submit.disabled=false;}
  };
}
function logout(){
  session=null;localStorage.removeItem(SESSION_KEY);window.MarioStoreAPI.setToken(null);cart=[];
  $("app").classList.add("hidden");$("loginScreen").classList.remove("hidden");
}
$("logoutBtn").onclick=logout;
async function startApp(){
  if(!session || !currentUser()){logout();return}
  if(navigator.onLine && window.MarioStoreAPI.getToken()){
    await tryRefreshFromServer();
  }
  $("loginScreen").classList.add("hidden");$("app").classList.remove("hidden");
  const u=currentUser();
  $("sideName").textContent=u.name;$("sideRole").textContent=u.role;$("sideAvatar").textContent=(u.name||"U").charAt(0).toUpperCase();
  $("roleBadge").textContent=u.role;
  document.querySelectorAll(".owner-only").forEach(x=>x.style.display=isOwner()?"flex":"none");
  $("currentDate").textContent=new Date().toLocaleDateString("en-PH",{month:"short",day:"numeric",year:"numeric"});
  if(!isOwner() && ["reports","users","backup"].includes(currentPage)) currentPage="dashboard";
  renderPage();
}
function todayISO(d=new Date()){return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10)}
function formatDate(s){if(!s)return "—";return new Date(s).toLocaleDateString("en-PH",{year:"numeric",month:"short",day:"numeric"})}
function formatDateTime(s){if(!s)return "—";return new Date(s).toLocaleString("en-PH",{dateStyle:"medium",timeStyle:"short"})}
function productById(id){return state.products.find(p=>p.id===id)}
function saleTotal(s){return Number(s.total||0)}
function generateReceiptNo(){
  const stamp = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2,6).toUpperCase();
  return `MS-${stamp}-${rand}`;
}
function stockStatus(p){if(p.stock<=0)return ["out","Out of stock"];if(p.stock<=p.lowStock)return ["low","Low stock"];return ["ok","In stock"]}
function dateRangeStart(range){
  const now=new Date(); const start=new Date(now);
  if(range==="day") start.setHours(0,0,0,0);
  if(range==="week"){const day=(now.getDay()+6)%7;start.setDate(now.getDate()-day);start.setHours(0,0,0,0)}
  if(range==="month"){start.setDate(1);start.setHours(0,0,0,0)}
  if(range==="year"){start.setMonth(0,1);start.setHours(0,0,0,0)}
  return start;
}
function filteredSales(range="all"){
  if(range==="all")return [...state.sales];
  const start=dateRangeStart(range);
  return state.sales.filter(s=>new Date(s.createdAt)>=start);
}
function csvDownload(filename, rows){
  const csv=rows.map(r=>r.map(v=>`"${String(v??"").replace(/"/g,'""')}"`).join(",")).join("\n");
  const blob=new Blob([csv],{type:"text/csv;charset=utf-8"});
  const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=filename;a.click();URL.revokeObjectURL(a.href);
}
function downloadJSON(){
  const blob=new Blob([JSON.stringify(state,null,2)],{type:"application/json"});
  const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=`mario-store-backup-${todayISO()}.json`;a.click();URL.revokeObjectURL(a.href);
}
function openModal(title,body){$("modalTitle").textContent=title;$("modalBody").innerHTML=body;$("modal").classList.remove("hidden")}
function closeModal(){$("modal").classList.add("hidden")}
$("modalClose").onclick=closeModal;
$("modal").querySelector(".modal-backdrop").onclick=closeModal;

function setupNav(){
  document.querySelectorAll(".nav-item").forEach(btn=>btn.onclick=()=>{
    if(btn.classList.contains("owner-only") && !isOwner())return;
    currentPage=btn.dataset.page;
    document.querySelector(".sidebar").classList.remove("open");
    renderPage();
  });
  $("mobileMenu").onclick=()=>document.querySelector(".sidebar").classList.toggle("open");
}
function renderPage(){
  document.querySelectorAll(".nav-item").forEach(b=>b.classList.toggle("active",b.dataset.page===currentPage));
  const titles={
    dashboard:["Dashboard","Overview of your store"],
    pos:["POS / Sales","Create sales and manage the current cart"],
    inventory:["Inventory","Products, stock levels, and restocking"],
    reports:["Sales Reports","Review and download sales records"],
    users:["Tindero Accounts","Manage cashier / tindero access"],
    backup:["Backup / Restore","Keep a local copy of your store data"]
  };
  $("pageTitle").textContent=titles[currentPage][0];$("pageSubtitle").textContent=titles[currentPage][1];
  const fn={dashboard:renderDashboard,pos:renderPOS,inventory:renderInventory,reports:renderReports,users:renderUsers,backup:renderBackup}[currentPage];
  fn();
}

function renderDashboard(){
  if(!isOwner()){
    const today=filteredSales("day"), month=filteredSales("month");
    const low=state.products.filter(p=>p.stock<=p.lowStock);
    $("pageContent").innerHTML=`
      <div class="grid stats">
        <div class="stat-card"><div class="stat-top">Today's Sales</div><div class="stat-value">${money(today.reduce((a,s)=>a+s.total,0))}</div><div class="stat-note">${today.length} transaction(s)</div></div>
        <div class="stat-card"><div class="stat-top">Monthly Sales</div><div class="stat-value">${money(month.reduce((a,s)=>a+s.total,0))}</div><div class="stat-note">${month.length} transaction(s)</div></div>
        <div class="stat-card"><div class="stat-top">Products</div><div class="stat-value">${state.products.length}</div><div class="stat-note">${state.products.filter(p=>p.stock>0).length} with stock</div></div>
        <div class="stat-card"><div class="stat-top">Low Stock</div><div class="stat-value">${low.length}</div><div class="stat-note">Report shortages to Admin</div></div>
      </div>
      <div class="grid two-col">
        <div class="panel"><div class="section-head"><h3>Low Stock</h3><button class="btn sm secondary" onclick="currentPage='inventory';renderPage()">Inventory</button></div>
          <div class="low-list">${low.length?low.map(p=>`<div class="low-item"><div><strong>${esc(p.name)}</strong><small>${p.stock} remaining</small></div><button class="btn sm warning" onclick="reportLowStock('${p.id}')">Report</button></div>`).join(""):`<div class="empty">No low-stock products.</div>`}</div>
        </div>
        <div class="panel"><div class="section-head"><h3>Quick Sale</h3></div><p class="muted">Select a product, enter quantity, then complete the sale. The system generates the transaction code automatically.</p><button class="btn primary full" onclick="currentPage='pos';renderPage()">Open POS</button></div>
      </div>`;
    return;
  }
  const sales=filteredSales("day"), month=filteredSales("month");
  const revenue=sales.reduce((a,s)=>a+saleTotal(s),0);
  const monthRevenue=month.reduce((a,s)=>a+saleTotal(s),0);
  const low=state.products.filter(p=>p.stock<=p.lowStock);
  $("pageContent").innerHTML=`
    <div class="grid stats">
      <div class="stat-card"><div class="stat-top">Today's Sales <span class="stat-icon">₱</span></div><div class="stat-value">${money(revenue)}</div><div class="stat-note">${sales.length} transaction(s)</div></div>
      <div class="stat-card"><div class="stat-top">Monthly Sales <span class="stat-icon">◫</span></div><div class="stat-value">${money(monthRevenue)}</div><div class="stat-note">${month.length} transaction(s)</div></div>
      <div class="stat-card"><div class="stat-top">Products <span class="stat-icon">▤</span></div><div class="stat-value">${state.products.length}</div><div class="stat-note">${state.products.filter(p=>p.stock>0).length} currently in stock</div></div>
      <div class="stat-card"><div class="stat-top">Low Stock <span class="stat-icon">!</span></div><div class="stat-value">${low.length}</div><div class="stat-note">${low.filter(p=>p.stock<=0).length} out of stock</div></div>
    </div>
    <div class="grid two-col">
      <div class="panel"><div class="section-head"><h3>Sales — Last 7 Days</h3></div><div class="chart-wrap"><canvas id="salesChart"></canvas></div></div>
      <div class="panel"><div class="section-head"><h3>Low Stock Alert</h3><button class="btn sm secondary" onclick="currentPage='inventory';renderPage()">View Inventory</button></div>
        <div class="low-list">${low.length?low.slice(0,7).map(p=>`<div class="low-item"><div><strong>${esc(p.name)}</strong><small>SKU: ${esc(p.sku||"—")}</small></div><span class="status ${stockStatus(p)[0]}">${p.stock} left</span></div>`).join(""):`<div class="empty">No low-stock products.</div>`}</div>
      </div>
    </div>
    <div class="panel" style="margin-top:16px"><div class="section-head"><h3>Recent Sales</h3><button class="btn sm secondary" onclick="currentPage='reports';renderPage()">View All</button></div>${recentSalesTable(state.sales.slice().sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)).slice(0,6))}</div>`;
  drawSalesChart();
}

function recentSalesTable(rows){
  if(!rows.length){
    return `<div class="empty">No sales records found.</div>`;
  }

  return `
    <div class="table-wrap">
      <table class="table">
        <thead>
          <tr>
            <th>Receipt</th>
            <th>Date</th>
            <th>Cashier</th>
            <th>Items</th>
            <th>Total</th>
            
          </tr>
        </thead>

        <tbody>
          ${rows.map(s => `
            <tr>
              <td>
                <strong>${esc(s.receiptNo)}</strong>
              </td>

              <td>
                ${formatDateTime(s.createdAt)}
              </td>

              <td>
                ${esc(s.cashierName || "—")}
              </td>

              <td>
                ${s.items.map(i =>
                  `${esc(i.name)} x${i.qty}`
                ).join("<br>")}
              </td>

              <td>
                <strong>${money(s.total)}</strong>
              </td>


            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}
function drawSalesChart(){
  const c=$("salesChart");if(!c)return;const ctx=c.getContext("2d"),dpr=devicePixelRatio||1,w=c.clientWidth,h=c.clientHeight;c.width=w*dpr;c.height=h*dpr;ctx.scale(dpr,dpr);
  const labels=[],values=[];for(let i=6;i>=0;i--){const d=new Date();d.setHours(0,0,0,0);d.setDate(d.getDate()-i);labels.push(d.toLocaleDateString("en-PH",{weekday:"short"}));values.push(state.sales.filter(s=>todayISO(new Date(s.createdAt))===todayISO(d)).reduce((a,s)=>a+saleTotal(s),0))}
  const max=Math.max(...values,1), pad={l:42,r:15,t:15,b:32};ctx.strokeStyle="#dfe8e2";ctx.lineWidth=1;ctx.font="10px system-ui";ctx.fillStyle="#7b8981";
  for(let i=0;i<4;i++){const y=pad.t+(h-pad.t-pad.b)*i/3;ctx.beginPath();ctx.moveTo(pad.l,y);ctx.lineTo(w-pad.r,y);ctx.stroke();ctx.fillText(money(max*(1-i/3)).replace(".00",""),3,y+3)}
  ctx.strokeStyle="#138a50";ctx.lineWidth=3;ctx.beginPath();values.forEach((v,i)=>{const x=pad.l+(w-pad.l-pad.r)*i/6,y=pad.t+(h-pad.t-pad.b)*(1-v/max);i?ctx.lineTo(x,y):ctx.moveTo(x,y)});ctx.stroke();
  ctx.fillStyle="#138a50";values.forEach((v,i)=>{const x=pad.l+(w-pad.l-pad.r)*i/6,y=pad.t+(h-pad.t-pad.b)*(1-v/max);ctx.beginPath();ctx.arc(x,y,4,0,Math.PI*2);ctx.fill();ctx.fillStyle="#7b8981";ctx.fillText(labels[i],x-12,h-8);ctx.fillStyle="#138a50"});
}

function renderPOS(){
  const canSell = !!session;
  $("pageContent").innerHTML=`
    <div class="pos-layout">
      <div>
        <div class="panel">
          <div class="section-head">
            <div><h3>Products</h3><span class="muted">${state.products.length} product(s)</span></div>
            ${isOwner()?`<button class="btn primary" onclick="productModal()">+ Add Product</button>`:""}
          </div>
          <div class="search-row"><input id="posSearch" placeholder="Search product or SKU..."></div>
          <div id="posProducts" class="product-grid"></div>
        </div>
      </div>
      <div class="panel cart">
        <div class="section-head"><h3>Current Sale</h3><button class="btn sm danger" id="clearCart">Clear</button></div>
        <div id="cartList" class="cart-list"></div>
        <div class="cart-total"><span>Total</span><span id="cartTotal">₱0.00</span></div>
        <button class="btn primary full" id="checkoutBtn">Complete Sale</button>
      </div>
    </div>
    <div class="panel" style="margin-top:16px">
      <div class="section-head">
        <div><h3>Sales Records</h3><span class="muted">Daily, weekly, monthly and yearly</span></div>
        <div class="tabs" id="userSalesTabs">
          ${["day","week","month","year"].map(x=>`<button class="${reportRange===x?"active":""}" onclick="setUserSalesRange('${x}')">${x.charAt(0).toUpperCase()+x.slice(1)}</button>`).join("")}
        </div>
      </div>
      <div id="userSalesRecords"></div>
    </div>`;
  $("posSearch").oninput=()=>renderPOSProducts($("posSearch").value);
  $("clearCart").onclick=()=>{cart=[];renderPOSCart()};
  $("checkoutBtn").onclick=checkout;
  renderPOSProducts("");renderPOSCart();renderUserSalesRecords();
}
function renderUserSalesRecords(){
  const box=$("userSalesRecords");
  if(!box)return;
  const sales=filteredSales(reportRange==="all"?"month":reportRange)
    .slice().sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
  box.innerHTML=recentSalesTable(sales);
}
function setUserSalesRange(range){
  reportRange=range;
  const tabs=$("userSalesTabs");
  if(tabs)tabs.querySelectorAll("button").forEach(b=>b.classList.toggle("active",b.textContent.toLowerCase()===range));
  renderUserSalesRecords();
}
function renderPOSProducts(q){
  const list=state.products.filter(p=>(p.name+" "+(p.sku||"")).toLowerCase().includes(q.toLowerCase()));
  $("posProducts").innerHTML=list.length?list.map(p=>{
    const [cl,st]=stockStatus(p);
    return `<button class="product-card" ${p.stock<=0?"disabled":""} onclick="openSaleProduct('${p.id}')">
      <div class="product-card-top"><h4>${esc(p.name)}</h4><span class="product-action">Sell</span></div>
      <p>${esc(p.sku||"No SKU")} · <span class="status ${cl}">${st}</span></p>
      <div class="product-price">${money(p.price)}</div>
      <div class="product-stock">${p.stock} available</div>
    </button>`
  }).join(""):`<div class="empty" style="grid-column:1/-1">No products found.</div>`;
}
function openSaleProduct(id){
  const p=productById(id);
  if(!p||p.stock<=0){toast("Product is out of stock");return}
  openModal(`Add ${esc(p.name)}`,`
    <div class="sale-product-modal">
      <div class="info-box">
        <strong>${esc(p.name)}</strong><br>
        ${money(p.price)} each · ${p.stock} available
      </div>
      <div class="field" style="margin-top:14px">
        <label>Quantity *</label>
        <input id="saleQty" type="number" min="1" max="${p.stock}" step="1" value="1" oninput="updateSalePreview('${id}')">
      </div>
      <div class="sale-total-preview">
        <span>Total Price</span><strong id="salePreviewTotal">${money(p.price)}</strong>
      </div>
    </div>
    <div class="modal-actions">
      <button class="btn secondary" onclick="closeModal()">Cancel</button>
      <button class="btn primary" onclick="addSaleItem('${id}')">Add to Sale</button>
    </div>`);
}
function updateSalePreview(id){
  const p=productById(id), input=$("saleQty"), out=$("salePreviewTotal");
  if(!p||!input||!out)return;
  let qty=Math.floor(Number(input.value)||1);
  qty=Math.max(1,Math.min(p.stock,qty));
  input.value=qty;
  out.textContent=money(p.price*qty);
}
function addSaleItem(id){
  const p=productById(id), input=$("saleQty");
  if(!p||!input)return;
  const qty=Math.floor(Number(input.value));
  if(!qty||qty<1||qty>p.stock){toast("Enter a valid quantity");return}
  const item=cart.find(x=>x.productId===id);
  if(item){
    if(item.qty+qty>p.stock){toast("Not enough stock");return}
    item.qty+=qty;
  }else{
    cart.push({productId:id,qty});
  }
  closeModal();
  renderPOSCart();
  toast(`${qty} × ${p.name} added to sale`);
}
function addToCart(id){
  openSaleProduct(id);
}
function renderPOSCart(){
  const box=$("cartList");if(!box)return;
  box.innerHTML=cart.length?cart.map(i=>{
    const p=productById(i.productId);
    return `<div class="cart-item">
      <div><strong>${esc(p.name)}</strong><div class="muted">${money(p.price)} each</div>
      <div class="qty-controls"><button onclick="changeCart('${p.id}',-1)">−</button><span>${i.qty}</span><button onclick="changeCart('${p.id}',1)">+</button></div></div>
      <strong>${money(p.price*i.qty)}</strong>
    </div>`
  }).join(""):`<div class="empty">Cart is empty.<br>Add a product to begin.</div>`;
  $("cartTotal").textContent=money(cart.reduce((a,i)=>a+productById(i.productId).price*i.qty,0));
}
function changeCart(id,delta){
  const i=cart.find(x=>x.productId===id),p=productById(id);
  if(!i||!p)return;
  i.qty+=delta;
  if(i.qty<=0)cart=cart.filter(x=>x.productId!==id);
  else if(i.qty>p.stock)i.qty=p.stock;
  renderPOSCart();
}
function checkout(){
  if(!cart.length){toast("Cart is empty");return}
  const total=cart.reduce((a,i)=>a+productById(i.productId).price*i.qty,0);
  openModal("Complete Sale",`
    <div class="info-box">Total amount: <strong>${money(total)}</strong></div>
    <div class="field" style="margin-top:14px">
      <label>Customer / Note (optional)</label><input id="saleNote" placeholder="Optional note">
    </div>
    <div class="modal-actions">
      <button class="btn secondary" onclick="closeModal()">Cancel</button>
      <button class="btn primary" onclick="finishSale()">Confirm Sale</button>
    </div>`);
}
async function finishSale(){
  const items=cart.map(i=>{
    const p=productById(i.productId);
    return {productId:p.id,name:p.name,price:Number(p.price),qty:i.qty,total:Number(p.price)*i.qty};
  });
  for(const i of items){
    const p=productById(i.productId);
    if(!p||p.stock<i.qty){closeModal();toast("Stock changed. Please review the cart.");return}
  }
  const total=items.reduce((a,i)=>a+i.total,0),u=currentUser();
  const createdAt=new Date().toISOString();
  const clientSaleId=crypto.randomUUID();
  const sale={id:clientSaleId,clientSaleId,receiptNo:generateReceiptNo(),createdAt,cashierId:u.id,cashierName:u.name,items,total,note:$("saleNote")?.value.trim()||"",pendingSync:true};
  // Commit to local cache first so checkout works without internet.
  state.sales.push(sale);
  items.forEach(i=>{
    const p=productById(i.productId); p.stock-=i.qty;
    state.stockMovements.push({id:uid("mov"),productId:p.id,type:"SALE",quantity:-i.qty,note:sale.receiptNo,createdAt,userId:u.id});
  });
  saveDB();
  try {
    await window.MarioStoreAPI.queueSale({clientSaleId,items:items.map(i=>({productId:i.productId,quantity:i.qty})),note:sale.note});
    cart=[];closeModal();
    toast(navigator.onLine ? `Sale saved; syncing ${sale.receiptNo}` : `Sale saved offline • ${sale.receiptNo}`);
    renderPage();
    if(navigator.onLine) {
      const result=await window.MarioStoreAPI.syncPendingSales();
      if(result.pending===0){await tryRefreshFromServer();renderPage();toast(`Sale synced • ${sale.receiptNo}`);}
    }
  } catch(error) {
    // If IndexedDB cannot store the transaction, don't pretend it is safely queued.
    state.sales=state.sales.filter(x=>x.clientSaleId!==clientSaleId);
    items.forEach(i=>{const p=productById(i.productId);if(p)p.stock+=i.qty;});
    saveDB();closeModal();renderPage();toast('Could not save offline queue. Please retry.');
  }
}
function renderInventory(){
  $("pageContent").innerHTML=`
    <div class="panel">
      <div class="section-head">
        <div><h3>Inventory</h3><span class="muted">${isOwner()?"Manage products and stock":"View remaining stock and report shortages"}</span></div>
        <div class="section-actions">
          ${isOwner()?`<button class="btn primary" onclick="productModal()">+ Add Product</button>`:""}
        </div>
      </div>
      <div class="toolbar">
        <input class="grow" id="invSearch" placeholder="Search name, SKU, or category">
        <select id="stockFilter"><option value="all">All stock</option><option value="low">Low stock</option><option value="out">Out of stock</option><option value="ok">In stock</option></select>
      </div>
      <div id="inventoryTable"></div>
    </div>`;
  $("invSearch").oninput=renderInventoryTable;
  $("stockFilter").onchange=renderInventoryTable;
  renderInventoryTable();
}
function renderInventoryTable(){
  const q=($("invSearch")?.value||"").toLowerCase(),f=$("stockFilter")?.value||"all";
  const rows=state.products
    .filter(p=>(p.name+" "+(p.sku||"")+" "+(p.category||"")).toLowerCase().includes(q))
    .filter(p=>f==="all"||(f==="low"&&p.stock<=p.lowStock&&p.stock>0)||(f==="out"&&p.stock<=0)||(f==="ok"&&p.stock>p.lowStock));
  $("inventoryTable").innerHTML=rows.length?`
    <div class="table-wrap"><table class="table"><thead><tr>
      <th>Product</th><th>SKU</th><th>Category</th><th>Price</th><th>Remaining</th><th>Status</th><th>Actions</th>
    </tr></thead><tbody>
    ${rows.map(p=>{
      const [cl,st]=stockStatus(p);
      const reportButton=!isOwner()&&p.stock<=p.lowStock
        ? `<button class="btn sm warning" onclick="reportLowStock('${p.id}')">Report</button>`
        : "";
      const ownerButtons=isOwner()
        ? `<button class="btn sm secondary" onclick="productModal('${p.id}')">Edit</button>
           <button class="btn sm warning" onclick="restockModal('${p.id}')">Restock</button>
           <button class="btn sm danger" onclick="deleteProduct('${p.id}')">Delete</button>`
        : `${reportButton||"View only"}`;
      return `<tr>
        <td><strong>${esc(p.name)}</strong></td><td>${esc(p.sku||"—")}</td><td>${esc(p.category||"—")}</td>
        <td>${money(p.price)}</td><td><strong>${p.stock}</strong></td>
        <td><span class="status ${cl}">${st}</span></td><td>${ownerButtons}</td>
      </tr>`
    }).join("")}</tbody></table></div>`
    : `<div class="empty">No products found.</div>`;
}
function productModal(id){
  const p=id?productById(id):null;
  openModal(p?"Edit Product":"Add Product",`
    <div class="form-grid">
      <div class="field full"><label>Product Name *</label><input id="pName" value="${esc(p?.name||"")}"></div>
      <div class="field"><label>SKU</label><input id="pSku" value="${esc(p?.sku||"")}"></div>
      <div class="field"><label>Category</label><input id="pCategory" value="${esc(p?.category||"")}"></div>
      <div class="field"><label>Selling Price *</label><input id="pPrice" type="number" min="0" step="0.01" value="${p?.price??""}"></div>
      <div class="field">
        <label>${p?"Current Stock (read-only)":"Initial Stock *"}</label>
        <input id="pStock" type="number" min="0" step="1" value="${p?.stock??0}" ${p?"readonly":""}>
      </div>
      <div class="field"><label>Low Stock Alert At</label><input id="pLow" type="number" min="0" step="1" value="${p?.lowStock??5}"></div>
    </div>
    ${p?`<div class="info-box" style="margin-top:12px">Current stock is protected from accidental overwrite. Use <strong>Restock</strong> to add quantity.</div>`:""}
    <div class="modal-actions"><button class="btn secondary" onclick="closeModal()">Cancel</button><button class="btn primary" onclick="saveProduct('${id||""}')">Save Product</button></div>`);
}
async function saveProduct(id){
  const name=$("pName").value.trim(),price=Number($("pPrice").value),stock=Number($("pStock").value),low=Number($("pLow").value);
  const sku=$("pSku").value.trim(),category=$("pCategory").value.trim();
  if(!name||!Number.isFinite(price)||price<0||(!id&&(!Number.isInteger(stock)||stock<0))||!Number.isInteger(low)||low<0){toast("Please enter valid product details");return}
  if(!navigator.onLine){toast('Connect to the internet to manage products.');return}
  try{
    if(id) await api(`/products/${id}`,{method:'PATCH',body:JSON.stringify({name,sku:sku||null,category:category||null,price,lowStock:low})});
    else await api('/products',{method:'POST',body:JSON.stringify({name,sku:sku||null,category:category||null,price,stock,lowStock:low})});
    await refreshFromServer();closeModal();toast(id?'Product updated':'Product added');renderPage();
  }catch(e){toast(e.message||'Could not save product');}
}
function restockModal(id){
  const p=productById(id);
  openModal("Restock Product",`
    <div class="info-box"><strong>${esc(p.name)}</strong><br>Current stock: <strong>${p.stock}</strong><br>New stock will be added to the current balance.</div>
    <div class="form-grid" style="margin-top:14px">
      <div class="field"><label>Quantity to Add *</label><input id="restockQty" type="number" min="1" step="1" value="1"></div>
      <div class="field"><label>Note</label><input id="restockNote" placeholder="Supplier / reason"></div>
    </div>
    <div class="modal-actions"><button class="btn secondary" onclick="closeModal()">Cancel</button><button class="btn primary" onclick="doRestock('${id}')">Restock</button></div>`);
}
async function doRestock(id){
  const qty=Math.floor(Number($("restockQty").value)),note=$("restockNote").value.trim();
  if(!qty||qty<1){toast("Enter a valid quantity");return}
  if(!navigator.onLine){toast('Connect to the internet to restock.');return}
  try{
    await api(`/products/${id}/restock`,{method:'POST',body:JSON.stringify({quantity:qty,note})});
    await refreshFromServer();closeModal();toast('Stock restocked');renderPage();
  }catch(e){toast(e.message||'Could not restock product');}
}
async function deleteProduct(id){
  const p=productById(id);if(!p)return;
  if(!confirm(`Remove "${p.name}" from active inventory? Historical sales will remain.`))return;
  if(!navigator.onLine){toast('Connect to the internet to manage products.');return}
  try{await api(`/products/${id}`,{method:'DELETE'});await refreshFromServer();toast('Product removed from inventory');renderPage();}
  catch(e){toast(e.message||'Could not remove product');}
}
function reportLowStock(id){
  const p=productById(id);
  if(!p)return;
  openModal("Stock Report",`
    <div class="danger-box"><strong>${esc(p.name)}</strong> currently has <strong>${p.stock}</strong> remaining. Low-stock level is ${p.lowStock}.</div>
    <p class="muted" style="margin:12px 0 0">Tell the Admin to restock this product.</p>
    <div class="modal-actions"><button class="btn primary" onclick="closeModal()">Okay</button></div>`);
}
function renderReports(){
  const sales=filteredSales(reportRange),revenue=sales.reduce((a,s)=>a+s.total,0),items=sales.reduce((a,s)=>a+s.items.reduce((x,i)=>x+i.qty,0),0),avg=sales.length?revenue/sales.length:0;
  $("pageContent").innerHTML=`
    <div class="grid report-cards">
      <div class="stat-card"><div class="stat-top">Revenue</div><div class="stat-value">${money(revenue)}</div></div>
      <div class="stat-card"><div class="stat-top">Transactions</div><div class="stat-value">${sales.length}</div></div>
      <div class="stat-card"><div class="stat-top">Items Sold</div><div class="stat-value">${items}</div><div class="stat-note">Avg. sale ${money(avg)}</div></div>
    </div>
    <div class="panel">
      <div class="section-head"><h3>Sales Records</h3><div class="filters"><div class="tabs">${["day","week","month","year","all"].map(x=>`<button class="${reportRange===x?"active":""}" onclick="setReportRange('${x}')">${x==="all"?"All":x.charAt(0).toUpperCase()+x.slice(1)}</button>`).join("")}</div><button class="btn primary" onclick="exportSales('${reportRange}')">Download CSV</button></div></div>
      ${recentSalesTable(sales.slice().sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)))}
    </div>`;
}
function setReportRange(x){reportRange=x;renderReports()}
function exportSales(range){
  const rows=[["Receipt","Date","Cashier","Items","Total","Note"]];
  filteredSales(range).forEach(s=>rows.push([s.receiptNo,formatDateTime(s.createdAt),s.cashierName,s.items.map(i=>`${i.name} x${i.qty}`).join(" | "),Number(s.total).toFixed(2),s.note||""]));
  csvDownload(`mario-store-sales-${range}-${todayISO()}.csv`,rows);toast("Sales CSV downloaded");
}

function renderUsers(){
  const users=state.users.filter(u=>u.role==="Tindero");
  $("pageContent").innerHTML=`<div class="panel"><div class="section-head"><h3>Tindero Accounts</h3><button class="btn primary" onclick="userModal()">+ Create Tindero</button></div>
  ${users.length?`<div class="table-wrap"><table class="table"><thead><tr><th>Name</th><th>Email</th><th>Status</th><th>Created</th><th>Actions</th></tr></thead><tbody>${users.map(u=>`<tr><td><strong>${esc(u.name)}</strong></td><td>${esc(u.email)}</td><td><span class="status ${u.active!==false?"ok":"out"}">${u.active!==false?"Active":"Disabled"}</span></td><td>${formatDate(u.createdAt)}</td><td><button class="btn sm secondary" onclick="toggleUser('${u.id}')">${u.active!==false?"Disable":"Enable"}</button> <button class="btn sm danger" onclick="deleteUser('${u.id}')">Delete</button></td></tr>`).join("")}</tbody></table></div>`:`<div class="empty">No Tindero accounts yet. Create one for your sales staff.</div>`}
  <div class="info-box" style="margin-top:15px">Passwords are hashed with bcrypt on the server before being stored. Account management requires an internet connection.</div></div>`;
}
function userModal(){
  openModal("Create Tindero Account",`<div class="form-grid"><div class="field full"><label>Full Name *</label><input id="uName"></div><div class="field"><label>Email *</label><input id="uEmail" type="email"></div><div class="field"><label>Password *</label><input id="uPass" type="password" minlength="12" autocomplete="new-password"></div></div><div class="modal-actions"><button class="btn secondary" onclick="closeModal()">Cancel</button><button class="btn primary" onclick="createUser()">Create Account</button></div>`);
}
async function createUser(){
  const name=$("uName").value.trim(),email=$("uEmail").value.trim().toLowerCase(),password=$("uPass").value;
  if(!name||!email||password.length<12){toast("Enter name, valid email, and password of at least 12 characters");return}
  if(!navigator.onLine){toast('Connect to the internet to create accounts.');return}
  try{
    await api('/users',{method:'POST',body:JSON.stringify({name,email,password})});
    await refreshFromServer();closeModal();toast('Tindero account created');renderPage();
  }catch(e){toast(e.message||'Could not create account');}
}
async function toggleUser(id){
  const u=state.users.find(x=>x.id===id);if(!u)return;
  if(!navigator.onLine){toast('Connect to the internet to manage accounts.');return}
  try{await api(`/users/${id}/active`,{method:'PATCH',body:JSON.stringify({active:!u.active})});await refreshFromServer();renderPage();toast(!u.active?'Account enabled':'Account disabled');}
  catch(e){toast(e.message||'Could not update account');}
}
async function deleteUser(id){
  if(!confirm("Delete this Tindero account?"))return;
  if(!navigator.onLine){toast('Connect to the internet to manage accounts.');return}
  try{await api(`/users/${id}`,{method:'DELETE'});await refreshFromServer();renderPage();toast('Account deleted');}
  catch(e){toast(e.message||'Could not delete account');}
}

function renderBackup(){
  $("pageContent").innerHTML=`
    <div class="grid backup-grid">
      <div class="panel big-action"><h3>Export Cached Data</h3><p>Download a copy of the data currently cached on this device. The PostgreSQL database remains the source of truth while online.</p><button class="btn primary" onclick="downloadJSON()">Download Backup</button></div>
      <div class="panel big-action"><h3>Export Sales CSV</h3><p>Download sales records in spreadsheet-friendly CSV format.</p><button class="btn primary" onclick="exportSales('all')">Download Sales CSV</button></div>
      <div class="panel big-action"><h3>Refresh From Server</h3><p>Fetch the latest products, sales, users, and stock records from PostgreSQL.</p><button class="btn secondary" onclick="manualRefresh()">Refresh Data</button></div>
    </div>
    <div class="panel" style="margin-top:16px"><h3>Cached Data on This Device</h3><div class="table-wrap"><table class="table"><tbody><tr><td>Products</td><td>${state.products.length}</td></tr><tr><td>Sales</td><td>${state.sales.length}</td></tr><tr><td>Users</td><td>${state.users.length}</td></tr><tr><td>Stock movements</td><td>${state.stockMovements.length}</td></tr></tbody></table></div></div>`;
}
async function manualRefresh(){
  if(!navigator.onLine){toast('You are offline; showing cached data.');return}
  try{await refreshFromServer();renderPage();toast('Data refreshed from database');}
  catch(e){toast(e.message||'Could not refresh data');}
}
// Backups are exports only; importing a local JSON file cannot overwrite server data safely.
function restoreJSON(){toast('Restore is disabled for server-backed data. Use a database backup workflow.')}
function resetDB(){toast('Local reset is disabled to protect server data.')}

login();setupNav();
if('serviceWorker' in navigator){navigator.serviceWorker.register('/sw.js').catch(err=>console.warn('Offline app cache unavailable:',err));}
if(session)startApp();
window.addEventListener("online", async ()=>{ if(session){ await window.MarioStoreAPI.syncPendingSales().catch(()=>{}); if(await tryRefreshFromServer()) renderPage(); } });
window.addEventListener("mario-store-sync", async e=>{ if(e.detail?.synced && session){ await tryRefreshFromServer(); if(!$("app").classList.contains("hidden"))renderPage(); toast(`${e.detail.synced} offline sale(s) synchronized`); } });

