const fs = require('fs');
const path = require('path');

const ordersPagePath = 'src/components/admin/agent-orders-page.tsx';
const dashboardPath = 'src/components/agent/agent-dashboard.tsx';

let ordersContent = fs.readFileSync(ordersPagePath, 'utf-8');
let dashboardContent = fs.readFileSync(dashboardPath, 'utf-8');

// Extract the dialog
const dialogMatch = ordersContent.match(/(<Dialog open=\{isCreatingOrder\}.*?<\/Dialog>)/s);
if (!dialogMatch) {
    console.error("Could not find dialog");
    process.exit(1);
}
const dialogCode = dialogMatch[1];

// Extract states from agent-orders-page
const statesRegex = /\/\/ States for manual order creation.*?(?=const ordersQuery)/s;
const statesMatch = ordersContent.match(statesRegex);
if (!statesMatch) {
    console.error("Could not find states");
    process.exit(1);
}
const statesCode = statesMatch[0];

// Extract queries
const queriesRegex = /(const productsQuery = useQuery<any>\(\{.*?\}\);\s*const deliveryPartnersQuery = useQuery<any>\(\{.*?\}\);)/s;
const queriesMatch = ordersContent.match(queriesRegex);
if (!queriesMatch) {
    console.error("Could not find queries");
    process.exit(1);
}
const queriesCode = queriesMatch[1];

// Extract delivery fee effect
const feeEffectRegex = /(\/\/ Calculate shipping fees dynamically.*?\}\);)/s;
const feeEffectMatch = ordersContent.match(feeEffectRegex);
const feeEffectCode = feeEffectMatch ? feeEffectMatch[1] : '';

// Insert states, queries, and effect into dashboard
dashboardContent = dashboardContent.replace(
    /const statusMutation = useMutation\(\{/,
    statesCode + '\n  ' + queriesCode + '\n  ' + feeEffectCode + '\n\n  const statusMutation = useMutation({'
);

// We need an add order button in the dashboard
// Let's put it next to Auto-Rotate toggle
dashboardContent = dashboardContent.replace(
    /(<span className="text-\[10px\] font-bold text-slate-600 uppercase tracking-widest">Rotation Auto<\/span>\s*<button.*?)<\/div>/s,
    `$1</div>
                <div className="h-6 w-px bg-slate-200 mx-2"></div>
                <button
                  onClick={() => setIsCreatingOrder(true)}
                  className="flex items-center gap-2 bg-slate-900 text-white px-4 py-2 rounded-xl text-xs font-bold hover:bg-slate-800 transition-colors"
                >
                  <Plus className="size-4" />
                  Nouvelle Commande
                </button>`
);

// Add missing imports. Plus icon.
dashboardContent = dashboardContent.replace(
    /import \{([^}]+)\} from 'lucide-react';/,
    (match, p1) => {
        if (!p1.includes('Plus')) {
            return `import {${p1}, Plus} from 'lucide-react';`;
        }
        return match;
    }
);

// We must also import the Select components from shadcn UI since the dialog uses them.
if (!dashboardContent.includes('SelectContent')) {
  dashboardContent = dashboardContent.replace(
      /import \{ Input \} from "@\/components\/ui\/input";/,
      `import { Input } from "@/components/ui/input";\nimport { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";`
  );
}

// And the RadioGroup and Label
if (!dashboardContent.includes('RadioGroup')) {
  dashboardContent = dashboardContent.replace(
      /import \{ Input \} from "@\/components\/ui\/input";/,
      `import { Input } from "@/components/ui/input";\nimport { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";\nimport { Label } from "@/components/ui/label";`
  );
}

// And checkDuplicatePhone function
const duplicateRegex = /(const checkDuplicatePhone = async \(phone: string\).*?\};)/s;
const duplicateMatch = ordersContent.match(duplicateRegex);
if (duplicateMatch) {
  dashboardContent = dashboardContent.replace(
    /const statusMutation = useMutation\(\{/,
    duplicateMatch[1] + '\n\n  const statusMutation = useMutation({'
  );
}


// Insert the Dialog at the end of dashboard (before the last </div> of AgentDashboard)
// Wait, AgentDashboard ends with `</div>\n    </div>\n  );\n}\n\nfunction SalaryView`
dashboardContent = dashboardContent.replace(
    /    <\/div>\s*<\/div>\s*\)\;\s*\}\s*function SalaryView/s,
    `    </div>
        {/* Manual Order Dialog */}
        ${dialogCode}
      </div>
    </div>
  );
}

function SalaryView`
);


fs.writeFileSync(dashboardPath, dashboardContent, 'utf-8');
console.log("Successfully patched agent-dashboard.tsx");
