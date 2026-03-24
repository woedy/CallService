from rest_framework import serializers
from .models import Campaign, Contact, CallLog, SingleCall, SingleCallLog


class CampaignSerializer(serializers.ModelSerializer):
    class Meta:
        model = Campaign
        fields = '__all__'
        read_only_fields = ('status', 'created_at', 'updated_at')


class ContactSerializer(serializers.ModelSerializer):
    class Meta:
        model = Contact
        fields = '__all__'


class CallLogSerializer(serializers.ModelSerializer):
    class Meta:
        model = CallLog
        fields = '__all__'


class SingleCallLogSerializer(serializers.ModelSerializer):
    class Meta:
        model = SingleCallLog
        fields = '__all__'


class SingleCallSerializer(serializers.ModelSerializer):
    logs = SingleCallLogSerializer(many=True, read_only=True)

    class Meta:
        model = SingleCall
        fields = '__all__'
        read_only_fields = ('status', 'dtmf_responses', 'duration_seconds', 'created_at', 'updated_at')
