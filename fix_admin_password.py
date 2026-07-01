import psycopg2
import bcrypt

conn = psycopg2.connect("postgresql://postgres:password@localhost:5440/azzougshop")
conn.autocommit = True
cur = conn.cursor()

# Generate correct bcrypt hash
pwd = b"Admin123!"
hashed = bcrypt.hashpw(pwd, bcrypt.gensalt(12)).decode()
print("New hash:", hashed[:25], "...")

# Update the password
cur.execute(
    "UPDATE users SET hashed_password = %s WHERE email = %s",
    (hashed, "admin@azzougshop.com")
)
print("Rows updated:", cur.rowcount)

# Verify
cur.execute("SELECT id, email, role, is_active, hashed_password FROM users")
rows = cur.fetchall()
for r in rows:
    print(f"  id={r[0][:20]}... email={r[1]} role={r[2]} active={r[3]} hash_ok={r[4].startswith('$2b$')}")

cur.close()
conn.close()
print("Done.")
