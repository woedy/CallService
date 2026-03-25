from django.db import models
from django.utils import timezone


class SingleCall(models.Model):
    MODE_CHOICES = [
        ("audio_only", "Audio Only"),
        ("tts_script", "TTS + Custom Script"),
    ]
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
    mode = models.CharField(max_length=20, choices=MODE_CHOICES, default="audio_only")
    channel = models.CharField(max_length=255, blank=True, default='')
    note = models.CharField(max_length=255, blank=True)
    recipient_name = models.CharField(max_length=120, blank=True, default='')
    expected_digits = models.PositiveSmallIntegerField(default=4)
    template_category = models.ForeignKey(
        "QuestionCategory",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="single_calls",
    )
    selected_template = models.ForeignKey(
        "AudioTemplate",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="single_calls",
    )
    script_template = models.ForeignKey(
        "TtsScriptTemplate",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="single_calls",
    )
    press1_template = models.ForeignKey(
        "AudioTemplate",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="single_calls_as_press1",
    )
    tts_script = models.TextField(blank=True, default="")
    press1_tts_script = models.TextField(blank=True, default="")
    audio_file = models.FileField(upload_to='single_call_audio/', null=True, blank=True)
    audio_file_reprompt = models.FileField(upload_to='single_call_audio/', null=True, blank=True)
    audio_file_timeout = models.FileField(upload_to='single_call_audio/', null=True, blank=True)
    audio_file_goodbye = models.FileField(upload_to='single_call_audio/', null=True, blank=True)
    audio_file_validate = models.FileField(upload_to='single_call_audio/', null=True, blank=True)
    audio_file_press1 = models.FileField(upload_to='single_call_audio/', null=True, blank=True)
    audio_file_press2 = models.FileField(upload_to='single_call_audio/', null=True, blank=True)
    audio_file_onhold = models.FileField(upload_to='single_call_audio/', null=True, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='idle')
    dtmf_responses = models.CharField(max_length=255, blank=True, default='')  # accumulates all digits
    duration_seconds = models.IntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']

    def save(self, *args, **kwargs):
        if self.selected_template:
            # Sync mode and expected_digits from template if not manually overridden
            # (In the new simplified UI, they are always inherited)
            self.mode = self.selected_template.mode
            self.expected_digits = self.selected_template.expected_digits
        super().save(*args, **kwargs)

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


class QuestionCategory(models.Model):
    MODE_CHOICES = [
        ("audio_only", "Audio Only"),
        ("tts_script", "TTS + Custom Script"),
    ]
    CATEGORY_TYPES = [
        ("greeting", "Main Greeting"),
        ("press1", "Press 1 Prompt (Digit Entry)"),
    ]

    name = models.CharField(max_length=100, unique=True)
    mode = models.CharField(max_length=25, choices=MODE_CHOICES, default="audio_only")
    category_type = models.CharField(max_length=20, choices=CATEGORY_TYPES, default="greeting")
    description = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class AudioTemplate(models.Model):
    MODE_CHOICES = [
        ("audio_only", "Audio Only"),
        ("tts_script", "TTS + Custom Script"),
    ]

    category = models.ForeignKey(QuestionCategory, related_name="templates", on_delete=models.CASCADE)
    name = models.CharField(max_length=150)
    mode = models.CharField(max_length=25, choices=MODE_CHOICES, default="audio_only")
    
    greeting_script = models.TextField(
        blank=True,
        help_text="The full script for TTS + Custom Script mode.",
    )
    
    # Core assets
    greeting_audio = models.FileField(upload_to="question_templates/", null=True, blank=True)

    expected_digits = models.PositiveIntegerField(default=4)

    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        unique_together = ("category", "name")

    def __str__(self):
        return f"{self.category.name}: {self.name} ({self.get_mode_display()})"


class ProcessedWebhookEvent(models.Model):
    """Stores event fingerprints to make webhook handling idempotent."""
    event_key = models.CharField(max_length=64, unique=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return self.event_key


class TtsScriptTemplate(models.Model):
    name = models.CharField(max_length=150, unique=True)
    greeting_script = models.TextField()
    press1_script = models.TextField(blank=True, default="")
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return self.name
