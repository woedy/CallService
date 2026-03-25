FROM python:3.11-slim

WORKDIR /app

# Install system deps for psycopg2, espeak, sox, and curl
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq-dev gcc espeak sox libsox-fmt-all curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install Piper TTS
RUN curl -L https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_linux_x86_64.tar.gz | tar -xzC /usr/local/bin --strip-components=1

# Download Piper model (en_US-lessac-medium)
RUN mkdir -p /usr/share/piper-models && \
    curl -L https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx?download=true -o /usr/share/piper-models/en_US-lessac-medium.onnx && \
    curl -L https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx.json?download=true -o /usr/share/piper-models/en_US-lessac-medium.onnx.json

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Default command (overridden by docker-compose)
CMD ["daphne", "-b", "0.0.0.0", "-p", "8000", "config.asgi:application"]
