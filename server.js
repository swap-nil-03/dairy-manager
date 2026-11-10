const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET;
const pool = process.env.DATABASE_URL ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 5 }) : null;
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

async function initDb() {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users(id BIGSERIAL PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS customers(id BIGSERIAL PRIMARY KEY, name TEXT NOT NULL, phone TEXT, address TEXT, milk_type TEXT NOT NULL CHECK(milk_type IN ('cow','buffalo')), daily_qty DOUBLE PRECISION NOT NULL DEFAULT 0, morning_qty DOUBLE PRECISION NOT NULL DEFAULT 0, evening_qty DOUBLE PRECISION NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, created_at TIMESTAMPTZ DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS rates(id BIGSERIAL PRIMARY KEY, milk_type TEXT NOT NULL CHECK(milk_type IN ('cow','buffalo')), price DOUBLE PRECISION NOT NULL, effective_month TEXT NOT NULL, UNIQUE(milk_type,effective_month));
    CREATE TABLE IF NOT EXISTS deliveries(id BIGSERIAL PRIMARY KEY, customer_id BIGINT NOT NULL REFERENCES customers(id) ON DELETE CASCADE, delivery_date DATE NOT NULL, session TEXT NOT NULL CHECK(session IN ('morning','evening')), milk_type TEXT NOT NULL CHECK(milk_type IN ('cow','buffalo')), regular_qty DOUBLE PRECISION NOT NULL DEFAULT 0, extra_qty DOUBLE PRECISION NOT NULL DEFAULT 0, delivered INTEGER NOT NULL DEFAULT 1, note TEXT, UNIQUE(customer_id,delivery_date,session));
    CREATE TABLE IF NOT EXISTS payments(id BIGSERIAL PRIMARY KEY, customer_id BIGINT NOT NULL REFERENCES customers(id) ON DELETE CASCADE, payment_date DATE NOT NULL, amount DOUBLE PRECISION NOT NULL, method TEXT NOT NULL DEFAULT 'Cash', note TEXT);
  `);
  const users = await pool.query('SELECT id FROM users LIMIT 1');
  if (!users.rowCount) await pool.query('INSERT INTO users(username,password_hash) VALUES($1,$2)', ['admin', bcrypt.hashSync('admin123', 10)]);
}
function auth(req,res,next){
  const token=(req.headers.authorization||'').replace(/^Bearer\s+/i,'');
  try { if (!JWT_SECRET) throw new Error('JWT_SECRET missing'); req.user=jwt.verify(token,JWT_SECRET); next(); }
  catch { res.status(401).json({error:'Login required'}); }
}
const api=express.Router();
api.get('/health', async (req,res)=>{ try { if(!pool) return res.status(503).json({ok:false,database:'DATABASE_URL missing'}); await pool.query('SELECT 1'); res.json({ok:true,database:'connected'}); } catch(e){res.status(503).json({ok:false,database:'unavailable'});} });
api.post('/login',async(req,res)=>{
  try { const {username,password}=req.body||{}; const q=await pool.query('SELECT * FROM users WHERE username=$1',[username||'']); const user=q.rows[0];
    if(!user || !bcrypt.compareSync(password||'',user.password_hash)) return res.status(401).json({error:'Username किंवा password चुकीचा आहे'});
    if(!JWT_SECRET) return res.status(500).json({error:'Server configuration missing'});
    res.json({token:jwt.sign({id:user.id,username:user.username},JWT_SECRET,{expiresIn:'12h'}),username:user.username});
  } catch(e){res.status(503).json({error:'Database जोडलेला नाही. DATABASE_URL तपासा.'});}
});
api.use(auth);
api.post('/change-password',async(req,res)=>{const {currentPassword,newPassword}=req.body||{};const q=await pool.query('SELECT * FROM users WHERE id=$1',[req.user.id]);const u=q.rows[0];if(!u||!bcrypt.compareSync(currentPassword||'',u.password_hash))return res.status(400).json({error:'Current password चुकीचा आहे'});if(!newPassword||newPassword.length<8)return res.status(400).json({error:'नवीन password किमान 8 अक्षरांचा हवा'});await pool.query('UPDATE users SET password_hash=$1 WHERE id=$2',[bcrypt.hashSync(newPassword,10),u.id]);res.json({ok:true});});
api.get('/customers',async(req,res)=>res.json((await pool.query('SELECT * FROM customers ORDER BY active DESC,name')).rows));
api.post('/customers',async(req,res)=>{const c=req.body||{};if(!c.name?.trim()||!['cow','buffalo'].includes(c.milk_type))return res.status(400).json({error:'नाव आणि दूध प्रकार आवश्यक आहेत'});const q=await pool.query(`INSERT INTO customers(name,phone,address,milk_type,daily_qty,morning_qty,evening_qty,active) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,[c.name.trim(),c.phone||'',c.address||'',c.milk_type,Number(c.daily_qty)||0,Number(c.morning_qty)||0,Number(c.evening_qty)||0,c.active===false?0:1]);res.json({id:q.rows[0].id});});
api.put('/customers/:id',async(req,res)=>{const c=req.body||{};await pool.query(`UPDATE customers SET name=$1,phone=$2,address=$3,milk_type=$4,daily_qty=$5,morning_qty=$6,evening_qty=$7,active=$8 WHERE id=$9`,[c.name,c.phone||'',c.address||'',c.milk_type,Number(c.daily_qty)||0,Number(c.morning_qty)||0,Number(c.evening_qty)||0,c.active?1:0,req.params.id]);res.json({ok:true});});
api.delete('/customers/:id',async(req,res)=>{await pool.query('DELETE FROM customers WHERE id=$1',[req.params.id]);res.json({ok:true});});
api.get('/rates',async(req,res)=>res.json((await pool.query('SELECT * FROM rates ORDER BY effective_month DESC,milk_type')).rows));
api.post('/rates',async(req,res)=>{const {milk_type,price,effective_month}=req.body||{};if(!['cow','buffalo'].includes(milk_type)||!(Number(price)>0)||!/^\d{4}-\d{2}$/.test(effective_month||''))return res.status(400).json({error:'योग्य दूध प्रकार, दर आणि महिना भरा'});await pool.query(`INSERT INTO rates(milk_type,price,effective_month) VALUES($1,$2,$3) ON CONFLICT(milk_type,effective_month) DO UPDATE SET price=EXCLUDED.price`,[milk_type,Number(price),effective_month]);res.json({ok:true});});
api.get('/deliveries',async(req,res)=>{const date=req.query.date||new Date().toISOString().slice(0,10),session=req.query.session||'morning';res.json((await pool.query(`SELECT c.id customer_id,c.name,c.phone,c.milk_type,c.daily_qty,c.morning_qty,c.evening_qty,d.id,d.delivery_date,d.session,d.regular_qty,d.extra_qty,d.delivered,d.note FROM customers c LEFT JOIN deliveries d ON d.customer_id=c.id AND d.delivery_date=$1 AND d.session=$2 WHERE c.active=1 ORDER BY c.name`,[date,session])).rows);});
api.post('/deliveries/bulk',async(req,res)=>{const {date,session,entries}=req.body||{};if(!/^\d{4}-\d{2}-\d{2}$/.test(date||'')||!['morning','evening'].includes(session)||!Array.isArray(entries))return res.status(400).json({error:'Invalid delivery data'});const client=await pool.connect();try{await client.query('BEGIN');for(const e of entries){await client.query(`INSERT INTO deliveries(customer_id,delivery_date,session,milk_type,regular_qty,extra_qty,delivered,note) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(customer_id,delivery_date,session) DO UPDATE SET milk_type=EXCLUDED.milk_type,regular_qty=EXCLUDED.regular_qty,extra_qty=EXCLUDED.extra_qty,delivered=EXCLUDED.delivered,note=EXCLUDED.note`,[e.customer_id,date,session,e.milk_type,e.delivered?(Number(e.regular_qty)||0):0,e.delivered?(Number(e.extra_qty)||0):0,e.delivered?1:0,e.note||'']);}await client.query('COMMIT');res.json({ok:true});}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}});
api.get('/report',async(req,res)=>{const month=req.query.month||new Date().toISOString().slice(0,7),from=month+'-01',to=new Date(Number(month.slice(0,4)),Number(month.slice(5,7)),0).toISOString().slice(0,10);const customers=(await pool.query(`SELECT c.id,c.name,c.phone,c.milk_type,COALESCE(SUM(CASE WHEN d.delivered=1 THEN d.regular_qty+d.extra_qty ELSE 0 END),0) litres,COALESCE(SUM(CASE WHEN d.delivered=1 THEN (d.regular_qty+d.extra_qty)*COALESCE(r.price,0) ELSE 0 END),0) bill FROM customers c LEFT JOIN deliveries d ON d.customer_id=c.id AND d.delivery_date BETWEEN $1 AND $2 LEFT JOIN rates r ON r.milk_type=d.milk_type AND r.effective_month=(SELECT MAX(r2.effective_month) FROM rates r2 WHERE r2.milk_type=d.milk_type AND r2.effective_month<=to_char(d.delivery_date,'YYYY-MM')) GROUP BY c.id ORDER BY c.name`,[from,to])).rows;const paid=(await pool.query('SELECT customer_id,COALESCE(SUM(amount),0) paid FROM payments WHERE payment_date BETWEEN $1 AND $2 GROUP BY customer_id',[from,to])).rows;const pmap=Object.fromEntries(paid.map(x=>[x.customer_id,x.paid]));res.json({month,customers:customers.map(c=>({...c,paid:pmap[c.id]||0,balance:Math.max(0,Number(c.bill)-(Number(pmap[c.id])||0))})),totals:{litres:customers.reduce((s,c)=>s+Number(c.litres),0),bill:customers.reduce((s,c)=>s+Number(c.bill),0),paid:paid.reduce((s,p)=>s+Number(p.paid),0)}});});
api.get('/payments',async(req,res)=>res.json((await pool.query('SELECT p.*,c.name FROM payments p JOIN customers c ON c.id=p.customer_id ORDER BY payment_date DESC,p.id DESC')).rows));
api.post('/payments',async(req,res)=>{const p=req.body||{};if(!(Number(p.amount)>0)||!p.customer_id||!/^\d{4}-\d{2}-\d{2}$/.test(p.payment_date||''))return res.status(400).json({error:'ग्राहक, तारीख आणि रक्कम आवश्यक'});const q=await pool.query('INSERT INTO payments(customer_id,payment_date,amount,method,note) VALUES($1,$2,$3,$4,$5) RETURNING id',[p.customer_id,p.payment_date,Number(p.amount),p.method||'Cash',p.note||'']);res.json({id:q.rows[0].id});});
api.get('/dashboard',async(req,res)=>{const today=req.query.date||new Date().toISOString().slice(0,10),month=today.slice(0,7);const customers=(await pool.query('SELECT COUNT(*) n FROM customers WHERE active=1')).rows[0].n;const todayLitres=(await pool.query('SELECT COALESCE(SUM(regular_qty+extra_qty),0) litres FROM deliveries WHERE delivery_date=$1 AND delivered=1',[today])).rows[0].litres;const monthLitres=(await pool.query(`SELECT COALESCE(SUM(regular_qty+extra_qty),0) litres FROM deliveries WHERE to_char(delivery_date,'YYYY-MM')=$1 AND delivered=1`,[month])).rows[0].litres;const rates=(await pool.query(`SELECT milk_type,price FROM rates r WHERE effective_month=(SELECT MAX(effective_month) FROM rates r2 WHERE r2.milk_type=r.milk_type AND effective_month<=$1)`,[month])).rows;res.json({customers:Number(customers),todayLitres:Number(todayLitres),monthLitres:Number(monthLitres),rates});});
api.get('/export',async(req,res)=>{const data={exportedAt:new Date().toISOString()};for(const t of ['customers','rates','deliveries','payments'])data[t]=(await pool.query(`SELECT * FROM ${t}`)).rows;res.setHeader('Content-Disposition','attachment; filename="dairy-backup.json"');res.json(data);});
app.use('/api',api);
app.get('/api/*',(req,res)=>res.status(404).json({error:'API route not found'}));
app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
app.use((err,req,res,next)=>{console.error(err);res.status(500).json({error:'Server error'});});
app.listen(PORT,'0.0.0.0',()=>console.log(`Dairy Manager running on port ${PORT}`));
initDb().then(()=>console.log('Database ready')).catch(e=>console.error('Database initialization failed:',e.message));
