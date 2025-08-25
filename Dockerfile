# Dockerfile
FROM python:3.12-slim

WORKDIR /app

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the script
COPY lib_config.py .
COPY lib_letterboxd.py .
COPY lib_radarr.py .
COPY lib_sync.py .
COPY main.py .

# Create volume for persistent data
VOLUME ["/app/data"]

# Run the script
CMD ["python", "-u", "main.py"]