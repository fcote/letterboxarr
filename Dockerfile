# Multi-stage Dockerfile for Letterboxarr with web interface

# Stage 1: Build React frontend
FROM node:18-alpine as frontend-build
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2: Python backend with frontend
FROM python:3.12-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# Copy Python requirements and install dependencies
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy Python application
COPY *.py ./

# Copy built frontend
COPY --from=frontend-build /app/frontend/build ./frontend/build

# Create data directory
RUN mkdir -p ./data

# Expose ports
EXPOSE 7373 8080

# Default command runs web server
CMD ["python", "web_server.py"]