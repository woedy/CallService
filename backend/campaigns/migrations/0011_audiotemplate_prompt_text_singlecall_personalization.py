from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("campaigns", "0010_questioncategory_audiotemplate_singlecall_links"),
    ]

    operations = [
        migrations.AddField(
            model_name="audiotemplate",
            name="prompt_text",
            field=models.TextField(blank=True, help_text="Optional question text used for dynamic TTS greetings."),
        ),
        migrations.AddField(
            model_name="singlecall",
            name="expected_digits",
            field=models.PositiveSmallIntegerField(default=4),
        ),
        migrations.AddField(
            model_name="singlecall",
            name="recipient_name",
            field=models.CharField(blank=True, default="", max_length=120),
        ),
    ]
