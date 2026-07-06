const fs = require('fs');

let text = fs.readFileSync('src/components/agent/agent-dashboard.tsx', 'utf-8');

// 1. Add import
if (!text.includes('ManualOrderModal')) {
    text = text.replace(
        /import \{ Badge \} from '@\/components\/ui\/badge';/,
        "import { Badge } from '@/components/ui/badge';\nimport { ManualOrderModal } from '@/components/agent/manual-order-modal';"
    );
    
    // Also import Plus if not there
    if (!text.includes(', Plus}')) {
        text = text.replace(/\} from 'lucide-react';/, ', Plus} from \'lucide-react\';');
    }
}

// 2. Add state inside AgentDashboard
if (!text.includes('isCreatingOrder')) {
    text = text.replace(
        /const \[isAutoRotate, setIsAutoRotate\] = useState\(false\);/,
        "const [isAutoRotate, setIsAutoRotate] = useState(false);\n  const [isCreatingOrder, setIsCreatingOrder] = useState(false);"
    );
}

// 3. Add button in header
if (!text.includes('Nouvelle Commande')) {
    text = text.replace(
        /(<span className="text-\[10px\] font-bold text-slate-600 uppercase tracking-widest">Rotation Auto<\/span>\s*<button.*?)<\/div>/s,
        `$1</div>
                <div className="h-6 w-px bg-slate-200 mx-2 hidden sm:block"></div>
                <button
                  onClick={() => setIsCreatingOrder(true)}
                  className="hidden sm:flex items-center gap-2 bg-slate-900 text-white px-4 py-2 rounded-xl text-xs font-bold hover:bg-slate-800 transition-colors"
                >
                  <Plus className="size-4" />
                  Nouvelle Commande
                </button>`
    );
}

// 4. Insert Modal at the end of AgentDashboard
if (!text.includes('<ManualOrderModal')) {
    text = text.replace(
        /      <\/div>\s*<\/div>\s*\)\;\s*\}/s,
        `        <ManualOrderModal isOpen={isCreatingOrder} setIsOpen={setIsCreatingOrder} />
      </div>
    </div>
  );
}`
    );
}

fs.writeFileSync('src/components/agent/agent-dashboard.tsx', text, 'utf-8');
console.log("Patched agent-dashboard with ManualOrderModal");
