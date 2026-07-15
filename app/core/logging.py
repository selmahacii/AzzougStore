import logging
import sys
from typing import Any

from app.core.config import settings

def setup_logging() -> None:
    """
    Sets up industrial-grade logging with stdout and stderr handling.
    In production, this could be extended to use JSON formatters for ELK/Warp10.
    """
    logging_level = logging.INFO
    
    # Configure root logger
    logging.basicConfig(
        level=logging_level,
        format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
        handlers=[
            logging.StreamHandler(sys.stdout),
        ],
    )

    # Suppress verbose loggers
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
    logging.getLogger("sqlalchemy.engine").setLevel(logging.WARNING)

logger = logging.getLogger(settings.PROJECT_NAME)
