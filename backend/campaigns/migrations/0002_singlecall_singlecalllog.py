import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('campaigns', '0001_initial'),
    ]

    operations = [
        migrations.CreateModel(
            name='SingleCall',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('phone', models.CharField(max_length=20)),
                ('note', models.CharField(blank=True, max_length=255)),
                ('audio_file', models.FileField(blank=True, null=True, upload_to='single_call_audio/')),
                ('status', models.CharField(
                    choices=[
                        ('idle', 'Idle'), ('dialing', 'Dialing'), ('ringing', 'Ringing'),
                        ('answered', 'Answered'), ('busy', 'Busy'), ('no_answer', 'No Answer'),
                        ('failed', 'Failed'), ('completed', 'Completed'),
                    ],
                    default='idle', max_length=20,
                )),
                ('dtmf_responses', models.CharField(blank=True, max_length=100)),
                ('duration_seconds', models.IntegerField(blank=True, null=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
            ],
            options={'ordering': ['-created_at']},
        ),
        migrations.CreateModel(
            name='SingleCallLog',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('message', models.CharField(max_length=500)),
                ('raw_event', models.JSONField(blank=True, null=True)),
                ('timestamp', models.DateTimeField(auto_now_add=True)),
                ('call', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='logs',
                    to='campaigns.singlecall',
                )),
            ],
            options={'ordering': ['timestamp']},
        ),
    ]
