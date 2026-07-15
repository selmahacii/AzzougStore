-- Supprime définitivement toutes les commandes du client 0780125700, toutes boutiques confondues.
-- Neon (éditeur SQL / pooler HTTP) refuse plusieurs commandes dans une seule requête —
-- exécute CHAQUE bloc ci-dessous SÉPARÉMENT, dans l'ordre, un par un (bouton "Run" à chaque fois).
-- Irréversible : aucune sauvegarde n'est faite par ce script.

-- ─── 1. PRÉVISUALISATION — exécute seul, vérifie la liste avant de continuer ───
SELECT id, order_number, store_id, customer_name, customer_phone, status, total, created_at
FROM orders
WHERE customer_phone = '0780125700'
ORDER BY created_at DESC;

-- ─── 2. Détache les mouvements de stock (garde l'historique d'inventaire intact) ───
UPDATE stock_movements
SET order_id = NULL
WHERE order_id IN (SELECT id FROM orders WHERE customer_phone = '0780125700');

-- ─── 3. Détache les notifications liées ───
UPDATE notifications
SET order_id = NULL
WHERE order_id IN (SELECT id FROM orders WHERE customer_phone = '0780125700');

-- ─── 4. Supprime l'historique d'événements de ces commandes ───
DELETE FROM order_events
WHERE order_id IN (SELECT id FROM orders WHERE customer_phone = '0780125700');

-- ─── 5. Supprime les articles de ces commandes ───
DELETE FROM order_items
WHERE order_id IN (SELECT id FROM orders WHERE customer_phone = '0780125700');

-- ─── 6. Supprime les commandes elles-mêmes, toutes boutiques confondues ───
DELETE FROM orders
WHERE customer_phone = '0780125700';

-- ─── 7. Vérifie le résultat — doit afficher 0 ───
SELECT count(*) AS commandes_restantes FROM orders WHERE customer_phone = '0780125700';
