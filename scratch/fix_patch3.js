const fs = require('fs');
const path = 'src/components/admin/orders-page.tsx';
let content = fs.readFileSync(path, 'utf8');

const startStr = "const [createCommunes, setCreateCommunes] = useState<any[]>([]);";
const endStr = "}, [editWilaya, activeStore?.id]);";

let startIdx = content.indexOf(startStr);
let endIdx = content.indexOf(endStr) + endStr.length;

if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    let block = content.substring(startIdx, endIdx);
    content = content.substring(0, startIdx) + content.substring(endIdx);
    
    const insertPosStr = "const queryClient = useQueryClient();";
    const insertPos = content.indexOf(insertPosStr) + insertPosStr.length;
    
    content = content.substring(0, insertPos) + "\n\n  " + block + "\n" + content.substring(insertPos);
    
    fs.writeFileSync(path, content, 'utf8');
    console.log("Success");
} else {
    console.log("Failed to find boundaries");
}
