const fs = require('fs');
const path = require('path');

function replaceInDir(dir) {
    fs.readdirSync(dir).forEach(file => {
        const fullPath = path.join(dir, file);
        if (fs.statSync(fullPath).isDirectory()) {
            replaceInDir(fullPath);
        } else if (fullPath.endsWith('.tsx') || fullPath.endsWith('.ts')) {
            let content = fs.readFileSync(fullPath, 'utf8');
            let modified = false;

            // Replace user?.role === 'ADMIN'
            const regex1 = /user\?\.role === 'ADMIN'/g;
            if (regex1.test(content)) {
                content = content.replace(regex1, "['ADMIN', 'SUPER_ADMIN'].includes(user?.role)");
                modified = true;
            }

            // Replace user.role === 'ADMIN' (where it is safe)
            const regex2 = /user\.role === 'ADMIN'/g;
            if (regex2.test(content)) {
                content = content.replace(regex2, "['ADMIN', 'SUPER_ADMIN'].includes(user.role)");
                modified = true;
            }
            
            // Fix employees array filter role checks
            const regex3 = /\[.*?\]\.includes\(e\.role\)/g;
            if (regex3.test(content)) {
                content = content.replace(/e => \['CONFIRMATEUR','MANAGER','ADMIN'\]\.includes\(e\.role\)/g, "e => ['CONFIRMATEUR','MANAGER','ADMIN', 'SUPER_ADMIN'].includes(e.role)");
                modified = true;
            }

            if (modified) {
                fs.writeFileSync(fullPath, content);
                console.log('Patched', fullPath);
            }
        }
    });
}

replaceInDir('C:\\Users\\ZBOOK\\Downloads\\azzougshop\\src\\components');
