import sys
import os
import uuid

# Add current directory to path so we can import app
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from sqlalchemy.orm import Session
from app.db.session import SessionLocal
from app.models.user import User
from app.models.store import Store
from app.core.security import get_password_hash
from app.core.tenant import tenant_store_id

# Set super admin mode to bypass tenant filtering during creation
tenant_store_id.set("SUPER_ADMIN_MODE")

def create_users():
    print("--- Creating Requested Users (Selma Profiles) ---")
    db = SessionLocal()
    try:
        # Get the first active store to link the Confirmatrice
        store = db.query(Store).first()
        store_id = store.id if store else None
        print(f"Linking confirmatrice to store: {store.name if store else 'None'} (ID: {store_id})")

        password_hash = get_password_hash("selma004")

        # 1. Create SuperAdmin
        super_admin_email = "selmaahacii@gmail.com"
        existing_admin = db.query(User).filter(User.email == super_admin_email).first()
        if not existing_admin:
            super_admin = User(
                id=str(uuid.uuid4()),
                email=super_admin_email,
                name="Selma SuperAdmin",
                hashed_password=password_hash,
                role="SUPER_ADMIN",
                is_active=True
            )
            db.add(super_admin)
            print(f"Created SUPER_ADMIN user: {super_admin_email}")
        else:
            existing_admin.hashed_password = password_hash
            print(f"SUPER_ADMIN user {super_admin_email} already exists, updated password.")

        # 2. Create Confirmatrice
        # We will create both 'selmahaci@jib.com' and 'selmahaci.jib@gmail.com' to cover possible formats
        conf_emails = ["selmahaci@jib.com", "selmahaci.jib@gmail.com", "selmahacijib@gmail.com"]
        for email in conf_emails:
            existing_conf = db.query(User).filter(User.email == email).first()
            if not existing_conf:
                conf = User(
                    id=str(uuid.uuid4()),
                    email=email,
                    name="Selma Confirmatrice",
                    hashed_password=password_hash,
                    role="CONFIRMATEUR",
                    employee_store_id=store_id,
                    is_active=True,
                    daily_target=10
                )
                db.add(conf)
                print(f"Created CONFIRMATEUR user: {email}")
            else:
                existing_conf.hashed_password = password_hash
                existing_conf.employee_store_id = store_id
                print(f"CONFIRMATEUR user {email} already exists, updated password and store ID.")

        db.commit()
        print("--- Users successfully created / updated! ---")
    except Exception as e:
        db.rollback()
        print(f"Error creating users: {e}")
    finally:
        db.close()

if __name__ == "__main__":
    create_users()
