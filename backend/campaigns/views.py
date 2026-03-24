import csv
import re
import io
import json
import hashlib
import logging
import redis
from django.conf import settings
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from rest_framework.permissions import AllowAny
from .models import Campaign, Contact, CallLog, SingleCall, SingleCallLog, ProcessedWebhookEvent
from .serializers import (
    CampaignSerializer, ContactSerializer, CallLogSerializer,
    SingleCallSerializer, SingleCallLogSerializer,
)
from .tasks import start_campaign_task, place_single_call_task, _push_ws_update, _log_and_push

logger = logging.getLogger(__name__)

DIAL_STATUS_MAP = {
    "ANSWER": "answered",
    "BUSY": "busy",
    "NOANSWER": "no_answer",
    "CANCEL": "no_answer",
    "FAILED": "failed",
    "CONGESTION": "failed",
}


def _is_valid_phone(phone: str) -> bool:
    """Basic phone validation: must be digits (with optional +, -, parens, spaces) and 3-15 digits."""
    cleaned = _normalize_phone(phone)
    return cleaned.isdigit() and 3 <= len(cleaned) <= 15


def _normalize_phone(phone: str) -> str:
    """Normalize phone to digits-only form for consistent dedupe and dialing."""
    return re.sub(r"\D", "", phone or "")


def _event_idempotency_key(data: dict) -> str:
    """Build a deterministic event fingerprint to avoid duplicate processing."""
    key_payload = {
        "event": data.get("Event", ""),
        "single_call_id": data.get("SingleCallId", ""),
        "contact_id": data.get("ContactId", ""),
        "campaign_id": data.get("CampaignId", ""),
        "channel": data.get("Channel", ""),
        "digit": data.get("Digit", ""),
        "dial_status": data.get("DialStatus", ""),
        "cause": data.get("Cause", ""),
        "cause_txt": data.get("CauseTxt", ""),
        "duration": data.get("Duration", ""),
    }
    stable = json.dumps(key_payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(stable.encode("utf-8")).hexdigest()


# ---------------------------------------------------------------------------
# Campaign views
# ---------------------------------------------------------------------------

class CampaignViewSet(viewsets.ModelViewSet):
    queryset = Campaign.objects.all().order_by("-created_at")
    serializer_class = CampaignSerializer

    @action(detail=True, methods=["post"])
    def upload_contacts(self, request, pk=None):
        campaign = self.get_object()
        file = request.FILES.get("file")
        if not file:
            return Response({"error": "No file provided"}, status=status.HTTP_400_BAD_REQUEST)
        reader = csv.reader(io.StringIO(file.read().decode("utf-8")))
        contacts = []
        skipped = 0
        duplicates = 0
        existing = set(campaign.contacts.values_list("phone", flat=True))
        for row in reader:
            if not row or not row[0].strip():
                continue
            phone = _normalize_phone(row[0].strip())
            if _is_valid_phone(phone):
                if phone in existing:
                    duplicates += 1
                    continue
                contacts.append(Contact(campaign=campaign, phone=phone))
                existing.add(phone)
            else:
                skipped += 1
                logger.warning(f"Skipping invalid phone number: {phone}")
        Contact.objects.bulk_create(contacts)
        return Response(
            {
                "status": "Contacts uploaded",
                "count": len(contacts),
                "skipped": skipped,
                "duplicates": duplicates,
            }
        )

    def create(self, request, *args, **kwargs):
        name = request.data.get('name')
        caller_id = request.data.get('caller_id', '')
        audio_file = request.FILES.get('audio_file')
        audio_file_reprompt = request.FILES.get('audio_file_reprompt')
        audio_file_timeout = request.FILES.get('audio_file_timeout')
        audio_file_goodbye = request.FILES.get('audio_file_goodbye')
        audio_file_press1 = request.FILES.get('audio_file_press1')
        audio_file_press2 = request.FILES.get('audio_file_press2')

        if not name or not audio_file:
            return Response({"error": "Name and audio_file are required"}, status=status.HTTP_400_BAD_REQUEST)

        campaign = Campaign.objects.create(
            name=name,
            caller_id=caller_id,
            audio_file=audio_file,
            audio_file_reprompt=audio_file_reprompt,
            audio_file_timeout=audio_file_timeout,
            audio_file_goodbye=audio_file_goodbye,
            audio_file_press1=audio_file_press1,
            audio_file_press2=audio_file_press2
        )
        return Response(CampaignSerializer(campaign).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["get"])
    def contacts(self, request, pk=None):
        qs = self.get_object().contacts.all().order_by("id")
        return Response(ContactSerializer(qs, many=True).data)

    @action(detail=True, methods=["get"])
    def stats(self, request, pk=None):
        c = self.get_object().contacts
        return Response({
            "total": c.count(),
            "pending": c.filter(status="pending").count(),
            "dialing": c.filter(status="dialing").count(),
            "success": c.filter(status="success").count(),
            "busy": c.filter(status="busy").count(),
            "no_answer": c.filter(status="no_answer").count(),
            "failed": c.filter(status="failed").count(),
        })

    @action(detail=True, methods=["post"])
    def start(self, request, pk=None):
        campaign = self.get_object()
        if campaign.status == "running":
            return Response({"error": "Campaign already running"}, status=status.HTTP_400_BAD_REQUEST)
        if not campaign.contacts.filter(status="pending").exists():
            return Response({"error": "No pending contacts"}, status=status.HTTP_400_BAD_REQUEST)
        campaign.status = "running"
        campaign.save()
        start_campaign_task.delay(campaign.id)
        _push_ws_update({"type": "campaign_update", "campaign_id": campaign.id, "status": "running"})
        return Response({"status": "Campaign started"})

    @action(detail=True, methods=["post"])
    def pause(self, request, pk=None):
        campaign = self.get_object()
        if campaign.status != "running":
            return Response({"error": "Campaign is not running"}, status=status.HTTP_400_BAD_REQUEST)
        campaign.status = "paused"
        campaign.save()
        _push_ws_update({"type": "campaign_update", "campaign_id": campaign.id, "status": "paused"})
        return Response({"status": "Campaign paused"})

    @action(detail=True, methods=["post"])
    def stop(self, request, pk=None):
        campaign = self.get_object()
        if campaign.status not in ["running", "paused"]:
            return Response({"error": "Campaign is not active"}, status=status.HTTP_400_BAD_REQUEST)
        campaign.status = "completed"
        campaign.save()
        _push_ws_update({"type": "campaign_update", "campaign_id": campaign.id, "status": "completed"})
        return Response({"status": "Campaign stopped"})

    @action(detail=True, methods=["post"])
    def resume(self, request, pk=None):
        campaign = self.get_object()
        if campaign.status != "paused":
            return Response({"error": "Campaign is not paused"}, status=status.HTTP_400_BAD_REQUEST)
        campaign.status = "running"
        campaign.save()
        start_campaign_task.delay(campaign.id)
        _push_ws_update({"type": "campaign_update", "campaign_id": campaign.id, "status": "running"})
        return Response({"status": "Campaign resumed"})


# ---------------------------------------------------------------------------
# Single call views
# ---------------------------------------------------------------------------

class SingleCallViewSet(viewsets.ModelViewSet):
    queryset = SingleCall.objects.all().order_by("-created_at")
    serializer_class = SingleCallSerializer
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def create(self, request, *args, **kwargs):
        phone = _normalize_phone(request.data.get("phone", ""))
        if not _is_valid_phone(phone):
            return Response({"error": "Invalid phone number"}, status=status.HTTP_400_BAD_REQUEST)

        mutable_data = request.data.copy()
        mutable_data["phone"] = phone
        serializer = self.get_serializer(data=mutable_data)
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)
        headers = self.get_success_headers(serializer.data)
        return Response(serializer.data, status=status.HTTP_201_CREATED, headers=headers)

    @action(detail=True, methods=["post"])
    def dial(self, request, pk=None):
        call = self.get_object()
        if call.status not in ("idle", "failed", "no_answer", "busy", "completed"):
            return Response({"error": f"Cannot dial — call is {call.status}"}, status=status.HTTP_400_BAD_REQUEST)
        # Reset for redial
        call.status = "idle"
        call.dtmf_responses = ""
        call.duration_seconds = None
        call.save()
        place_single_call_task.delay(call.id)
        return Response({"status": "Dialing initiated"}) # Changed message

    @action(detail=True, methods=["get"])
    def logs(self, request, pk=None):
        call = self.get_object()
        qs = call.logs.all()
        return Response(SingleCallLogSerializer(qs, many=True).data)

    @action(detail=True, methods=["post"])
    def reprompt(self, request, pk=None):
        call = self.get_object()

        context = "single-call-audio" if call.audio_file else "single-call-agent"
        call.dtmf_responses = ""
        call.save(update_fields=["dtmf_responses", "updated_at"])
        
        # Publish redirect command to Redis
        r = redis.from_url(settings.REDIS_URL, decode_responses=True)
        payload = {
            "action": "redirect",
            "channel": getattr(call, "channel", ""),
            "single_call_id": str(call.id),
            "context": context,
            "exten": "reprompt",
            "priority": "1"
        }
        r.publish("ami_commands", json.dumps(payload))
        
        _log_and_push(call, "Admin requested DTMF reprompt")
        return Response({"status": "Reprompt command sent"})

    @action(detail=True, methods=["post"])
    def connect_agent(self, request, pk=None):
        call = self.get_object()

        context = "single-call-audio" if call.audio_file else "single-call-agent"
        
        # Publish redirect command to Redis to connect to agent
        r = redis.from_url(settings.REDIS_URL, decode_responses=True)
        payload = {
            "action": "redirect",
            "channel": getattr(call, "channel", ""),
            "single_call_id": str(call.id),
            "context": context,
            "exten": "connect_agent",
            "priority": "1"
        }
        r.publish("ami_commands", json.dumps(payload))
        
        _log_and_push(call, "Admin connecting caller to agent")
        return Response({"status": "Connect to agent command sent"})

    @action(detail=True, methods=["post"])
    def hangup(self, request, pk=None):
        call = self.get_object()
        
        # Determine appropriate dialplan context
        context = "single-call-audio" if call.audio_file else "single-call-agent"
        
        r = redis.from_url(settings.REDIS_URL, decode_responses=True)
        # If call hasn't answered yet, physically drop the line
        if call.status in ["ringing", "dialing"]:
            payload = {
                "action": "hangup",
                "channel": getattr(call, "channel", ""),
                "single_call_id": str(call.id)
            }
        else:
            # If answered or holding, politely redirect to Goodbye message
            payload = {
                "action": "redirect",
                "channel": getattr(call, "channel", ""),
                "single_call_id": str(call.id),
                "context": context,
                "exten": "end_call",
                "priority": "1"
            }
        r.publish("ami_commands", json.dumps(payload))
        
        _log_and_push(call, "Admin requested to end the call")
        return Response({"status": "Hangup requested"})

# ---------------------------------------------------------------------------
# Webhook — receives events from ami_listener
# ---------------------------------------------------------------------------

class CallEventWebhook(APIView):
    permission_classes = [AllowAny]  # Authenticated via X-Webhook-Secret header

    def post(self, request):
        # Validate secret
        secret = request.headers.get("X-Webhook-Secret")
        if secret != settings.WEBHOOK_SECRET:
            logger.warning("Webhook: Invalid secret provided")
            return Response({"error": "Unauthorized"}, status=status.HTTP_401_UNAUTHORIZED)

        data = request.data
        event_type = data.get("Event")
        contact_id = data.get("ContactId")
        single_call_id = data.get("SingleCallId")

        # Idempotency guard for known contact/single-call events
        idempotent_events = {"Ringing", "Answered", "Hangup"}
        if event_type in idempotent_events and (contact_id or single_call_id):
            event_key = _event_idempotency_key(data)
            _, created = ProcessedWebhookEvent.objects.get_or_create(event_key=event_key)
            if not created:
                logger.info("Webhook: duplicate event ignored")
                return Response({"status": "received"})

        # --- Single call event ---
        if single_call_id:
            try:
                call = SingleCall.objects.get(id=single_call_id)
            except SingleCall.DoesNotExist:
                logger.warning(f"Webhook: SingleCall {single_call_id} not found")
                return Response({"status": "received"})

            if event_type == "Ringing":
                call.status = "ringing"
                if "Channel" in data:
                    call.channel = data["Channel"]
                call.save()
                _log_and_push(call, "Phone is ringing...", data)

            elif event_type == "Answered":
                call.status = "answered"
                if "Channel" in data:
                    call.channel = data["Channel"]
                call.save()
                _log_and_push(call, "Call answered", data)

            elif event_type == "DTMFReceived":
                digit = data.get("Digit", "")
                call.dtmf_responses = digit
                call.save()
                _log_and_push(call, f"DTMF digit received: {digit}", data)

            elif event_type == "Hangup":
                dial_status = data.get("DialStatus", "").upper()
                cause_txt = data.get("CauseTxt", "")
                call.status = DIAL_STATUS_MAP.get(dial_status, "completed")
                duration = data.get("Duration")
                if duration:
                    call.duration_seconds = int(duration)
                call.save()
                msg = f"Call ended — {dial_status or 'HANGUP'}"
                if cause_txt:
                    msg += f" ({cause_txt})"
                if call.duration_seconds:
                    msg += f" — duration: {call.duration_seconds}s"
                _log_and_push(call, msg, data)

            return Response({"status": "received"})

        # --- Campaign contact event ---
        if contact_id:
            try:
                contact = Contact.objects.get(id=contact_id)
            except Contact.DoesNotExist:
                logger.warning(f"Webhook: Contact {contact_id} not found")
                return Response({"status": "received"})

            campaign_status_map = {
                "ANSWER": "success",
                "BUSY": "busy",
                "NOANSWER": "no_answer",
                "CANCEL": "no_answer",
                "FAILED": "failed",
                "CONGESTION": "failed",
            }

            if event_type == "Hangup":
                dial_status = data.get("DialStatus", "").upper()
                contact.status = campaign_status_map.get(dial_status, "failed")
                contact.save()
            elif event_type == "DTMFReceived":
                contact.dtmf_response = data.get("Digit", "")
                contact.status = "success"
                contact.save()

            CallLog.objects.create(contact=contact, event=data)
            _push_ws_update({
                "type": "contact_update",
                "contact_id": contact.id,
                "phone": contact.phone,
                "status": contact.status,
                "dtmf_response": contact.dtmf_response,
                "campaign_id": contact.campaign.id,
            })

        return Response({"status": "received"})
