from app.db.session import SessionLocal
from app.models.store import Store
db = SessionLocal()
store = db.query(Store).filter(Store.name.ilike('%trustshop%')).first()
if store:
    print(f'Store ID: {store.id}, Name: {store.name}')
else:
    print('Store not found')
