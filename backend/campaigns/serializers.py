from rest_framework import serializers
from .models import Campaign, Contact, CallLog, SingleCall, SingleCallLog, QuestionCategory, AudioTemplate


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


class QuestionCategorySerializer(serializers.ModelSerializer):
    template_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = QuestionCategory
        fields = "__all__"


class AudioTemplateSerializer(serializers.ModelSerializer):
    greeting_audio_url = serializers.SerializerMethodField()
    category_name = serializers.CharField(source="category.name", read_only=True)

    class Meta:
        model = AudioTemplate
        fields = (
            "id",
            "category",
            "category_name",
            "name",
            "prompt_text",
            "greeting_audio",
            "greeting_audio_url",
            "is_active",
            "created_at",
            "updated_at",
        )

    def get_greeting_audio_url(self, obj):
        request = self.context.get("request")
        if not obj.greeting_audio:
            return None
        if request:
            return request.build_absolute_uri(obj.greeting_audio.url)
        return obj.greeting_audio.url
