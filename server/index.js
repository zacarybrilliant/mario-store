import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import mysql from 'mysql2/promise';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const app=express();
const pool=mysql.createPool({
  host:process.env.DB_HOST||'127.0.0.1', port:Number(process.env.DB_PORT||3306),
  user:process.env.DB_USER||'root', password:process.env.DB_PASSWORD||'', database:process.env.DB_NAME||'mario_store',
  waitForConnections:true, connectionLimit:10, queueLimit:0, timezone:'Z', decimalNumbers:true
});
const PORT=Number(process.env.PORT||3000), JWT_SECRET=process.env.JWT_SECRET;
if(!JWT_SECRET||JWT_SECRET.length<32){console.error('Set JWT_SECRET in .env to a random secret at least 32 characters long.');process.exit(1);}
app.use(helmet({contentSecurityPolicy:false}));
app.use(cors({origin:process.env.CORS_ORIGIN?process.env.CORS_ORIGIN.split(','):true,credentials:true}));
app.use(express.json({limit:'1mb'}));
app.use('/api',rateLimit({windowMs:60000,limit:180}));
const here=path.dirname(fileURLToPath(import.meta.url));
app.use(express.static(path.join(here,'../public')));
const [rows]=await pool.query('SELECT 1 AS ok');
console.log('MySQL database connection ready:',rows[0].ok===1);
const query=async(sql,params=[])=>{const [r]=await pool.execute(sql,params);return r;};
const publicUser=u=>({id:u.id,name:u.name,email:u.email,role:u.role,active:Boolean(u.active),createdAt:u.created_at});
const asyncRoute=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
function auth(req,res,next){const h=req.headers.authorization||'';try{if(!h.startsWith('Bearer '))throw 0;req.user=jwt.verify(h.slice(7),JWT_SECRET);next();}catch{res.status(401).json({error:'Sign in required'});}}
function owner(req,res,next){if(req.user?.role!=='Owner')return res.status(403).json({error:'Owner permission required'});next();}
function duplicate(e){return e.code==='ER_DUP_ENTRY';}

app.get('/api/health',asyncRoute(async(req,res)=>{await query('SELECT 1');res.json({ok:true,database:'connected',engine:'mysql',time:new Date().toISOString()});}));
app.post('/api/auth/login',asyncRoute(async(req,res)=>{
 const email=String(req.body.email||'').trim().toLowerCase(),password=String(req.body.password||'');
 const r=await query('SELECT * FROM users WHERE LOWER(email)=LOWER(?) AND active=1 LIMIT 1',[email]);const u=r[0];
 if(!u||!(await bcrypt.compare(password,u.password_hash)))return res.status(401).json({error:'Invalid email or password'});
 const token=jwt.sign({sub:u.id,role:u.role,name:u.name},JWT_SECRET,{expiresIn:'12h'});res.json({token,user:publicUser(u)});
}));
app.get('/api/auth/me',auth,asyncRoute(async(req,res)=>{const r=await query('SELECT * FROM users WHERE id=? AND active=1',[req.user.sub]);if(!r.length)return res.status(401).json({error:'Account disabled or not found'});res.json({user:publicUser(r[0])});}));

app.get('/api/products',auth,asyncRoute(async(req,res)=>{
 const products=await query('SELECT id,name,sku,category,price,stock,low_stock AS lowStock,created_at AS createdAt FROM products WHERE active=1 ORDER BY name');res.json({products});
}));
app.post('/api/products',auth,owner,asyncRoute(async(req,res)=>{
 const {name,sku=null,category=null,price,stock=0,lowStock=5}=req.body;
 if(!String(name||'').trim()||!Number.isFinite(Number(price))||Number(price)<0||!Number.isInteger(Number(stock))||Number(stock)<0||!Number.isInteger(Number(lowStock))||Number(lowStock)<0)return res.status(400).json({error:'Invalid product details'});
 const id=randomUUID(),conn=await pool.getConnection();try{await conn.beginTransaction();await conn.execute('INSERT INTO products(id,name,sku,category,price,stock,low_stock) VALUES(?,?,?,?,?,?,?)',[id,String(name).trim(),sku||null,category||null,Number(price),Number(stock),Number(lowStock)]);if(Number(stock)>0)await conn.execute('INSERT INTO stock_movements(id,product_id,type,quantity,note,user_id) VALUES(?,?,\'INITIAL\',?,?,?)',[randomUUID(),id,Number(stock),'Initial stock',req.user.sub]);await conn.commit();const p=(await query('SELECT id,name,sku,category,price,stock,low_stock AS lowStock,created_at AS createdAt FROM products WHERE id=?',[id]))[0];res.status(201).json({product:p});}catch(e){await conn.rollback();if(duplicate(e))return res.status(409).json({error:'SKU already exists'});throw e;}finally{conn.release();}
}));
app.patch('/api/products/:id',auth,owner,asyncRoute(async(req,res)=>{
 const {name,sku=null,category=null,price,lowStock=5}=req.body;if(!String(name||'').trim()||!Number.isFinite(Number(price))||Number(price)<0||!Number.isInteger(Number(lowStock))||Number(lowStock)<0)return res.status(400).json({error:'Invalid product details'});
 try{const r=await query('UPDATE products SET name=?,sku=?,category=?,price=?,low_stock=? WHERE id=? AND active=1',[String(name).trim(),sku||null,category||null,Number(price),Number(lowStock),req.params.id]);if(!r.affectedRows)return res.status(404).json({error:'Product not found'});const p=(await query('SELECT id,name,sku,category,price,stock,low_stock AS lowStock,created_at AS createdAt FROM products WHERE id=?',[req.params.id]))[0];res.json({product:p});}catch(e){if(duplicate(e))return res.status(409).json({error:'SKU already exists'});throw e;}
}));
app.post('/api/products/:id/restock',auth,owner,asyncRoute(async(req,res)=>{
 const qty=Number(req.body.quantity),note=String(req.body.note||'');if(!Number.isInteger(qty)||qty<1)return res.status(400).json({error:'Quantity must be a positive whole number'});
 const c=await pool.getConnection();try{await c.beginTransaction();const [r]=await c.execute('UPDATE products SET stock=stock+? WHERE id=? AND active=1',[qty,req.params.id]);if(!r.affectedRows){await c.rollback();return res.status(404).json({error:'Product not found'});}await c.execute('INSERT INTO stock_movements(id,product_id,type,quantity,note,user_id) VALUES(?,?,\'RESTOCK\',?,?,?)',[randomUUID(),req.params.id,qty,note,req.user.sub]);await c.commit();const p=(await query('SELECT id,stock FROM products WHERE id=?',[req.params.id]))[0];res.json(p);}catch(e){await c.rollback();throw e;}finally{c.release();}
}));
app.delete('/api/products/:id',auth,owner,asyncRoute(async(req,res)=>{const r=await query('UPDATE products SET active=0 WHERE id=? AND active=1',[req.params.id]);if(!r.affectedRows)return res.status(404).json({error:'Product not found'});res.json({ok:true});}));

app.get('/api/users',auth,owner,asyncRoute(async(req,res)=>{const users=await query('SELECT id,name,email,role,active,created_at AS createdAt FROM users ORDER BY created_at DESC');res.json({users:users.map(u=>({...u,active:Boolean(u.active)}))});}));
app.post('/api/users',auth,owner,asyncRoute(async(req,res)=>{
 const name=String(req.body.name||'').trim(),email=String(req.body.email||'').trim().toLowerCase(),password=String(req.body.password||'');if(!name||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||password.length<12)return res.status(400).json({error:'Name, valid email, and password of at least 12 characters are required'});
 const hash=await bcrypt.hash(password,12);try{const id=randomUUID();await query('INSERT INTO users(id,name,email,password_hash,role) VALUES(?,?,?,?,\'Tindero\')',[id,name,email,hash]);const u=(await query('SELECT id,name,email,role,active,created_at AS createdAt FROM users WHERE id=?',[id]))[0];res.status(201).json({user:{...u,active:Boolean(u.active)}});}catch(e){if(duplicate(e))return res.status(409).json({error:'Email already exists'});throw e;}
}));
app.patch('/api/users/:id/active',auth,owner,asyncRoute(async(req,res)=>{const r=await query('UPDATE users SET active=? WHERE id=? AND role=\'Tindero\'',[req.body.active?1:0,req.params.id]);if(!r.affectedRows)return res.status(404).json({error:'Tindero not found'});const u=(await query('SELECT id,name,email,role,active,created_at AS createdAt FROM users WHERE id=?',[req.params.id]))[0];res.json({user:{...u,active:Boolean(u.active)}});}));
app.delete('/api/users/:id',auth,owner,asyncRoute(async(req,res)=>{if(req.params.id===req.user.sub)return res.status(400).json({error:'Cannot delete the signed-in account'});const r=await query('DELETE FROM users WHERE id=? AND role=\'Tindero\'',[req.params.id]);if(!r.affectedRows)return res.status(404).json({error:'Tindero not found'});res.json({ok:true});}));

app.post('/api/sales',auth,asyncRoute(async(req,res)=>{
 const clientSaleId=String(req.body.clientSaleId||''),items=Array.isArray(req.body.items)?req.body.items:[];if(!clientSaleId||!items.length||items.length>100)return res.status(400).json({error:'Invalid sale payload'});
 const prior=await query('SELECT id,receipt_no AS receiptNo,total,created_at AS createdAt FROM sales WHERE client_sale_id=?',[clientSaleId]);if(prior.length)return res.json({sale:prior[0],duplicate:true});
 const c=await pool.getConnection();try{await c.beginTransaction();let total=0;const clean=[];for(const item of items){const qty=Number(item.quantity);if(!Number.isInteger(qty)||qty<1)throw Object.assign(new Error('Invalid item quantity'),{status:400});const [pr]=await c.execute('SELECT id,name,price,stock FROM products WHERE id=? AND active=1 FOR UPDATE',[item.productId]);if(!pr.length)throw Object.assign(new Error('Product not found'),{status:409});const p=pr[0];if(p.stock<qty)throw Object.assign(new Error(`Insufficient stock for ${p.name}`),{status:409});const line=Number((Number(p.price)*qty).toFixed(2));total=Number((total+line).toFixed(2));clean.push({productId:p.id,name:p.name,price:Number(p.price),qty,total:line});}
 const saleId=randomUUID(),receiptNo='MS-'+Date.now().toString(36).toUpperCase()+'-'+randomUUID().slice(0,6).toUpperCase();await c.execute('INSERT INTO sales(id,receipt_no,cashier_id,cashier_name,note,total,client_sale_id) VALUES(?,?,?,?,?,?,?)',[saleId,receiptNo,req.user.sub,req.user.name,String(req.body.note||''),total,clientSaleId]);
 for(const i of clean){await c.execute('UPDATE products SET stock=stock-? WHERE id=?',[i.qty,i.productId]);await c.execute('INSERT INTO sale_items(id,sale_id,product_id,product_name,unit_price,quantity,line_total) VALUES(?,?,?,?,?,?,?)',[randomUUID(),saleId,i.productId,i.name,i.price,i.qty,i.total]);await c.execute('INSERT INTO stock_movements(id,product_id,type,quantity,note,user_id) VALUES(?,?,\'SALE\',?,?,?)',[randomUUID(),i.productId,-i.qty,receiptNo,req.user.sub]);}
 await c.commit();const sale=(await query('SELECT id,receipt_no AS receiptNo,total,created_at AS createdAt FROM sales WHERE id=?',[saleId]))[0];res.status(201).json({sale:{...sale,items:clean}});
 }catch(e){await c.rollback();if(duplicate(e)){const r=await query('SELECT id,receipt_no AS receiptNo,total,created_at AS createdAt FROM sales WHERE client_sale_id=?',[clientSaleId]);if(r.length)return res.json({sale:r[0],duplicate:true});}res.status(e.status||500).json({error:e.status?e.message:'Could not complete sale'});}finally{c.release();}
}));
app.get('/api/sales',auth,asyncRoute(async(req,res)=>{const sales=await query(`SELECT s.id,s.receipt_no AS receiptNo,s.cashier_id AS cashierId,s.cashier_name AS cashierName,s.note,s.total,s.created_at AS createdAt FROM sales s ORDER BY s.created_at DESC LIMIT 5000`);for(const s of sales){s.items=await query('SELECT product_id AS productId,product_name AS name,unit_price AS price,quantity AS qty,line_total AS total FROM sale_items WHERE sale_id=?',[s.id]);}res.json({sales});}));
app.get('/api/stock-movements',auth,owner,asyncRoute(async(req,res)=>{const stockMovements=await query('SELECT id,product_id AS productId,type,quantity,note,user_id AS userId,created_at AS createdAt FROM stock_movements ORDER BY created_at DESC LIMIT 5000');res.json({stockMovements});}));

app.use('/api',(req,res)=>res.status(404).json({error:'API endpoint not found'}));
app.use((err,req,res,next)=>{console.error(err);if(duplicate(err))return res.status(409).json({error:'A record with that value already exists'});res.status(500).json({error:'Internal server error'});});
const server=app.listen(PORT,()=>console.log(`Mario Store server listening on http://localhost:${PORT}`));
process.on('SIGINT',async()=>{server.close();await pool.end();process.exit(0);});
