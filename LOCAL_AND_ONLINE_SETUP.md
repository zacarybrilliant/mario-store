# Mario Store — XAMPP Local + Online Setup

## 1. Configure XAMPP MySQL locally
1. Open XAMPP Control Panel and start **MySQL** (Apache is not required for the Node.js app itself).
2. Open `http://localhost/phpmyadmin`.
3. Use Import and select `sql/schema.sql`. It creates database `mario_store` and all tables.
4. In the project root, copy `.env.example` to `.env`.
5. Set `DB_HOST=127.0.0.1`, `DB_PORT=3306`, `DB_USER=root`, `DB_PASSWORD=` (blank only if your XAMPP root account has no password), and `DB_NAME=mario_store`.

## 2. Make JWT_SECRET
JWT_SECRET signs the authentication token issued after a successful login. The browser sends this token to the API so the server can verify the logged-in user and permissions. It is **not** a password for MySQL and must never be exposed in frontend code. Generate a strong random secret:

- Windows PowerShell: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
- macOS/Linux terminal: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`

Copy the output into `.env` as `JWT_SECRET=...`. Keep it private. Changing it logs out tokens issued with the old secret.

## 3. Install and run
Run these commands from the extracted project directory:

```bash
npm install
npm run create-owner -- "Store Owner" owner@example.com "Your-Strong-Password-123"
npm start
```

Open `http://localhost:3000`. Health check: `http://localhost:3000/api/health` should return JSON with `"database":"connected"` and `"engine":"mysql"`.

## 4. Online access
To use the same inventory and sales from different devices, the API and database must be hosted and reachable securely. Deploy Node.js to a hosting provider, create a MySQL database on a managed database host, set the production environment variables (`DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `JWT_SECRET`, `NODE_ENV=production`), configure HTTPS, and set `CORS_ORIGIN` to the exact web origin. Keep MySQL private to the application server. **Do not expose your local XAMPP MySQL/phpMyAdmin directly to the public internet.**

## 5. Offline mode
Load the app and sign in online once on each device. The browser caches the app shell and stores offline sales in IndexedDB; pending sales are sent when connectivity returns. Product edits, restocking, account management, and login for a new device require connectivity. A sale can be rejected during sync if the shared server inventory has changed; review those cases before relying on final reports.
