# Voice Calling Marketing MVP

Django + Celery + Channels + Asterisk + React

## Stack

- **Backend**: Django 5, Django REST Framework, Daphne (ASGI), Django Channels
- **Workers**: Celery with Redis broker
- **Realtime**: Django Channels + Redis channel layer (WebSockets)
- **Telephony**: Asterisk (PJSIP) + AMI listener service (panoramisk)
- **Frontend**: React + Vite + Tailwind CSS
- **Database**: PostgreSQL
- **Cache/Broker**: Redis

---

## Local Development

### Prerequisites
- Docker + Docker Compose

### Start everything

```bash
docker-compose up -d --build
```

This will:
- Run migrations automatically
- Start Daphne (ASGI server with WebSocket support)
- Start Celery worker
- Start the AMI listener (connects to Asterisk and bridges events to Django)
- Start the React dev server

### Access
- Frontend: http://localhost:5173
- Backend API: http://localhost:8000/api/
- Admin: http://localhost:8000/admin/
- Asterisk AMI: port 5038

### Create a superuser

```bash
docker-compose exec backend python manage.py createsuperuser
```

---

## Testing Calls Locally (without a SIP trunk)

1. Install [Zoiper](https://www.zoiper.com/) or Linphone on your machine
2. Register as extension `6001` using:
   - SIP server: `localhost`
   - Username: `6001`
   - Password: `unsecurepassword`
3. Create a campaign, upload a CSV with `6001` as the phone number
4. Start the campaign — Zoiper will ring

---

## Production (Ubuntu + Coolify)

### Asterisk (run on the host, NOT in Coolify)

Asterisk needs raw UDP ports for SIP/RTP which don't work behind Coolify's Traefik proxy.

```bash
# On your Ubuntu server, outside of Coolify
docker-compose -f docker-compose.prod.yml up -d asterisk
```

Or install Asterisk directly on the host and point `ASTERISK_HOST` to `host.docker.internal` or the server's internal IP.

### Django + Celery + Frontend (deploy via Coolify)

1. Copy `.env.example` to `.env` and fill in values
2. In Coolify, create a new Docker Compose deployment
3. Point it at this repo, use `docker-compose.prod.yml`
4. Set environment variables in Coolify's UI (from `.env.example`)
5. Set `VITE_API_URL` and `VITE_WS_URL` in the frontend build environment

### SIP Trunk (for real outbound calls)

Update `asterisk/pjsip.conf` with your provider credentials (Telnyx, Vonage, Twilio SIP, etc.) and update the channel string in `backend/campaigns/tasks.py`.

---

## Audio Files

Asterisk works best with:
- **WAV**: 8kHz, 16-bit, mono (PCM)
- **GSM**: 8kHz mono

Convert with ffmpeg:
```bash
ffmpeg -i input.mp3 -ar 8000 -ac 1 -acodec pcm_s16le output.wav
```

---

## How Campaigns Work

1. Create a campaign + upload audio file
2. Upload a CSV of phone numbers
3. Click "Start" — Django queues `place_call_task` for each contact via Celery
4. Celery writes `.call` files to `/var/spool/asterisk/outgoing`
5. Asterisk picks up the call file, dials the number, plays the audio, captures DTMF
6. Asterisk fires AMI events (Hangup, UserEvent/DTMFReceived)
7. The `ami_listener` service catches these and POSTs to `/api/call-events/`
8. Django updates contact status and pushes real-time updates via WebSocket
9. Frontend receives updates and refreshes stats live

---

## Single Call

The Single Call page (`/calls`) lets you dial one number manually and watch the full call lifecycle in real time.

### Two modes

**Audio mode** — upload a WAV/GSM file when creating the call. Asterisk will:
- Answer the call
- Play your audio file
- Wait up to 10 seconds for a DTMF digit
- Fire a `DTMFReceived` event with the digit pressed
- Transfer to ext `6001` if the caller presses `1`, otherwise hang up

**Agent mode** — leave the audio file blank. Asterisk will:
- Answer the call
- Immediately bridge it to ext `6001` so a live agent can speak
- Hang up when either party disconnects

### Live log

Every event during the call streams in real time to a terminal-style log panel on the page:
- Call initiated
- Phone ringing
- Call answered
- DTMF digit(s) received
- Call ended (with cause and duration)

### Call history

All past single calls are listed in the sidebar. Click any entry to reload its stored logs and reconnect the WebSocket in case the call is still active.

### Testing locally

1. Register Zoiper/Linphone as ext `6001` (see local testing section above)
2. Go to `/calls`, enter `6001` as the phone number
3. Optionally attach an audio file
4. Click Dial — Zoiper will ring and you'll see events stream in live

### API endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/single-calls/` | List all single calls |
| `POST` | `/api/single-calls/` | Create a call record (multipart, includes optional `audio_file`) |
| `GET` | `/api/single-calls/<id>/` | Get a single call with embedded logs |
| `POST` | `/api/single-calls/<id>/dial/` | Trigger the dial for an existing call record |
| `GET` | `/api/single-calls/<id>/logs/` | Get all log entries for a call |

### WebSocket

Each call gets its own scoped WebSocket channel:

```
ws://localhost:8000/ws/calls/<call_id>/
```

Messages are JSON with this shape:

```json
{
  "type": "call_log",
  "call_id": 5,
  "status": "ringing",
  "message": "Phone is ringing...",
  "timestamp": "2026-03-21T10:00:00Z",
  "raw_event": { ... }
}
```
Account Name: CallService Local
SIP Server: localhost
SIP Proxy: 5061
Username: 6001
Domain: localhost
Password: unsecurepassword
Display Name: Agent 6001
Transport: UDP


Account Name	CallService Admin
SIP Server	localhost (or 192.168.1.11 if different machine)
SIP Proxy	5061 (standard SIP port, not 5061)
Username	6002
Domain	localhost
Password	6002
Display Name	Agent 6002
Transport	UDP