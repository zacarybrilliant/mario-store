import 'dotenv/config';
import bcrypt from 'bcryptjs';
import mysql from 'mysql2/promise';
import { randomUUID } from 'node:crypto';
const pool=mysql.createPool({host:process.env.DB_HOST||'127.0.0.1',port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER||'root',password:process.env.DB_PASSWORD||'',database:process.env.DB_NAME||'mario_store'});
const [name,email,password]=process.argv.slice(2);
if(!name||!email||!password||password.length<12){console.error('Usage: npm run create-owner -- "Store Owner" owner@example.com "a-long-password-at-least-12"');process.exit(1);}
try{const hash=await bcrypt.hash(password,12);await pool.execute('INSERT INTO users(id,name,email,password_hash,role) VALUES(?,?,?,?,?)',[randomUUID(),name,email.toLowerCase(),hash,'Owner']);console.log('Owner account created. Password stored as a bcrypt hash.');}
catch(e){if(e.code==='ER_DUP_ENTRY')console.error('That email already exists.');else console.error(e.message);process.exitCode=1;}
finally{await pool.end();}
