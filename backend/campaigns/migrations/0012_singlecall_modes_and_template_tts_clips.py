from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("campaigns", "0011_audiotemplate_prompt_text_singlecall_personalization"),
    ]

    operations = [
        migrations.AddField(
            model_name="audiotemplate",
            name="tts_intro_audio",
            field=models.FileField(blank=True, null=True, upload_to="question_templates/"),
        ),
        migrations.AddField(
            model_name="audiotemplate",
            name="tts_outro_audio",
            field=models.FileField(blank=True, null=True, upload_to="question_templates/"),
        ),
        migrations.AddField(
            model_name="singlecall",
            name="mode",
            field=models.CharField(choices=[("audio_only", "Audio Only"), ("tts_template", "TTS + Template"), ("tts_script", "TTS + Custom Script")], default="audio_only", max_length=20),
        ),
        migrations.AddField(
            model_name="singlecall",
            name="tts_intro_file",
            field=models.FileField(blank=True, null=True, upload_to="single_call_audio/"),
        ),
        migrations.AddField(
            model_name="singlecall",
            name="tts_outro_file",
            field=models.FileField(blank=True, null=True, upload_to="single_call_audio/"),
        ),
        migrations.AddField(
            model_name="singlecall",
            name="tts_script",
            field=models.TextField(blank=True, default=""),
        ),
    ]
