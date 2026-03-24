from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("campaigns", "0008_processedwebhookevent"),
    ]

    operations = [
        migrations.AddField(
            model_name="singlecall",
            name="audio_file_validate",
            field=models.FileField(blank=True, null=True, upload_to="single_call_audio/"),
        ),
    ]
