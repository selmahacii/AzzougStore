const fs = require('fs');

let text = fs.readFileSync('src/components/agent/agent-dashboard.tsx', 'utf-8');

const imports = [
  "import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';",
  "import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';",
  "import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';",
  "import { Label } from '@/components/ui/label';",
  "import { Textarea } from '@/components/ui/textarea';"
];

let changed = false;
imports.forEach(imp => {
  const compNameMatch = imp.match(/import \{([^}]+)\}/);
  if (compNameMatch) {
    const compName = compNameMatch[1].split(',')[0].trim();
    if (!text.includes(compName)) {
      text = text.replace(/import \{ Badge \} from '@\/components\/ui\/badge';/, "import { Badge } from '@/components/ui/badge';\n" + imp);
      changed = true;
    }
  }
});

if (changed) {
  fs.writeFileSync('src/components/agent/agent-dashboard.tsx', text);
  console.log('Added missing imports');
} else {
  console.log('Imports already exist');
}
