from sqlalchemy import Column, String, Integer, Float
from app.db.base_class import Base

class WilayaDeliveryFee(Base):
    __tablename__ = "wilaya_delivery_fees"

    wilaya_id = Column(Integer, primary_key=True, index=True)
    wilaya_name = Column(String, nullable=False, unique=True, index=True)
    home_fee = Column(Float, default=700.0)
    office_fee = Column(Float, default=400.0)
