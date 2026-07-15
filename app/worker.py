import time
import logging
from app.celery_app import celery_app
from app.db.session import SessionLocal
from app.models.store import Store

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

@celery_app.task(name="app.worker.sync_store_inventory")
def sync_store_inventory(store_id: str):
    """
    Simule une synchronisation lourde avec l'ERP :
    1. Récupération des produits depuis le système central.
    2. Mise à jour des stocks.
    3. Rafraîchissement du cache CDN de la boutique.
    """
    logger.info(f"🚀 Démarrage de la synchro ERP pour la boutique {store_id}")
    
    # Simule un traitement de 10 secondes (import de milliers de produits)
    for i in range(1, 11):
        time.sleep(1)
        logger.info(f"📊 [Boutique {store_id}] Importation : {i*10}% complété...")

    logger.info(f"✅ Synchronisation terminée pour {store_id}")
    return {"status": "success", "store_id": store_id, "items_synced": 1500}

@celery_app.task(name="app.worker.process_erp_orders")
def process_erp_orders(order_batch: list):
    """
    Traite un lot de commandes pour injection dans la logistique ERP.
    """
    logger.info(f"📦 Traitement de {len(order_batch)} commandes vers l'ERP")
    time.sleep(5) # Simulation
    logger.info("🚚 Commandes injectées avec succès dans le système de livraison")
    return {"processed": len(order_batch)}

@celery_app.task(name="app.worker.auto_reassign_inactive_orders")
def auto_reassign_inactive_orders():
    """
    Checks for orders assigned to an agent that haven't been updated for 2 hours,
    and automatically reassigns them to another eligible online agent.
    Logs the event to the order's history.
    """
    db = SessionLocal()
    try:
        from datetime import datetime, timezone, timedelta
        from app.models.order import Order
        from app.models.user import User
        from app.services.order_service import _auto_assign, _log_event

        two_hours_ago = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(hours=2)

        inactive_orders = (
            db.query(Order)
            .filter(
                Order.is_deleted == False,
                Order.assigned_to.isnot(None),
                Order.status.in_(["NEW", "ASSIGNED", "IN_PROGRESS", "CALLED", "RESCHEDULED"]),
                Order.updated_at <= two_hours_ago,
            )
            .all()
        )

        if not inactive_orders:
            logger.info("No inactive orders to reassign.")
            return {"reassigned_count": 0}

        reassigned_count = 0
        for order in inactive_orders:
            store = db.query(Store).filter(Store.id == order.store_id).first()
            if not store:
                continue

            order_product_ids = [item.product_id for item in order.items if item.product_id]
            old_agent_id = order.assigned_to

            new_agent_id = _auto_assign(
                db,
                store=store,
                order_product_ids=order_product_ids,
                exclude_agent_id=old_agent_id,
                force=True
            )

            if new_agent_id and new_agent_id != old_agent_id:
                old_agent = db.query(User).filter(User.id == old_agent_id).first()
                new_agent = db.query(User).filter(User.id == new_agent_id).first()
                
                old_name = old_agent.name if old_agent else old_agent_id
                new_name = new_agent.name if new_agent else new_agent_id

                order.assigned_to = new_agent_id
                current_status = order.status
                note = f"Réassignation automatique de l'agent {old_name} à {new_name} après 2h d'inactivité."
                _log_event(
                    db,
                    order_id=order.id,
                    actor_id=None,
                    from_status=current_status,
                    to_status=current_status,
                    note=note
                )
                
                order.next_callback_time = None
                order.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)

                logger.info(f"Reassigned order {order.order_number} from {old_name} to {new_name} due to inactivity.")
                reassigned_count += 1

        db.commit()
        return {"reassigned_count": reassigned_count}
    except Exception as e:
        db.rollback()
        logger.error(f"Error in auto_reassign_inactive_orders task: {e}")
        raise e
    finally:
        db.close()
