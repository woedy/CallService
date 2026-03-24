"""
AMI Listener — connects to Asterisk Manager Interface via panoramisk,
listens for call events, and POSTs them to the Django webhook.

Handles both campaign contacts (ContactId) and single calls (SingleCallId).
"""
import asyncio
import logging
import os
import json
import aiohttp
import panoramisk
import redis.asyncio as redis

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

AMI_HOST = os.environ.get("ASTERISK_HOST", "asterisk")
AMI_PORT = int(os.environ.get("ASTERISK_PORT", 5038))
AMI_USER = os.environ.get("ASTERISK_USER", "django")
AMI_SECRET = os.environ.get("ASTERISK_PASSWORD", "django_secret")
WEBHOOK_URL = os.environ.get("WEBHOOK_URL", "http://backend:8000/api/call-events/")
WEBHOOK_SECRET = os.environ.get("WEBHOOK_SECRET")
if not WEBHOOK_SECRET:
    raise RuntimeError("WEBHOOK_SECRET environment variable is required")
REDIS_URL = os.environ.get("REDIS_URL", "redis://redis:6379/0")

# Redis key prefix for channel tracking
CHANNEL_PREFIX = "ami_channel:"


async def post_event(session: aiohttp.ClientSession, payload: dict, max_retries: int = 3):
    headers = {"X-Webhook-Secret": WEBHOOK_SECRET}
    for attempt in range(max_retries):
        try:
            async with session.post(
                WEBHOOK_URL,
                json=payload,
                headers=headers,
                timeout=aiohttp.ClientTimeout(total=5)
            ) as resp:
                if resp.status == 200:
                    return
                logger.warning(f"Webhook {resp.status} for {payload.get('Event')} (attempt {attempt + 1}/{max_retries})")
        except Exception as e:
            logger.error(f"Webhook POST failed (attempt {attempt + 1}/{max_retries}): {e}")
        if attempt < max_retries - 1:
            await asyncio.sleep(2 ** attempt)
    logger.error(f"Webhook POST permanently failed for {payload.get('Event')}: {payload}")


async def main():
    manager = panoramisk.Manager(
        host=AMI_HOST,
        port=AMI_PORT,
        username=AMI_USER,
        secret=AMI_SECRET,
        ssl=False,
        encoding="utf-8",
        ping_delay=10,
        ping_interval=10,
        reconnect_timeout=5,
    )

    async with aiohttp.ClientSession() as session:
        redis_client = redis.from_url(REDIS_URL, decode_responses=True)

        # ------------------------------------------------------------------
        # Newchannel — register channel so we can track it through its life
        # ------------------------------------------------------------------
        @manager.register_event("VarSet")
        async def on_varset(manager, event):
            """Capture channel variables set by the dialplan (our IDs)."""
            channel = event.get("Channel", "")
            var = event.get("Variable", "")
            val = event.get("Value", "")
            if var in ("SINGLE_CALL_ID", "CONTACT_ID", "CAMPAIGN_ID") and channel:
                key = f"{CHANNEL_PREFIX}{channel}"
                # Store as JSON in Redis with 2-hour expiry
                current = await redis_client.get(key)
                meta = json.loads(current) if current else {}
                meta[var] = val
                await redis_client.set(key, json.dumps(meta), ex=7200)

        # ------------------------------------------------------------------
        # Channel state changes (Ringing, Up/Answered)
        # ------------------------------------------------------------------
        @manager.register_event("Newstate")
        async def on_newstate(manager, event):
            channel = event.get("Channel", "")
            state = event.get("ChannelStateDesc", "")
            
            current = await redis_client.get(f"{CHANNEL_PREFIX}{channel}")
            meta = json.loads(current) if current else {}
            single_call_id = meta.get("SINGLE_CALL_ID")
            
            if not single_call_id:
                return

            if state == "Ringing":
                await post_event(session, {
                    "Event": "Ringing",
                    "SingleCallId": single_call_id,
                    "Channel": channel,
                })
                logger.info(f"Ringing — SingleCall {single_call_id}")
            
            elif state == "Up":
                await post_event(session, {
                    "Event": "Answered",
                    "SingleCallId": single_call_id,
                    "Channel": channel,
                })
                logger.info(f"Answered — SingleCall {single_call_id}")

        # ------------------------------------------------------------------
        # Hangup — final cleanup for both types
        # ------------------------------------------------------------------
        @manager.register_event("Hangup")
        async def on_hangup(manager, event):
            channel = event.get("Channel", "")
            key = f"{CHANNEL_PREFIX}{channel}"
            current = await redis_client.get(key)
            meta = json.loads(current) if current else {}
            await redis_client.delete(key) # Clean up on hangup

            single_call_id = meta.get("SINGLE_CALL_ID")
            contact_id = meta.get("CONTACT_ID")
            cause_txt = event.get("Cause-txt", "")
            cause = event.get("Cause", "")

            if single_call_id:
                await post_event(session, {
                    "Event": "Hangup",
                    "SingleCallId": single_call_id,
                    "DialStatus": event.get("DialStatus", ""),
                    "CauseTxt": cause_txt,
                    "Cause": cause,
                    "Channel": channel,
                    "Duration": event.get("Duration", ""),
                })
                logger.info(f"Hangup — SingleCall {single_call_id} cause={cause_txt}")

            elif contact_id:
                await post_event(session, {
                    "Event": "Hangup",
                    "ContactId": contact_id,
                    "DialStatus": event.get("DialStatus", ""),
                    "Channel": channel,
                    "Cause": cause,
                    "CauseTxt": cause_txt,
                })
                logger.info(f"Hangup — Contact {contact_id} cause={cause_txt}")

        # ------------------------------------------------------------------
        # UserEvent — DTMF for both types
        # ------------------------------------------------------------------
        @manager.register_event("UserEvent")
        async def on_user_event(manager, event):
            if event.get("UserEvent") != "DTMFReceived":
                return

            single_call_id = event.get("SingleCallId") or event.get("Singlecallid")
            contact_id = event.get("ContactId") or event.get("Contactid")
            digit = event.get("Digit", "")

            if single_call_id:
                await post_event(session, {
                    "Event": "DTMFReceived",
                    "SingleCallId": single_call_id,
                    "Digit": digit,
                })
                logger.info(f"DTMF '{digit}' — SingleCall {single_call_id}")

            elif contact_id:
                await post_event(session, {
                    "Event": "DTMFReceived",
                    "ContactId": contact_id,
                    "Digit": digit,
                    "CampaignId": event.get("CampaignId", ""),
                })
                logger.info(f"DTMF '{digit}' — Contact {contact_id}")

        logger.info(f"Connecting to Asterisk AMI at {AMI_HOST}:{AMI_PORT}")
        await manager.connect()
        logger.info("AMI listener connected and running")

        # Redis listener for AMI commands
        async def listen_for_commands():
            pubsub = redis_client.pubsub()
            await pubsub.subscribe("ami_commands")
            async for message in pubsub.listen():
                if message["type"] == "message":
                    try:
                        data = json.loads(message["data"])
                        if data.get("action") == "redirect":
                            channel = data.get("channel")
                            single_call_id = data.get("single_call_id")
                            context = data.get("context")
                            exten = data.get("exten")
                            priority = data.get("priority", "1")
                            
                            # Fallback: look up channel in Redis if backend didn't have it
                            if not channel and single_call_id:
                                async for key in redis_client.scan_iter(match=f"{CHANNEL_PREFIX}*"):
                                    meta_str = await redis_client.get(key)
                                    if meta_str:
                                        meta = json.loads(meta_str)
                                        if str(meta.get("SINGLE_CALL_ID")) == str(single_call_id):
                                            channel = key.replace(CHANNEL_PREFIX, "")
                                            break
                                            
                            if channel:
                                logger.info(f"Issuing AMI Redirect for {channel} to {context},{exten},{priority}")
                                await manager.send_action({
                                    "Action": "Redirect",
                                    "Channel": channel,
                                    "Context": context,
                                    "Exten": exten,
                                    "Priority": str(priority)
                                })
                            else:
                                logger.warning(f"Could not find active channel to redirect for SingleCall {single_call_id}")
                        elif data.get("action") == "originate":
                            channel = data.get("channel")
                            context = data.get("context")
                            exten = data.get("exten")
                            priority = data.get("priority", "1")
                            caller_id = data.get("caller_id")
                            account = data.get("account", "")
                            variables = data.get("variables", {})
                            
                            logger.info(f"Issuing AMI Originate for {channel} to {context},{exten},{priority}")
                            
                            action = {
                                "Action": "Originate",
                                "Channel": channel,
                                "Context": context,
                                "Exten": exten,
                                "Priority": str(priority),
                                "CallerID": caller_id,
                                "Account": account,
                                "Async": "true"
                            }
                            
                            # Convert dict into variable string KEY1=VAL1,KEY2=VAL2
                            if variables:
                                var_list = [f"{k}={v}" for k, v in variables.items()]
                                action["Variable"] = ",".join(var_list)
                                
                            await manager.send_action(action)
                        elif data.get("action") == "hangup":
                            channel = data.get("channel")
                            single_call_id = data.get("single_call_id")
                            
                            # Fallback: look up channel in Redis if backend didn't have it
                            if not channel and single_call_id:
                                async for key in redis_client.scan_iter(match=f"{CHANNEL_PREFIX}*"):
                                    meta_str = await redis_client.get(key)
                                    if meta_str:
                                        meta = json.loads(meta_str)
                                        if str(meta.get("SINGLE_CALL_ID")) == str(single_call_id):
                                            channel = key.replace(CHANNEL_PREFIX, "")
                                            break
                            
                            if channel:
                                logger.info(f"Issuing AMI Hangup for {channel}")
                                await manager.send_action({
                                    "Action": "Hangup",
                                    "Channel": channel
                                })
                            else:
                                logger.warning(f"Could not find active channel to hangup for SingleCall {single_call_id}")
                    except Exception as e:
                        logger.error(f"Error processing AMI command: {e}")

        asyncio.create_task(listen_for_commands())

        while True:
            await asyncio.sleep(60)

if __name__ == "__main__":
    asyncio.run(main())
