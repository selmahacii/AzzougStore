const fs = require('fs');
const path = 'src/components/admin/orders-page.tsx';
let content = fs.readFileSync(path, 'utf8');

// 1. Add state variables
const stateHookPos = content.indexOf("const [timeLeft, setTimeLeft] = useState('');");
const stateVars = `
  const [createCommunes, setCreateCommunes] = useState<any[]>([]);
  const [editCommunes, setEditCommunes] = useState<any[]>([]);
  const [loadingCreateCommunes, setLoadingCreateCommunes] = useState(false);
  const [loadingEditCommunes, setLoadingEditCommunes] = useState(false);
  const [createCommune, setCreateCommune] = useState('');
  const [editCommuneState, setEditCommuneState] = useState('');
`;
content = content.slice(0, stateHookPos) + stateVars + content.slice(stateHookPos);

// 2. Add useEffects
const useEffectPos = content.indexOf("useEffect(() => {", stateHookPos);
const useEffects = `
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
content = content.slice(0, useEffectPos) + useEffects + content.slice(useEffectPos);

// 3. Replace create commune input
content = content.replace(
  /<Input name="commune" placeholder="Entrez la commune" className="bg-\[#F8F9FC\] border-\[#E9ECF0\] text-\[#2D3436\] text-sm font-medium h-12 rounded-xl focus:bg-white focus:border-\[#6C5CE7\]\/50 focus:ring-2 focus:ring-\[#6C5CE7\]\/20 transition-all px-4 placeholder:text-neutral-400" \/>/g,
  `<select name="commune" value={createCommune} onChange={e => setCreateCommune(e.target.value)} className="w-full bg-[#F8F9FC] border-[#E9ECF0] text-[#2D3436] text-sm font-medium h-12 rounded-xl focus:bg-white focus:border-[#6C5CE7]/50 focus:ring-2 focus:ring-[#6C5CE7]/20 transition-all px-4" disabled={!orderWilaya || loadingCreateCommunes}>
     <option value="">{loadingCreateCommunes ? "Chargement..." : "Sélectionnez une commune"}</option>
     {createCommunes.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
   </select>`
);

// 4. Replace edit commune input
content = content.replace(
  /<Input name="customer_commune" defaultValue=\{editOrderData.customer_commune \?\? ''\} className="h-11 rounded-xl bg-slate-50 border-slate-100 text-sm" \/>/g,
  `<select name="customer_commune" value={editCommuneState} onChange={e => setEditCommuneState(e.target.value)} className="w-full h-11 rounded-xl bg-slate-50 border border-slate-100 text-sm px-3" disabled={!editWilaya || loadingEditCommunes}>
     <option value="">{loadingEditCommunes ? "Chargement..." : "Sélectionnez une commune"}</option>
     {editCommunes.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
   </select>`
);

// 5. When opening edit modal, initialize editCommuneState
content = content.replace(
  /setEditOrderOpen\(true\);/g,
  "setEditCommuneState(o.customer_commune || '');\n      setEditOrderOpen(true);"
);

// Fix FormData parsing for form submission
content = content.replace(
  /let finalCommune = \(formData\.get\('commune'\) as string\) \|\| '';/g,
  "let finalCommune = (formData.get('commune') as string) || createCommune || '';"
);

content = content.replace(
  /let finalCommune = \(fd\.get\('customer_commune'\) as string\) \|\| '';/g,
  "let finalCommune = (fd.get('customer_commune') as string) || editCommuneState || '';"
);

fs.writeFileSync(path, content, 'utf8');
console.log("Patched successfully");
