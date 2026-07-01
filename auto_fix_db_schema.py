import os
import sys
from sqlalchemy import create_engine, MetaData, Table, text

# Add current directory to path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from app.db.base_class import Base
# Import all models to ensure they are registered with Base.metadata
from app.models import user, store, product, order, customer, finance, pos, partner, promotion, audit, stock, warehouse

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    print("Error: DATABASE_URL not set.")
    sys.exit(1)

print(f"Connecting to database...")
engine = create_engine(DATABASE_URL)
metadata = MetaData()
metadata.reflect(bind=engine)

print("Creating any missing tables defined in Python models...")
Base.metadata.create_all(bind=engine)
# Re-reflect after creating missing tables
metadata.clear()
metadata.reflect(bind=engine)

# Map SQLAlchemy column types to SQL types for ALTER TABLE
def get_sql_type(column):
    from sqlalchemy.sql import sqltypes
    t = column.type
    if isinstance(t, sqltypes.String):
        return "VARCHAR"
    elif isinstance(t, sqltypes.Integer):
        return "INTEGER"
    elif isinstance(t, sqltypes.Boolean):
        return "BOOLEAN"
    elif isinstance(t, sqltypes.DateTime):
        return "TIMESTAMP"
    elif isinstance(t, sqltypes.JSON):
        return "JSON"
    elif isinstance(t, sqltypes.Text):
        return "TEXT"
    # Default fallback
    return str(t)

with engine.connect() as conn:
    for mapper in Base.registry.mappers:
        model_class = mapper.class_
        if not hasattr(model_class, "__tablename__"):
            continue
        
        tablename = model_class.__tablename__
        if tablename not in metadata.tables:
            print(f"Table '{tablename}' does not exist in database. Skipping.")
            continue
            
        db_table = Table(tablename, metadata, autoload_with=engine)
        
        # Check columns
        for column in model_class.__table__.columns:
            colname = column.name
            if colname not in db_table.columns:
                print(f"Column '{colname}' is missing in table '{tablename}'. Adding it...")
                sql_type = get_sql_type(column)
                
                # Handle default values
                default_str = "NULL"
                if column.default is not None:
                    # Get constant default value if applicable
                    if hasattr(column.default, "arg") and not callable(column.default.arg):
                        arg = column.default.arg
                        if isinstance(arg, bool):
                            default_str = "TRUE" if arg else "FALSE"
                        elif isinstance(arg, (int, float)):
                            default_str = str(arg)
                        elif isinstance(arg, str):
                            default_str = f"'{arg}'"
                
                alter_query = f"ALTER TABLE {tablename} ADD COLUMN {colname} {sql_type}"
                if default_str != "NULL":
                    alter_query += f" DEFAULT {default_str}"
                
                print(f"Executing: {alter_query}")
                try:
                    conn.execute(text(alter_query))
                    conn.commit()
                    print(f"Successfully added column '{colname}' to table '{tablename}'.")
                except Exception as e:
                    print(f"Error adding column '{colname}' to table '{tablename}': {e}")
                    conn.rollback()

print("Schema sync completed successfully!")
