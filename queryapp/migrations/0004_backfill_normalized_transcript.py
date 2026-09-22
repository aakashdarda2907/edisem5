import hashlib

from django.db import migrations


def normalize(transcript: str) -> str:
    return hashlib.sha256(transcript.strip().lower().encode("utf-8")).hexdigest()


def backfill(apps, schema_editor):
    QueryLog = apps.get_model('queryapp', 'QueryLog')
    for row in QueryLog.objects.filter(normalized_transcript=""):
        row.normalized_transcript = normalize(row.raw_transcript)
        row.save(update_fields=["normalized_transcript"])


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('queryapp', '0003_querylog_normalized_transcript'),  # match the actual filename you just generated for the field
    ]

    operations = [
        migrations.RunPython(backfill, noop_reverse),
    ]