import os
import logging
import random
import hashlib
import subprocess
from pathlib import Path
from celery import shared_task
from channels.layers import get_channel_layer
from asgiref.sync import async_to_sync
from django.conf import settings

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


def _synthesize_tts_sound(text: str, prefix: str) -> str | None:
    """Generate or reuse a WAV TTS file and return Asterisk sound name."""
    cleaned = (text or "").strip()
    if not cleaned:
        return None

    out_dir = Path(settings.MEDIA_ROOT) / "tts_prompts"
    out_dir.mkdir(parents=True, exist_ok=True)

    digest = hashlib.sha1(cleaned.encode("utf-8")).hexdigest()[:16]
    filename = f"{prefix}_{digest}.wav"
    out_path = out_dir / filename

    if not out_path.exists():
        cmd = [
            "espeak",
            "-s",
            str(getattr(settings, "TTS_SPEECH_RATE", 145)),
            "-v",
            getattr(settings, "TTS_VOICE", "en"),
            "-w",
            str(out_path),
            cleaned,
        ]
        try:
            subprocess.run(cmd, check=True, capture_output=True, text=True)
        except Exception as exc:
            logger.warning(f"TTS generation failed: {exc}")
            return None

    return f"custom/tts_prompts/{filename[:-4]}"


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
    from .models import SingleCall, AudioTemplate

    try:
        call = SingleCall.objects.select_related("selected_template", "press1_template").get(id=call_id)
    except SingleCall.DoesNotExist:
        return

    call.status = "dialing"
    call.save()

    _log_and_push(call, "Call initiated — dialing...")

    if len(call.phone) <= 5:
        channel = f"PJSIP/{call.phone}"
    else:
        channel = f"PJSIP/my-trunk/sip:{call.phone}@my-trunk"

    # Priority 1: Use the template if selected
    tpl = call.selected_template
    
    # Determine effectively active mode
    mode = tpl.mode if tpl else (call.mode or "audio_only")
    
    # Determine dialplan context
    # If it's a template/script mode, we use single-call-audio as it handles TTS logic
    # If no audio is provided and it's audio_only, it might be an agent-only call
    context = "single-call-audio"
    if mode == "audio_only" and not (tpl and tpl.greeting_audio) and not call.audio_file:
        context = "single-call-agent"

    cid_name = call.caller_id if call.caller_id else "CallService"
    expected_digits = max(0, min(int(call.expected_digits or 4), 10))
    tts_enabled = getattr(settings, "TTS_ENABLED", True)
    
    greeting_mode = "single"
    dynamic_intro_sound = None
    dynamic_greeting_sound = None
    dynamic_outro_sound = None
    dynamic_press1_sound = None

    # Resolve Greeting Mode and Sounds
    if tts_enabled and mode == "tts_script":
        # Full Custom Script - Playback only, no digits
        raw_script = tpl.greeting_script if tpl else call.tts_script
        final_script = raw_script.replace("{recipient_name}", call.recipient_name or "there")
        final_script = final_script.replace("{caller_id}", call.caller_id or "the service")
        
        # Play the full script and hang up
        greeting_mode = "playback"
        dynamic_greeting_sound = _synthesize_tts_sound(final_script, "greeting")
        expected_digits = 0
        dynamic_intro_sound = None
        dynamic_outro_sound = None

    # Determine Press 1 instructions if we expect digits
    # This now runs for ALL modes (audio_only, etc.)
    if expected_digits > 0:
        # Check if we have a press1_template selected
        if call.press1_template and call.press1_template.greeting_audio:
            dynamic_press1_sound = _asterisk_sound(call.press1_template.greeting_audio, "")
        else:
            press1_text = f"Enter your {expected_digits} digit answer and press the pound key when done."
            dynamic_press1_sound = _synthesize_tts_sound(press1_text, "press1")

    # Final variable assembly
    # Order of priority for constants: SingleCall override -> Global Default (Template fields removed as constants)
    def _res(call_field, def_key):
        if call_field: return _asterisk_sound(call_field, "")
        return DEFAULT_CUSTOM_AUDIO[def_key]

    variables = {
        "SINGLE_CALL_ID": str(call.id),
        "GREETING_MODE": greeting_mode,
        "EXPECTED_DIGITS": str(expected_digits),
        "AUDIO_GREETING": _res(call.audio_file, "greeting") if not tpl else _asterisk_sound(tpl.greeting_audio, ""),
        "AUDIO_GREETING_INTRO": dynamic_intro_sound or "",
        "AUDIO_GREETING_TTS": dynamic_greeting_sound or "",
        "AUDIO_GREETING_OUTRO": dynamic_outro_sound or "",
        "AUDIO_REPROMPT": _res(call.audio_file_reprompt, "reprompt"),
        "AUDIO_TIMEOUT": _res(call.audio_file_timeout, "timeout"),
        "AUDIO_GOODBYE": _res(call.audio_file_goodbye, "goodbye"),
        "AUDIO_VALIDATE": _res(call.audio_file_validate, "validate"),
        "AUDIO_PRESS1": dynamic_press1_sound or _res(call.audio_file_press1, "press1"),
        "AUDIO_PRESS2": _res(call.audio_file_press2, "press2"),
        "AUDIO_ONHOLD": _res(call.audio_file_onhold, "onhold"),
    }

    import redis
    import json
    
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
        "variables": variables
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
