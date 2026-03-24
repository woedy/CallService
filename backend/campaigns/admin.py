from django.contrib import admin
from .models import Campaign, Contact, CallLog, SingleCall, SingleCallLog


@admin.register(Campaign)
class CampaignAdmin(admin.ModelAdmin):
    list_display = ('name', 'status', 'start_time', 'max_calls_per_min')
    list_filter = ('status',)
    search_fields = ('name',)


@admin.register(Contact)
class ContactAdmin(admin.ModelAdmin):
    list_display = ('phone', 'campaign', 'status', 'attempt_count', 'dtmf_response')
    list_filter = ('status', 'campaign')
    search_fields = ('phone',)


@admin.register(CallLog)
class CallLogAdmin(admin.ModelAdmin):
    list_display = ('contact', 'timestamp')
    readonly_fields = ('event',)


@admin.register(SingleCall)
class SingleCallAdmin(admin.ModelAdmin):
    list_display = ('phone', 'note', 'status', 'dtmf_responses', 'duration_seconds', 'created_at')
    list_filter = ('status',)
    search_fields = ('phone', 'note')


@admin.register(SingleCallLog)
class SingleCallLogAdmin(admin.ModelAdmin):
    list_display = ('call', 'message', 'timestamp')
    readonly_fields = ('raw_event',)
