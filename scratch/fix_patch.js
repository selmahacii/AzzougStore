const fs = require('fs');
const path = 'src/components/admin/orders-page.tsx';
let content = fs.readFileSync(path, 'utf8');

const targetStr = `
    const [createCommunes, setCreateCommunes] = useState<any[]>([]);
    const [editCommunes, setEditCommunes] = useState<any[]>([]);
    const [loadingCreateCommunes, setLoadingCreateCommunes] = useState(false);
    const [loadingEditCommunes, setLoadingEditCommunes] = useState(false);
    const [createCommune, setCreateCommune] = useState('');
    const [editCommuneState, setEditCommuneState] = useState('');
`;

const targetEffect = `
    useEffect(() => {
      if (!orderWilaya) {
        setCreateCommunes([]);
        return;
      }
      const wid = WILAYAS.indexOf(orderWilaya) + 1;
      if (wid > 0) {
        setLoadingCreateCommunes(true);
        fetch(\`/api/v1/locations/communes?wilaya_id=\${wid}&store_id=\${activeStore?.id || ''}\`)
          .then(r => r.json())
          .then(d => { setCreateCommunes(d || []); setLoadingCreateCommunes(false); })
          .catch(() => setLoadingCreateCommunes(false));
      }
    }, [orderWilaya, activeStore?.id]);
  
    useEffect(() => {
      if (!editWilaya) {
        setEditCommunes([]);
        return;
      }
      const wid = WILAYAS.indexOf(editWilaya) + 1;
      if (wid > 0) {
        setLoadingEditCommunes(true);
        fetch(\`/api/v1/locations/communes?wilaya_id=\${wid}&store_id=\${activeStore?.id || ''}\`)
          .then(r => r.json())
          .then(d => { setEditCommunes(d || []); setLoadingEditCommunes(false); })
          .catch(() => setLoadingEditCommunes(false));
      }
    }, [editWilaya, activeStore?.id]);
  `;

// Remove from CallbackCountdown
content = content.replace(targetStr, "");
content = content.replace(targetEffect, "");

// Insert into OrdersPage
const insertPos = content.indexOf("const queryClient = useQueryClient();") + "const queryClient = useQueryClient();".length;

const newStr = targetStr + targetEffect;

content = content.slice(0, insertPos) + "\\n" + newStr + content.slice(insertPos);

fs.writeFileSync(path, content, 'utf8');
console.log("Fixed scope error");
