from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    CampaignViewSet,
    SingleCallViewSet,
    CallEventWebhook,
    QuestionCategoryViewSet,
    AudioTemplateViewSet,
)

router = DefaultRouter()
router.register(r'campaigns', CampaignViewSet)
router.register(r'single-calls', SingleCallViewSet)
router.register(r'template-categories', QuestionCategoryViewSet, basename='template-categories')
router.register(r'audio-templates', AudioTemplateViewSet, basename='audio-templates')

urlpatterns = [
    path('', include(router.urls)),
    path('call-events/', CallEventWebhook.as_view(), name='call-events'),
]
