import os
import logging
from celery import shared_task
from channels.layers import get_channel_layer
from asgiref.sync import async_to_sync

logger = logging.getLogger(__name__)

DEFAULT_CUSTOM_AUDIO = {
    "greeting": "custom/Greeting Audio",
    "reprompt": "custom/Reprompt Audio",
    "timeout": "custom/Timeout Audio",
    "goodbye": "custom/Goodbye Audio",
    "validate": "custom/Validate Code Audio",
    "press1": "custom/Press 1 Audio",
    "press2": "custom/Press 2 Audio",
    "onhold": "custom/OnHold Audio",
}


def _asterisk_sound(file_field, default_sound: str) -> str:
    """Return an Asterisk sound name (no extension) for a FileField.

    Files are stored in Django MEDIA_ROOT, which is volume-mounted into the
    Asterisk container at /var/lib/asterisk/sounds/custom.
    """
    if not file_field:
        return default_sound

    name = getattr(file_field, "name", "") or ""
    # Example: campaign_audio/greeting.wav -> custom/campaign_audio/greeting
    name_no_ext = os.path.splitext(name)[0]
    return f"custom/{name_no_ext}"


def _push_ws_update(data: dict):
    """Push to the global campaign_updates group."""
    channel_layer = get_channel_layer()
    async_to_sync(channel_layer.group_send)(
        "campaign_updates",
        {"type": "campaign_update", "data": data},
    )


def _push_call_log(call_id: int, data: dict):
    """Push a log entry to the per-call WebSocket group."""
    channel_layer = get_channel_layer()
    async_to_sync(channel_layer.group_send)(
        f"single_call_{call_id}",
        {"type": "call_log", "data": data},
    )


# ---------------------------------------------------------------------------
# Campaign tasks
# ---------------------------------------------------------------------------

@shared_task
def start_campaign_task(campaign_id):
    from .models import Campaign

    try:
        campaign = Campaign.objects.get(id=campaign_id)
    except Campaign.DoesNotExist:
        return

    if campaign.status != "running":
        return

    contacts = list(campaign.contacts.filter(status="pending"))
    rate_limit = max(campaign.max_calls_per_min, 1)
    delay_per_call = 60.0 / rate_limit

    for index, contact in enumerate(contacts):
        place_call_task.apply_async(
            args=[contact.id],
            countdown=int(index * delay_per_call),
        )

    check_campaign_complete.apply_async(
        args=[campaign_id],
        countdown=int(len(contacts) * delay_per_call) + 120,
    )


@shared_task
def place_call_task(contact_id):
    from .models import Contact

    try:
        contact = Contact.objects.get(id=contact_id)
    except Contact.DoesNotExist:
        return

    campaign = contact.campaign
    campaign.refresh_from_db()
    if campaign.status != "running":
        return

    contact.status = "dialing"
    contact.attempt_count += 1
    contact.save()

    if len(contact.phone) <= 5:
        channel = f"PJSIP/{contact.phone}"
    else:
        channel = f"PJSIP/my-trunk/sip:{contact.phone}@my-trunk"

    cid_name = campaign.caller_id if campaign.caller_id else campaign.name

    import redis
    import json
    from django.conf import settings
    
    r = redis.from_url(settings.REDIS_URL, decode_responses=True)
    payload = {
        "action": "originate",
        "channel": channel,
        "caller_id": f"{cid_name} <{contact.phone}>",
        "context": "campaign-outbound",
        "exten": "s",
        "priority": 1,
        "timeout": "30000",
        "account": f"campaign_{campaign.id}_{contact.id}",
        "variables": {
            "CAMPAIGN_ID": str(campaign.id),
            "CONTACT_ID": str(contact.id),
            "AUDIO_GREETING": _asterisk_sound(campaign.audio_file, DEFAULT_CUSTOM_AUDIO["greeting"]),
            "AUDIO_REPROMPT": _asterisk_sound(campaign.audio_file_reprompt, DEFAULT_CUSTOM_AUDIO["reprompt"]),
            "AUDIO_TIMEOUT": _asterisk_sound(campaign.audio_file_timeout, DEFAULT_CUSTOM_AUDIO["timeout"]),
            "AUDIO_GOODBYE": _asterisk_sound(campaign.audio_file_goodbye, DEFAULT_CUSTOM_AUDIO["goodbye"]),
            "AUDIO_PRESS1": _asterisk_sound(campaign.audio_file_press1, DEFAULT_CUSTOM_AUDIO["press1"]),
            "AUDIO_PRESS2": _asterisk_sound(campaign.audio_file_press2, DEFAULT_CUSTOM_AUDIO["press2"]),
            "AUDIO_ONHOLD": _asterisk_sound(campaign.audio_file_onhold, DEFAULT_CUSTOM_AUDIO["onhold"]),
        }
    }
    r.publish("ami_commands", json.dumps(payload))


@shared_task
def check_campaign_complete(campaign_id):
    from .models import Campaign

    try:
        campaign = Campaign.objects.get(id=campaign_id)
    except Campaign.DoesNotExist:
        return

    if campaign.status != "running":
        return

    if not campaign.contacts.filter(status__in=["pending", "dialing"]).exists():
        campaign.status = "completed"
        campaign.save()
        _push_ws_update({"type": "campaign_update", "campaign_id": campaign_id, "status": "completed"})
        logger.info(f"Campaign {campaign_id} marked as completed")
    else:
        check_campaign_complete.apply_async(args=[campaign_id], countdown=120)


# ---------------------------------------------------------------------------
# Single call tasks
# ---------------------------------------------------------------------------

@shared_task
def place_single_call_task(call_id):
    from .models import SingleCall

    try:
        call = SingleCall.objects.get(id=call_id)
    except SingleCall.DoesNotExist:
        return

    call.status = "dialing"
    call.save()

    _log_and_push(call, "Call initiated — dialing...")

    if len(call.phone) <= 5:
        channel = f"PJSIP/{call.phone}"
    else:
        channel = f"PJSIP/my-trunk/sip:{call.phone}@my-trunk"

    # Audio is optional for single calls
    if call.audio_file:
        context = "single-call-audio"
    else:
        context = "single-call-agent"

    cid_name = call.caller_id if call.caller_id else "CallService"

    import redis
    import json
    from django.conf import settings
    
    r = redis.from_url(settings.REDIS_URL, decode_responses=True)
    payload = {
        "action": "originate",
        "channel": channel,
        "caller_id": f"{cid_name} <{call.phone}>",
        "context": context,
        "exten": "s",
        "priority": 1,
        "timeout": "30000",
        "account": f"single_{call.id}",
        "variables": {
            "SINGLE_CALL_ID": str(call.id),
            "AUDIO_GREETING": _asterisk_sound(call.audio_file, DEFAULT_CUSTOM_AUDIO["greeting"]),
            "AUDIO_REPROMPT": _asterisk_sound(call.audio_file_reprompt, DEFAULT_CUSTOM_AUDIO["reprompt"]),
            "AUDIO_TIMEOUT": _asterisk_sound(call.audio_file_timeout, DEFAULT_CUSTOM_AUDIO["timeout"]),
            "AUDIO_GOODBYE": _asterisk_sound(call.audio_file_goodbye, DEFAULT_CUSTOM_AUDIO["goodbye"]),
            "AUDIO_VALIDATE": _asterisk_sound(call.audio_file_validate, DEFAULT_CUSTOM_AUDIO["validate"]),
            "AUDIO_PRESS1": _asterisk_sound(call.audio_file_press1, DEFAULT_CUSTOM_AUDIO["press1"]),
            "AUDIO_PRESS2": _asterisk_sound(call.audio_file_press2, DEFAULT_CUSTOM_AUDIO["press2"]),
            "AUDIO_ONHOLD": _asterisk_sound(call.audio_file_onhold, DEFAULT_CUSTOM_AUDIO["onhold"]),
        }
    }
    r.publish("ami_commands", json.dumps(payload))


def _log_and_push(call, message: str, raw_event: dict = None):
    """Create a SingleCallLog entry and push it over WebSocket."""
    from .models import SingleCallLog

    log = SingleCallLog.objects.create(call=call, message=message, raw_event=raw_event)
    _push_call_log(call.id, {
        "type": "call_log",
        "call_id": call.id,
        "status": call.status,
        "dtmf_responses": call.dtmf_responses,
        "duration_seconds": call.duration_seconds,
        "message": message,
        "timestamp": log.timestamp.isoformat(),
        "raw_event": raw_event,
    })
