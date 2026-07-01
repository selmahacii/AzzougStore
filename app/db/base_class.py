from typing import Any
from sqlalchemy.orm import DeclarativeBase, declared_attr
from sqlalchemy import Column, DateTime, func

class Base(DeclarativeBase):
    id: Any
    __name__: str  # pyrefly: ignore[bad-override]

    # Generate __tablename__ automatically from class name
    @declared_attr  # pyrefly: ignore[bad-argument-type]
    def __tablename__(cls) -> str:  # pyrefly: ignore[bad-override]
        return cls.__name__.lower()

    # Time tracking for all models
    created_at = Column(DateTime, default=func.now(), nullable=False)
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now(), nullable=False)
