// scripts/create_user.js – CLI: npm run create-user -- <username> <password> <role>
require('dotenv').config();
const bcrypt = require('bcryptjs');
const pool = require('../config/db');

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 3) {
    console.log('Usage: npm run create-user -- <username> <password> <role>');
    console.log('Roles: owner, cashier');
    process.exit(1);
  }

  const [username, password, role] = args;

  if (!['owner', 'cashier'].includes(role)) {
    console.error('Error: role must be "owner" or "cashier"');
    process.exit(1);
  }

  try {
    const hash = await bcrypt.hash(password, 10);
    await pool.query(
      'INSERT INTO users (username, password_hash, full_name, role) VALUES (?, ?, ?, ?)',
      [username, hash, username, role]
    );
    console.log(`User "${username}" created with role "${role}".`);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      console.error(`Error: Username "${username}" already exists.`);
    } else {
      console.error('Error:', err.message);
    }
    process.exit(1);
  }

  process.exit(0);
}

main();
