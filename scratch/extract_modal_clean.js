const fs = require('fs');

const adminContent = fs.readFileSync('src/components/admin/agent-orders-page.tsx', 'utf-8');

const statesMatch = adminContent.match(/\/\/ States for manual order creation.*?(?=const ordersQuery)/s)[0];
const queriesMatch = adminContent.match(/(const productsQuery = useQuery<any>\(\{.*?\}\);\s*const deliveryPartnersQuery = useQuery<any>\(\{.*?\}\);)/s)[1];

// Match the exact useEffect block
const effectMatch = `  useEffect(() => {
    if (!selectedPartnerId || !orderWilaya) return;
    const fetchFee = async () => {
      try {
        const res = await apiFetch<any>(
          \`/api/v1/delivery-partners/calculate?partnerId=\${selectedPartnerId}&wilayaId=\${orderWilaya}&type=\${deliveryType}\`
        );
        if (res?.success && typeof res?.data?.fee === 'number') {
          setDeliveryFee(res.data.fee);
          toast.success(\`Tarif de livraison mis à jour : \${res.data.fee} DA\`);
        }
      } catch (error) {
        console.error('Error fetching shipping fee:', error);
      }
    };
    fetchFee();
  }, [selectedPartnerId, orderWilaya, deliveryType]);`;

const dialogMatch = adminContent.match(/(<Dialog open=\{isCreatingOrder\}.*?<\/Dialog>)/s);

let dialogCode = dialogMatch[1]
  .replace(/isCreatingOrder/g, 'isOpen')
  .replace(/setIsCreatingOrder/g, 'setIsOpen')
  .replace(/duplicateWarning && "border-rose-400 ring-rose-100 bg-rose-50"/g, '""');

const modalCode = `
import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Loader2, Package, Search, CheckCircle, MapPin, AlertCircle, ShoppingCart, ArrowRightLeft } from 'lucide-react';
import { toast } from 'sonner';
import { apiFetch } from '@/lib/api-client';
import { useAppStore } from '@/store/app-store';
import { formatPrice } from '@/lib/format';
import { cn } from '@/lib/utils';
import { ALGERIA_WILAYAS as WILAYAS } from '@/lib/wilayas';

export function ManualOrderModal({ isOpen, setIsOpen, onSuccess }: { isOpen: boolean, setIsOpen: (v: boolean) => void, onSuccess?: () => void }) {
  const { activeStore, user } = useAppStore();
  const storeId = activeStore?.id ?? '';
  const qc = useQueryClient();
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);

  ${statesMatch.replace('const [isCreatingOrder, setIsCreatingOrder] = useState(false);', '').replace(/const \[duplicateWarning.*?\] = useState.*?;/, '')}
  ${queriesMatch}
  ${effectMatch}

  const checkDuplicatePhone = async (phone: string) => {
    // simplified or skipped
  };

  const createOrderMutation = useMutation({
    mutationFn: async (payload: any) => {
      const res = await apiFetch('/api/v1/orders', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      return res;
    },
    onSuccess: () => {
      toast.success('Commande créée avec succès');
      setIsOpen(false);
      qc.invalidateQueries({ queryKey: ['agent-orders'] });
      qc.invalidateQueries({ queryKey: ['agent-perf'] });
      if (onSuccess) onSuccess();
    },
    onError: (err: any) => {
      toast.error(err.message || 'Erreur lors de la création de la commande');
    }
  });

  const primaryColor = activeStore?.theme_color || '#3b82f6';

  return (
    ${dialogCode}
  );
}
`;

fs.writeFileSync('src/components/agent/manual-order-modal.tsx', modalCode, 'utf-8');
console.log("Created modal");
