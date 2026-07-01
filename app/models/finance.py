from sqlalchemy import Column, String, Integer, ForeignKey, Boolean, DateTime, Float, Enum as SqlEnum, func, Index
from sqlalchemy.orm import relationship
import enum
from app.db.base_class import Base

class WalletType(str, enum.Enum):
    BANK = "bank"
    CASH = "cash"
    MOBILE = "mobile"
    COD = "cod"

class TransactionType(str, enum.Enum):
    DISBURSEMENT = "disbursement"
    CHARGE = "charge"
    PAYMENT = "payment"
    TRANSFER = "transfer"

class Wallet(Base):
    __tablename__ = "wallets"  # pyrefly: ignore[bad-override]

    id = Column(String, primary_key=True, index=True)
    store_id = Column(String, ForeignKey("stores.id"), nullable=False)
    name = Column(String, nullable=False)
    type = Column(SqlEnum(WalletType), default=WalletType.CASH)
    balance = Column(Integer, default=0)
    total_in = Column(Integer, default=0)
    total_out = Column(Integer, default=0)
    description = Column(String, nullable=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    store = relationship("Store", back_populates="wallets")
    transactions = relationship("FinancialTransaction", back_populates="wallet")

class FinancialTransaction(Base):
    __tablename__ = "financial_transactions"  # pyrefly: ignore[bad-override]

    # ─── Composite Indexes ───
    __table_args__ = (
        Index('idx_finance_store_date', 'store_id', 'transaction_date'),
    )

    id = Column(String, primary_key=True, index=True)
    store_id = Column(String, ForeignKey("stores.id"), nullable=False)
    wallet_id = Column(String, ForeignKey("wallets.id"), nullable=False)
    reference = Column(String, unique=True, index=True)
    type = Column(SqlEnum(TransactionType), nullable=False)
    category = Column(String, nullable=True) # e.g., 'rent', 'commission', 'ads'
    amount = Column(Integer, nullable=False) # Positive or Negative
    beneficiary = Column(String, nullable=True)
    description = Column(String, nullable=True)
    transaction_date = Column(DateTime, server_default=func.now())
    created_by = Column(String, nullable=True) # User ID
    created_at = Column(DateTime, server_default=func.now())

    store = relationship("Store", back_populates="financial_transactions")
    wallet = relationship("Wallet", back_populates="transactions")
