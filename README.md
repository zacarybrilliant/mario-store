# Mario Store POS — XAMPP MySQL + Node.js + offline sales

This project uses **MySQL/MariaDB from XAMPP**, not PostgreSQL. The browser talks to the Node.js API; the API talks to MySQL. Passwords are hashed with bcrypt (12 rounds) before storage.

## Requirements
- XAMPP with MySQL/MariaDB enabled
- Node.js 20 or newer
- A modern browser

## Local setup
1. Start **MySQL** in XAMPP Control Panel.
2. Open `http://localhost/phpmyadmin`.
3. Import `sql/schema.sql` (it creates/selects the `mario_store` database).
4. Copy `.env.example` to `.env`; use the XAMPP MySQL username/password. Default XAMPP is often `root` with an empty password, unless you changed it.
5. Generate a private JWT secret (see `LOCAL_AND_ONLINE_SETUP.md`) and put it in `.env`.
6. In this folder run:
   ```bash
   npm install
   npm run create-owner -- "Store Owner" owner@example.com "Your-Strong-Password-123"
   npm start
   ```
7. Visit `http://localhost:3000` and sign in. Check `http://localhost:3000/api/health` for `"database":"connected"`.

## Local + online
- Local-only access works at `http://localhost:3000` on that computer.
- To use the same data from different devices over the internet, deploy the Node server and MySQL database to hosting (or a securely configured server), configure the hosted DB credentials and `JWT_SECRET`, use HTTPS, and set `CORS_ORIGIN` to your site.
- Do not expose XAMPP/phpMyAdmin or your MySQL port directly to the public internet. For a safe online deployment, use a hosted database or secured private network/VPN.
- The app caches its shell and queues offline sales in IndexedDB after first loading/sign-in online. When connectivity returns, queued sales are retried. Offline stock is only a local estimate until the server accepts the sale.

## JWT_SECRET
JWT_SECRET is a private signing key used by the server to sign and verify login tokens. It is not your database password or user password. Keep it secret and use the same value across server restarts/instances; if you change it, existing login tokens stop working. Never put it in frontend JavaScript or commit `.env` to Git.
