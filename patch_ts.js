const fs = require('fs');
const path = require('path');

const targetFile = 'C:\\Users\\ZBOOK\\Downloads\\azzougshop\\src\\components\\admin\\orders-page.tsx';
let content = fs.readFileSync(targetFile, 'utf8');

// Replace .includes(user?.role) with .includes(user?.role || '')
content = content.replace(/\.includes\(user\?\.role\)/g, ".includes(user?.role || '')");

fs.writeFileSync(targetFile, content);
console.log('Successfully patched typescript errors in orders-page.tsx');
