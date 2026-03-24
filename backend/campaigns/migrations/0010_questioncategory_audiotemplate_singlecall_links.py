from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("campaigns", "0009_singlecall_audio_file_validate"),
    ]

    operations = [
        migrations.CreateModel(
            name="QuestionCategory",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("name", models.CharField(max_length=100, unique=True)),
                ("description", models.TextField(blank=True)),
                ("is_active", models.BooleanField(default=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
            ],
            options={"ordering": ["name"]},
        ),
        migrations.CreateModel(
            name="AudioTemplate",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("name", models.CharField(max_length=150)),
                ("greeting_audio", models.FileField(upload_to="question_templates/")),
                ("is_active", models.BooleanField(default=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "category",
                    models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="templates", to="campaigns.questioncategory"),
                ),
            ],
            options={"ordering": ["-created_at"], "unique_together": {("category", "name")}},
        ),
        migrations.AddField(
            model_name="singlecall",
            name="selected_template",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="single_calls", to="campaigns.audiotemplate"),
        ),
        migrations.AddField(
            model_name="singlecall",
            name="template_category",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="single_calls", to="campaigns.questioncategory"),
        ),
    ]
