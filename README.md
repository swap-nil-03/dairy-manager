# Dairy Manager – Online Dairy Business Manager

Marathi-first responsive web application for managing dairy customers, daily milk delivery, cow/buffalo rates, monthly billing, collections and JSON backups.

## Features
- Login with bcrypt password hashing and JWT authentication
- Customer records (name, phone, address, cow/buffalo, daily/morning/evening quantity)
- Daily morning/evening delivery, delivered/not delivered, extra quantity and notes
- Effective-month cow and buffalo milk rates
- Monthly customer-wise litres, bill, payments and balance
- Cash / UPI / Bank payment collection
- JSON data backup
- Mobile and desktop responsive interface
- PostgreSQL database for persistent cloud storage

## Local development
1. Install Node.js 20+ and PostgreSQL.
2. Create a PostgreSQL database and set `DATABASE_URL`.
3. Set a long random `JWT_SECRET`.
4. Run `npm install` then `npm start`.
5. Open http://localhost:3000.

Example PowerShell environment setup:
```powershell
$env:DATABASE_URL="postgresql://USER:PASSWORD@localhost:5432/dairy_manager"
$env:JWT_SECRET="replace-with-a-long-random-secret"
npm install
npm start
```

First login: `admin` / `admin123`. Change this password immediately in Settings after first login. The application creates the initial admin account automatically only when the users table is empty.

## Free online deployment architecture
- Render Free Web Service for the application (may sleep when idle; first request can take time to wake).
- Neon Free PostgreSQL for persistent application data.
- Configure `DATABASE_URL` and `JWT_SECRET` in Render Environment. Never commit these values to GitHub.

The application requires PostgreSQL in production; it intentionally does not use the Render service's temporary filesystem for business records. Check current free-tier quotas and terms on the providers before use; no paid plan is required for the intended setup.
