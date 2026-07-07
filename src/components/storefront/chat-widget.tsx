'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { MessageCircle, X, Send, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useAppStore } from '@/store/app-store';
import type { Store } from '@/lib/types';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

// ─── FAQ engine ───────────────────────────────────────────────
const QUICK_REPLIES = [
  'Délais de livraison',
  'Frais de livraison',
  'Comment passer une commande',
  'Modes de paiement',
  'Retour & échange',
  'Annuler une commande',
  'Nous contacter',
];

function getFaqResponse(input: string, store: Store): string {
  const msg = input.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const phone = store.theme_config?.contact?.phone as string | undefined;
  const email = store.theme_config?.contact?.email as string | undefined;
  const name = store.name;

  // Livraison délais
  if (/delai|duree|combien.*temp|quand.*livr|livr.*quand|jour/.test(msg)) {
    return `📦 Chez ${name}, la livraison prend généralement **2 à 5 jours ouvrables** selon votre wilaya. Les grandes villes (Alger, Oran, Constantine) sont souvent livrées en 24–48h.`;
  }

  // Frais / prix livraison
  if (/frais|prix.*livr|cout|tarif|livr.*prix|livraison gratuite/.test(msg)) {
    return `🚚 Les frais de livraison varient selon votre wilaya et le type de livraison :\n• **Domicile** : entre 400 et 700 DA\n• **Bureau / Stop-desk** : entre 300 et 500 DA\nLe montant exact s'affiche automatiquement lors de votre commande.`;
  }

  // Comment commander / passer commande
  if (/comment.*commande|passer.*commande|comment.*acheter|commander|achat/.test(msg)) {
    return `🛒 Pour passer une commande chez ${name} :\n1. Ajoutez vos produits au panier\n2. Cliquez sur **Commander maintenant** dans le panier\n3. Renseignez vos informations de livraison\n4. Confirmez votre commande\n\nNous vous contacterons pour confirmer la livraison.`;
  }

  // Paiement
  if (/paiement|payer|cash|cheque|virement|carte|cod|contre remboursement/.test(msg)) {
    return `💳 Chez ${name}, le paiement se fait uniquement en **espèces à la livraison** (paiement contre remboursement / COD). Vous payez le livreur à la réception de votre colis.`;
  }

  // Retour / échange / remboursement
  if (/retour|echange|rembours|retourner|renvoyer|insatisf/.test(msg)) {
    return `🔄 Nous acceptons les retours et échanges dans un délai de **14 jours** après réception.\n\nConditions :\n• Produit non utilisé et dans son emballage d'origine\n• Contacter notre support pour initier le retour${phone ? `\n\n📞 Contactez-nous au **${phone}**` : ''}`;
  }

  // Annulation commande
  if (/annul|cancel|annuler/.test(msg)) {
    return `❌ Pour annuler une commande, contactez-nous **dès que possible** avant l'expédition.${phone ? `\n\n📞 Appelez-nous au **${phone}**` : ''}\n\nUne fois le colis expédié, l'annulation n'est plus possible mais vous pouvez le refuser à la livraison.`;
  }

  // Contact / téléphone / email
  if (/contact|appeler|telephone|joindre|email|mail|whatsapp|support/.test(msg)) {
    const parts: string[] = [`📬 Voici comment joindre l'équipe ${name} :`];
    if (phone) parts.push(`📞 Téléphone : **${phone}**`);
    if (email) parts.push(`✉️ Email : **${email}**`);
    if (!phone && !email) parts.push('Retrouvez nos coordonnées sur la page de contact de la boutique.');
    return parts.join('\n');
  }

  // Disponibilité stock
  if (/stock|dispo|disponible|rupture|epuise/.test(msg)) {
    return `📊 La disponibilité des produits est indiquée directement sur chaque fiche produit. Si un article est en rupture de stock, il sera signalé comme "Indisponible".${phone ? `\n\nPour des informations précises, contactez-nous au **${phone}**` : ''}`;
  }

  // Suivi commande
  if (/suivi|tracker|ou.*colis|colis|expedie|expedition/.test(msg)) {
    return `📍 Pour suivre votre commande, notez votre **numéro de commande** reçu après confirmation.\n\nVous pouvez nous contacter directement pour avoir des nouvelles de votre colis.${phone ? `\n\n📞 **${phone}**` : ''}`;
  }

  // Tailles / dimensions
  if (/taille|pointure|mesure|guide|cm|xl|xs/.test(msg)) {
    return `📏 Chaque produit dispose d'un guide des tailles sur sa fiche. En cas de doute, n'hésitez pas à nous contacter — nous vous aiderons à choisir la bonne taille.${phone ? `\n\n📞 **${phone}**` : ''}`;
  }

  // Bonjour / salut
  if (/^(bonjour|bonsoir|salut|hello|salam|hi\b|yo\b)/.test(msg)) {
    return `Bonjour ! 👋 Bienvenue chez **${name}**. Comment puis-je vous aider aujourd'hui ?\n\nVous pouvez me poser vos questions sur la livraison, les commandes, les paiements ou les retours.`;
  }

  // Merci
  if (/merci|thank|shukran/.test(msg)) {
    return `Avec plaisir ! 😊 N'hésitez pas si vous avez d'autres questions.`;
  }

  // Default fallback
  return `Je n'ai pas bien compris votre question. Vous pouvez me demander :\n• Les **délais et frais de livraison**\n• Comment **passer une commande**\n• Les **modes de paiement**\n• Les **retours et échanges**\n• Comment **nous contacter**${phone ? `\n\nOu appelez-nous directement au **${phone}**` : ''}`;
}

// ─── Component ────────────────────────────────────────────────
export function ChatWidget() {
  const activeStore = useAppStore((s) => s.activeStore);

  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [hasBeenOpened, setHasBeenOpened] = useState(false);
  const [showQuickReplies, setShowQuickReplies] = useState(true);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => { scrollToBottom(); }, [messages, isLoading, scrollToBottom]);

  useEffect(() => {
    if (isOpen) {
      setHasBeenOpened(true);
      const timer = setTimeout(() => { inputRef.current?.focus(); }, 100);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  useEffect(() => {
    if (hasBeenOpened && messages.length === 0 && activeStore) {
      setMessages([{
        role: 'assistant',
        content: `Bonjour ! 👋 Je suis l'assistant de **${activeStore.name}**.\n\nComment puis-je vous aider ? Choisissez une question ou tapez la vôtre.`,
      }]);
      setShowQuickReplies(true);
    }
  }, [hasBeenOpened, messages.length, activeStore]);

  const sendMessage = useCallback((text: string) => {
    if (!text.trim() || isLoading || !activeStore) return;
    setShowQuickReplies(false);

    const userMsg: ChatMessage = { role: 'user', content: text.trim() };
    setMessages((prev) => [...prev, userMsg]);
    setInputValue('');
    setIsLoading(true);

    setTimeout(() => {
      const reply = getFaqResponse(text.trim(), activeStore);
      setMessages((prev) => [...prev, { role: 'assistant', content: reply }]);
      setIsLoading(false);
    }, 400);
  }, [isLoading, activeStore]);

  const handleSendMessage = () => sendMessage(inputValue);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(); }
  };

  const handleClear = () => {
    if (!activeStore) return;
    setMessages([{
      role: 'assistant',
      content: `Bonjour ! 👋 Je suis l'assistant de **${activeStore.name}**.\n\nComment puis-je vous aider ? Choisissez une question ou tapez la vôtre.`,
    }]);
    setShowQuickReplies(true);
  };

  if (!activeStore) return null;

  const primary = 'var(--store-primary, #4b7bec)';
  const storeInitial = activeStore.name.charAt(0).toUpperCase();
  const hasMessages = messages.length > 0;

  // Render message content with simple **bold** markdown
  const renderContent = (content: string) => {
    return content.split('\n').map((line, i) => {
      const parts = line.split(/\*\*(.+?)\*\*/g);
      return (
        <span key={i}>
          {parts.map((part, j) =>
            j % 2 === 1 ? <strong key={j}>{part}</strong> : part
          )}
          {i < content.split('\n').length - 1 && <br />}
        </span>
      );
    });
  };

  return (
    <div className="fixed bottom-6 right-6 z-50">
      {/* Chat Panel */}
      {isOpen && (
        <div className="mb-4 flex flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg w-[calc(100vw-3rem)] max-w-[380px] h-[520px] max-md:h-[70vh] max-md:rounded-none max-md:rounded-t-2xl">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
            <div className="flex items-center gap-3">
              <div className="flex size-9 items-center justify-center rounded-full text-sm font-bold text-white" style={{ backgroundColor: primary }}>
                {storeInitial}
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-900">Assistant {activeStore.name}</p>
                <p className="text-[11px] text-emerald-500 font-medium">● En ligne</p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon" className="size-8 text-gray-400 hover:text-gray-600" onClick={handleClear} title="Effacer la conversation">
                <Trash2 className="size-4" />
              </Button>
              <Button variant="ghost" size="icon" className="size-8 text-gray-400 hover:text-gray-600" onClick={() => setIsOpen(false)}>
                <X className="size-4" />
              </Button>
            </div>
          </div>

          {/* Messages */}
          <ScrollArea className="flex-1 px-4 py-3">
            <div className="flex flex-col gap-3">
              {messages.map((msg, index) => {
                const isUser = msg.role === 'user';
                return (
                  <div key={index} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${isUser ? 'rounded-br-md text-white' : 'rounded-bl-md bg-gray-100 text-gray-800'}`}
                      style={isUser ? { backgroundColor: primary } : undefined}
                    >
                      {renderContent(msg.content)}
                    </div>
                  </div>
                );
              })}

              {/* Quick reply chips — shown after first assistant message */}
              {showQuickReplies && messages.length > 0 && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {QUICK_REPLIES.map((qr) => (
                    <button
                      key={qr}
                      onClick={() => sendMessage(qr)}
                      className="rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-medium text-gray-700 hover:border-gray-400 hover:bg-gray-50 transition-colors"
                    >
                      {qr}
                    </button>
                  ))}
                </div>
              )}

              {isLoading && (
                <div className="flex justify-start">
                  <div className="rounded-2xl rounded-bl-md bg-gray-100 px-4 py-3 text-sm text-gray-400">
                    <span className="animate-pulse">···</span>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          </ScrollArea>

          {/* Input */}
          <div className="border-t border-gray-100 p-3">
            <form onSubmit={(e) => { e.preventDefault(); handleSendMessage(); }} className="flex items-center gap-2">
              <Input
                ref={inputRef}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Écrivez votre question..."
                disabled={isLoading}
                className="flex-1 text-sm"
              />
              <Button
                type="submit"
                size="icon"
                disabled={isLoading || !inputValue.trim()}
                className="size-9 shrink-0 text-white"
                style={{ backgroundColor: primary }}
              >
                <Send className="size-4" />
                <span className="sr-only">Envoyer</span>
              </Button>
            </form>
          </div>
        </div>
      )}

      {/* Toggle Button */}
      <button
        onClick={() => setIsOpen((prev) => !prev)}
        className="relative flex size-14 items-center justify-center rounded-full text-white shadow-md transition-transform hover:scale-105 focus:outline-none"
        style={{ backgroundColor: primary }}
        aria-label={isOpen ? 'Fermer le chat' : 'Ouvrir le chat'}
      >
        {isOpen ? <X className="size-6" /> : <MessageCircle className="size-6" />}
        {!isOpen && hasMessages && (
          <span className="absolute top-1 right-1 size-3 rounded-full bg-emerald-500 border-2 border-white" />
        )}
      </button>
    </div>
  );
}
