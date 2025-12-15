const bcrypt = require('bcrypt');

async function generateHashes() {
  const passwords = [
    'vendor123',
    'vendor456', 
    'pic123',
    'pic456',
    'direksi123',
    'direksi456'
  ];

  console.log('🔐 Generating bcrypt hashes...\n');
  
  for (const password of passwords) {
    const saltRounds = 10;
    const hash = await bcrypt.hash(password, saltRounds);
    console.log(`Password: "${password}"`);
    console.log(`Hash:     "${hash}"`);
    console.log('---');
  }
}

generateHashes().catch(console.error);