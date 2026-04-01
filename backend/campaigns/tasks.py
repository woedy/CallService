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
    """Generate or reuse a WAV TTS file (Piper) converted to 8kHz Mono (Sox)."""
    cleaned = (text or "").strip()
    if not cleaned:
        return None

    out_dir = Path(settings.MEDIA_ROOT) / "tts_prompts"
    out_dir.mkdir(parents=True, exist_ok=True)

    digest = hashlib.sha1(cleaned.encode("utf-8")).hexdigest()[:16]
    final_filename = f"{prefix}_{digest}.wav"
    final_path = out_dir / final_filename

    # If the converted 8k file already exists, reuse it
    if final_path.exists():
        return f"custom/tts_prompts/{final_filename[:-4]}"

    # Paths for processing
    tmp_raw = f"/tmp/{prefix}_{digest}_raw.wav"
    model_path = "/usr/share/piper-models/en_US-lessac-medium.onnx"

    try:
        # Step 1: Synthesize with Piper (outputs standard WAV, usually 22050Hz)
        piper_cmd = [
            "piper",
            "--model", model_path,
            "--output_file", tmp_raw,
        ]
        subprocess.run(piper_cmd, input=cleaned, text=True, check=True, capture_output=True)

        # Step 2: Convert to 8000Hz Mono with Sox for Asterisk compatibility
        sox_cmd = [
            "sox",
            tmp_raw,
            "-r", "8000",
            "-c", "1",
            str(final_path),
        ]
        subprocess.run(sox_cmd, check=True, capture_output=True)

        # Cleanup intermediate file
        if os.path.exists(tmp_raw):
            os.remove(tmp_raw)

    except Exception as exc:
        logger.warning(f"TTS Synthesis/Conversion failed: {exc}")
        # Fallback to espeak if piper/sox fails during transition
        try:
            espeak_tmp = f"/tmp/{prefix}_{digest}_espeak.wav"
            espeak_cmd = ["espeak", "-w", espeak_tmp, cleaned]
            subprocess.run(espeak_cmd, check=True)
            
            # Use sox to ensure the fallback is also 8kHz Mono
            sox_cmd_fallback = ["sox", espeak_tmp, "-r", "8000", "-c", "1", str(final_path)]
            subprocess.run(sox_cmd_fallback, check=True, capture_output=True)
            
            if os.path.exists(espeak_tmp):
                os.remove(espeak_tmp)
        except Exception as espeak_exc:
            logger.error(f"Espeak fallback also failed: {espeak_exc}")
            return None

    return f"custom/tts_prompts/{final_filename[:-4]}"


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
        call = SingleCall.objects.select_related(
            "greeting_template", "press1_template", "press2_template",
            "reprompt_template", "timeout_template", "validate_template",
            "goodbye_template", "onhold_template", "tts_script_template"
        ).get(id=call_id)
    except SingleCall.DoesNotExist:
        return

    call.status = "dialing"
    call.save()

    _log_and_push(call, "Call initiated — dialing...")

    if len(call.phone) <= 5:
        channel = f"PJSIP/{call.phone}"
    else:
        channel = f"PJSIP/my-trunk/sip:{call.phone}@my-trunk"

    # Dialplan context
    # If no audio is provided for greeting and it's audio_only, it might be an agent-only call
    context = "single-call-audio"
    if call.mode == "audio_only" and not call.greeting_template and not call.audio_file:
        context = "single-call-agent"

    expected_digits = max(0, min(int(call.expected_digits or 4), 10))
    tts_enabled = getattr(settings, "TTS_ENABLED", True)
    
    # Helper to resolve sound for a stage
    def resolve_sound(stage_pref, tpl, script_override, manual_file, default_key):
        # Apply placeholders to any script
        def clean_script(text):
            if not text: return None
            t = text.replace("{recipient_name}", call.recipient_name or "there")
            t = t.replace("{caller_id}", call.caller_id or "the service")
            return t

        # 1. Manual Script Override
        if tts_enabled and call.mode == "tts_script" and script_override:
            s = _synthesize_tts_sound(clean_script(script_override), stage_pref)
            if s: return s
        
        # 2. Template Script
        if tts_enabled and call.mode == "tts_script" and tpl and tpl.greeting_script:
            s = _synthesize_tts_sound(clean_script(tpl.greeting_script), stage_pref)
            if s: return s
            
        # 3. TTS Script Template (New)
        if tts_enabled and call.mode == "tts_script" and call.tts_script_template:
            if stage_pref == "onhold" and call.tts_script_template.onhold_audio:
                return _asterisk_sound(call.tts_script_template.onhold_audio, "")
            script = getattr(call.tts_script_template, f"{stage_pref}_script", None)
            if script:
                s = _synthesize_tts_sound(clean_script(script), stage_pref)
                if s: return s

        # 4. Manual File Override
        if manual_file:
            return _asterisk_sound(manual_file, "")
            
        # 5. Template File
        if tpl and tpl.greeting_audio:
            return _asterisk_sound(tpl.greeting_audio, "")
            
        # 6. Default
        return DEFAULT_CUSTOM_AUDIO[default_key]

    # Resolve all sounds
    variables = {
        "SINGLE_CALL_ID": str(call.id),
        "EXPECTED_DIGITS": str(expected_digits),
        "GREETING_MODE": "single" if (expected_digits > 0 or call.mode == "audio_only") else "playback",
        
        "AUDIO_GREETING": resolve_sound("greeting", call.greeting_template, call.greeting_script, call.audio_file, "greeting"),
        "AUDIO_PRESS1": resolve_sound("press1", call.press1_template, call.press1_script, call.audio_file_press1, "press1"),
        "AUDIO_PRESS2": resolve_sound("press2", call.press2_template, call.press2_script, call.audio_file_press2, "press2"),
        "AUDIO_REPROMPT": resolve_sound("reprompt", call.reprompt_template, call.reprompt_script, call.audio_file_reprompt, "reprompt"),
        "AUDIO_TIMEOUT": resolve_sound("timeout", call.timeout_template, call.timeout_script, call.audio_file_timeout, "timeout"),
        "AUDIO_VALIDATE": resolve_sound("validate", call.validate_template, call.validate_script, call.audio_file_validate, "validate"),
        "AUDIO_GOODBYE": resolve_sound("goodbye", call.goodbye_template, call.goodbye_script, call.audio_file_goodbye, "goodbye"),
        "AUDIO_ONHOLD": resolve_sound("onhold", call.onhold_template, call.onhold_script, call.audio_file_onhold, "onhold"),
    }

    # Backward compatibility for split mode if needed (though we simplified it here)
    variables["AUDIO_GREETING_INTRO"] = ""
    variables["AUDIO_GREETING_TTS"] = variables["AUDIO_GREETING"]
    variables["AUDIO_GREETING_OUTRO"] = ""

    logger.info(f"Asterisk Variables for Call {call.id}: {variables}")

    import redis
    import json
    
    r = redis.from_url(settings.REDIS_URL, decode_responses=True)
    payload = {
        "action": "originate",
        "channel": channel,
        "caller_id": f"{call.caller_id or 'CallService'} <{call.phone}>",
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
