FROM python:3.11-slim

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE 1
ENV PYTHONUNBUFFERED 1

WORKDIR /app

# No apt-get/build-essential/libpq-dev/gcc needed: every dependency below
# (psycopg2-binary included — it bundles its own libpq, no libpq-dev headers
# or compiler required) ships a precompiled manylinux wheel for this exact
# Python 3.11 slim image, and nothing in the app shells out to psql/pg_dump.
# That apt-get layer was pulling ~98MB across 81 packages (full gcc/g++
# toolchain + postgresql-client-17) on every build with no cache hit —
# the actual cause of the build timing out before pip install ever ran.

# Install python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the code
COPY . .

# Make start script executable
RUN chmod +x start.sh

# Expose the port FastAPI will run on
EXPOSE 8000

# Start command
CMD ["./start.sh"]
