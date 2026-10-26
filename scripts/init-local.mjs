import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const destination = new URL('../backend/BorrowApp.Api/appsettings.Local.json',import.meta.url);
const rl = createInterface({input:stdin,output:stdout});
try {
  const email = (await rl.question('First admin email: ')).trim();
  console.log('This local setup prompt displays your typing. Use a unique development password.');
  const password = await rl.question('First admin password (12+ characters, upper/lowercase, number, symbol): ');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Enter a valid email.');
  if (password.length<12 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password) || !/[^a-zA-Z0-9]/.test(password)) throw new Error('Password does not meet requirements.');
  await mkdir(new URL('../backend/BorrowApp.Api/data/',import.meta.url),{recursive:true});
  await writeFile(destination,JSON.stringify({Bootstrap:{Email:email,Password:password}},null,2)+'\n',{flag:'wx',mode:0o600});
  console.log(`Local configuration created at ${fileURLToPath(destination)}. Start the API and frontend using README.md.`);
} finally { rl.close(); }
