import uuid

from sqlalchemy import Column, String, Boolean, ForeignKey, Text
from sqlalchemy.orm import relationship

from app.db.base_class import Base


class Notification(Base):
    """
    In-app notification. `user_id = None` means broadcast to admins
    (SUPER_ADMIN / MANAGER). `channel` is 'inapp' today; 'email',
    'push', 'whatsapp' and 'sms' are reserved for future delivery
    integrations — rows are created with the target channel so a
    future dispatcher only has to consume them.
    """

    __tablename__ = "notifications"

    id = Column(String, primary_key=True, index=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String, ForeignKey("users.id"), nullable=True, index=True)
    store_id = Column(String, ForeignKey("stores.id"), nullable=True, index=True)
    order_id = Column(String, ForeignKey("orders.id"), nullable=True, index=True)

    # ORDER_ASSIGNED | REMINDER_DUE | NRP_FOLLOWUP | CART_RECOVERED
    # ORDER_DELIVERED | NOEST_SYNC_ERROR | DUPLICATE_MERGED
    type = Column(String, nullable=False, index=True)
    title = Column(String, nullable=False)
    message = Column(Text, nullable=True)

    channel = Column(String, default="inapp", nullable=False)
    is_read = Column(Boolean, default=False, nullable=False, index=True)

    user = relationship("User")
