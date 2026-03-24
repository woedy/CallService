import json
from channels.generic.websocket import AsyncWebsocketConsumer


class CampaignConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        self.group_name = 'campaign_updates'
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()

    async def disconnect(self, close_code):
        await self.channel_layer.group_discard(self.group_name, self.channel_name)

    async def campaign_update(self, event):
        await self.send(text_data=json.dumps(event['data']))


class SingleCallConsumer(AsyncWebsocketConsumer):
    """
    Per-call WebSocket — clients connect to ws/calls/<call_id>/
    and receive live log entries scoped to that specific call.
    """

    async def connect(self):
        self.call_id = self.scope['url_route']['kwargs']['call_id']
        self.group_name = f'single_call_{self.call_id}'
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()

    async def disconnect(self, close_code):
        await self.channel_layer.group_discard(self.group_name, self.channel_name)

    async def call_log(self, event):
        await self.send(text_data=json.dumps(event['data']))
