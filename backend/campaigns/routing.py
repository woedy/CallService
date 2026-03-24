from django.urls import re_path
from . import consumers

websocket_urlpatterns = [
    re_path(r'ws/campaigns/$', consumers.CampaignConsumer.as_asgi()),
    re_path(r'ws/calls/(?P<call_id>\d+)/$', consumers.SingleCallConsumer.as_asgi()),
]
