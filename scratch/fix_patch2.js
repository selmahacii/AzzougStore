const fs = require('fs');
const path = 'src/components/admin/orders-page.tsx';
let content = fs.readFileSync(path, 'utf8');

// The exact block to find and remove:
const stateRegex = /const \[createCommunes[\s\S]*?editCommuneState\(''\);/;
const effectRegex1 = /useEffect\(\(\) => \{\s*if \(\!orderWilaya\)[\s\S]*?\}, \[orderWilaya, activeStore\?\.id\]\);/;
const effectRegex2 = /useEffect\(\(\) => \{\s*if \(\!editWilaya\)[\s\S]*?\}, \[editWilaya, activeStore\?\.id\]\);/;

let matchedState = content.match(stateRegex);
let matchedEffect1 = content.match(effectRegex1);
let matchedEffect2 = content.match(effectRegex2);

if (matchedState && matchedEffect1 && matchedEffect2) {
    // Remove from CallbackCountdown
    content = content.replace(stateRegex, "");
    content = content.replace(effectRegex1, "");
    content = content.replace(effectRegex2, "");

    // Insert into OrdersPage
    const insertPosStr = "const queryClient = useQueryClient();";
    const insertPos = content.indexOf(insertPosStr) + insertPosStr.length;

    const newStr = `\n  ` + matchedState[0] + `\n\n  ` + matchedEffect1[0] + `\n\n  ` + matchedEffect2[0] + `\n`;

    content = content.slice(0, insertPos) + newStr + content.slice(insertPos);

    fs.writeFileSync(path, content, 'utf8');
    console.log("Fixed scope error successfully with regex");
} else {
    console.log("Could not find the blocks to move.");
}
