import os
import sys

# Set up path so imports work
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from app.db.session import SessionLocal
from app.models.marketing import FunnelEvent
from sqlalchemy import func

def run_audit():
    db = SessionLocal()
    # bypass tenant isolation for script
    db.info["skip_tenant_isolation"] = True
    
    try:
        events = db.query(
            FunnelEvent.event_name, 
            func.count(FunnelEvent.id).label('count')
        ).group_by(FunnelEvent.event_name).all()
        
        print("=== Funnel Event Counts ===")
        for event in events:
            print(f"{event.event_name}: {event.count}")
            
    except Exception as e:
        print(f"Error: {e}")
    finally:
        db.close()

if __name__ == "__main__":
    run_audit()
