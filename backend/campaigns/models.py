from django.db import models
from django.utils import timezone


class SingleCall(models.Model):
    STATUS_CHOICES = [
        ('idle', 'Idle'),
        ('dialing', 'Dialing'),
        ('ringing', 'Ringing'),
        ('answered', 'Answered'),
        ('busy', 'Busy'),
        ('no_answer', 'No Answer'),
        ('failed', 'Failed'),
        ('completed', 'Completed'),
    ]

    phone = models.CharField(max_length=20)
    caller_id = models.CharField(max_length=50, blank=True, default='')
    channel = models.CharField(max_length=255, blank=True, default='')
    note = models.CharField(max_length=255, blank=True)
    audio_file = models.FileField(upload_to='single_call_audio/', null=True, blank=True)
    audio_file_reprompt = models.FileField(upload_to='single_call_audio/', null=True, blank=True)
    audio_file_timeout = models.FileField(upload_to='single_call_audio/', null=True, blank=True)
    audio_file_goodbye = models.FileField(upload_to='single_call_audio/', null=True, blank=True)
    audio_file_press1 = models.FileField(upload_to='single_call_audio/', null=True, blank=True)
    audio_file_press2 = models.FileField(upload_to='single_call_audio/', null=True, blank=True)
    audio_file_onhold = models.FileField(upload_to='single_call_audio/', null=True, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='idle')
    dtmf_responses = models.CharField(max_length=100, blank=True)  # accumulates all digits
    duration_seconds = models.IntegerField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"Call to {self.phone} [{self.status}]"


class SingleCallLog(models.Model):
    call = models.ForeignKey(SingleCall, related_name='logs', on_delete=models.CASCADE)
    message = models.CharField(max_length=500)
    raw_event = models.JSONField(null=True, blank=True)
    timestamp = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['timestamp']

    def __str__(self):
        return f"[{self.timestamp}] {self.message}"


class Campaign(models.Model):
    STATUS_CHOICES = [
        ('draft', 'Draft'),
        ('running', 'Running'),
        ('completed', 'Completed'),
        ('paused', 'Paused'),
    ]

    name = models.CharField(max_length=255)
    caller_id = models.CharField(max_length=50, blank=True, default='')
    audio_file = models.FileField(upload_to='campaign_audio/')
    audio_file_reprompt = models.FileField(upload_to='campaign_audio/', null=True, blank=True)
    audio_file_timeout = models.FileField(upload_to='campaign_audio/', null=True, blank=True)
    audio_file_goodbye = models.FileField(upload_to='campaign_audio/', null=True, blank=True)
    audio_file_press1 = models.FileField(upload_to='campaign_audio/', null=True, blank=True)
    audio_file_press2 = models.FileField(upload_to='campaign_audio/', null=True, blank=True)
    audio_file_onhold = models.FileField(upload_to='campaign_audio/', null=True, blank=True)
    start_time = models.DateTimeField(default=timezone.now)
    max_calls_per_min = models.IntegerField(default=10)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='draft')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.name


class Contact(models.Model):
    STATUS_CHOICES = [
        ('pending', 'Pending'),
        ('dialing', 'Dialing'),
        ('success', 'Success'),
        ('busy', 'Busy'),
        ('no_answer', 'No Answer'),
        ('failed', 'Failed'),
    ]

    campaign = models.ForeignKey(Campaign, related_name='contacts', on_delete=models.CASCADE)
    phone = models.CharField(max_length=20)
    attempt_count = models.IntegerField(default=0)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')
    dtmf_response = models.CharField(max_length=10, blank=True, null=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.phone} - {self.campaign.name}"


class CallLog(models.Model):
    contact = models.ForeignKey(Contact, related_name='logs', on_delete=models.CASCADE)
    event = models.JSONField()
    timestamp = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"Log for {self.contact.phone} at {self.timestamp}"
