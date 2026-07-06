

import { toast } from "sonner";

const NOEST_BASE_URL = 'https://app.noest-dz.com';
const NOEST_TOKEN = 'gBMifKgtZwVEW4QYZqkxb6VZDjhzTnsDSfn';
const NOEST_GUID = 'VRJ9TZ2R';

export interface NoestOrderParams {
  reference: string;
  client: string;
  phone: string;
  adresse: string;
  wilaya_id: number;
  commune: string;
  montant: number;
  produit: string;
  stop_desk: number;
  remarque?: string;
  can_open?: number;
}

export const noestService = {
  /**
   * 1. Créer une expédition chez NOEST
   */
  async createOrder(params: NoestOrderParams) {
    try {
      const response = await fetch(`${NOEST_BASE_URL}/api/public/create/order`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${NOEST_TOKEN}`,
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest'
        },
        body: JSON.stringify({
          user_guid: NOEST_GUID,
          type_id: 1, // Livraison standard
          poids: 0.5,
          can_open: 1,
          ...params
        }),
      });
      const data = await response.json();
      if (!data.success) {
          throw new Error(data.message || 'Échec de la création chez NOEST');
      }
      return data;
    } catch (error) {
      console.error('Noest Create Error:', error);
      throw error;
    }
  },

  /**
   * 2. Valider la commande (OBLIGATOIRE après création)
   */
  async validateOrder(trackingNumber: string) {
    try {
      const response = await fetch(`${NOEST_BASE_URL}/api/public/valid/order`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${NOEST_TOKEN}`,
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest'
        },
        body: JSON.stringify({
          user_guid: NOEST_GUID,
          tracking: trackingNumber,
        }),
      });
      return await response.json();
    } catch (error) {
      console.error('Noest Validation Error:', error);
      throw error;
    }
  },

  /**
   * 3. Télécharger le bordereau PDF
   */
  downloadLabel(trackingNumber: string) {
    const url = `${NOEST_BASE_URL}/api/public/get/order/label?tracking=${trackingNumber}`;
    // Simuler le téléchargement
    window.open(url, '_blank');
  },

  /**
   * 4. Récupérer les infos de tracking
   */
  async getTrackingInfo(trackings: string | string[]) {
    try {
      const response = await fetch(`${NOEST_BASE_URL}/api/public/get/trackings/info`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${NOEST_TOKEN}`,
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest'
        },
        body: JSON.stringify({
          trackings: Array.isArray(trackings) ? trackings : [trackings],
        }),
      });
      return await response.json();
    } catch (error) {
      console.error('Noest Tracking Error:', error);
      throw error;
    }
  },

  /**
   * 5. Mapper les événements NOEST vers OrderStatus
   */
  mapEventToStatus(eventKey: string): any {
    const mapping: Record<string, string> = {
      'livre': 'DELIVERED',
      'livred': 'DELIVERED',
      'return_dispatched_to_partenaire': 'RETURNED',
      'retour_dispatched_to_partenaires': 'RETURNED',
      'livraison_echoue_recu': 'RETURNED',
      'return_validated_by_partener': 'RETURNED',
      'fdr_activated': 'SHIPPED',
    };
    return mapping[eventKey] || null;
  }
};
