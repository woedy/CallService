from django.conf import settings
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APITestCase

from .models import Campaign, Contact, SingleCall, SingleCallLog, ProcessedWebhookEvent


class CampaignUploadTests(APITestCase):
    def setUp(self):
        self.campaign = Campaign.objects.create(
            name="Test Campaign",
            audio_file=SimpleUploadedFile("greeting.wav", b"fake-audio", content_type="audio/wav"),
        )

    def test_upload_contacts_normalizes_and_dedupes(self):
        csv_content = "\n".join(
            [
                "(555) 111-2222",
                "5551112222",
                "6001",
                "6001",
                "not-a-number",
            ]
        )
        upload = SimpleUploadedFile("contacts.csv", csv_content.encode("utf-8"), content_type="text/csv")

        res = self.client.post(
            f"/api/campaigns/{self.campaign.id}/upload_contacts/",
            {"file": upload},
            format="multipart",
        )

        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["count"], 2)
        self.assertEqual(res.data["duplicates"], 2)
        self.assertEqual(res.data["skipped"], 1)
        self.assertEqual(Contact.objects.filter(campaign=self.campaign).count(), 2)


class SingleCallCreateTests(APITestCase):
    def test_create_single_call_normalizes_phone(self):
        res = self.client.post(
            "/api/single-calls/",
            {"phone": "(6001)", "note": "normalize me", "expected_digits": 5, "recipient_name": "Cynthia"},
            format="multipart",
        )

        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data["phone"], "6001")
        self.assertEqual(res.data["expected_digits"], 5)
        self.assertEqual(res.data["recipient_name"], "Cynthia")

    def test_create_single_call_rejects_invalid_expected_digits(self):
        res = self.client.post(
            "/api/single-calls/",
            {"phone": "6001", "expected_digits": 22},
            format="multipart",
        )
        self.assertEqual(res.status_code, 400)

    def test_create_single_call_rejects_tts_script_mode_without_script(self):
        res = self.client.post(
            "/api/single-calls/",
            {"phone": "6001", "mode": "tts_script"},
            format="multipart",
        )
        self.assertEqual(res.status_code, 400)


class WebhookIdempotencyTests(APITestCase):
    def setUp(self):
        self.call = SingleCall.objects.create(phone="6001")

    def test_duplicate_single_call_event_only_processed_once(self):
        payload = {
            "Event": "Hangup",
            "SingleCallId": str(self.call.id),
            "DialStatus": "ANSWER",
            "CauseTxt": "Normal Clearing",
            "Duration": "12",
        }
        headers = {"HTTP_X_WEBHOOK_SECRET": settings.WEBHOOK_SECRET}

        first = self.client.post("/api/call-events/", payload, format="json", **headers)
        second = self.client.post("/api/call-events/", payload, format="json", **headers)

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        self.call.refresh_from_db()
        self.assertEqual(self.call.status, "answered")
        self.assertEqual(self.call.duration_seconds, 12)
        self.assertEqual(SingleCallLog.objects.filter(call=self.call).count(), 1)
        self.assertEqual(ProcessedWebhookEvent.objects.count(), 1)

    def test_single_call_dtmf_replaces_previous_entry(self):
        self.call.dtmf_responses = "1111"
        self.call.save(update_fields=["dtmf_responses"])

        payload = {
            "Event": "DTMFReceived",
            "SingleCallId": str(self.call.id),
            "Digit": "2547",
        }
        headers = {"HTTP_X_WEBHOOK_SECRET": settings.WEBHOOK_SECRET}

        res = self.client.post("/api/call-events/", payload, format="json", **headers)
        self.assertEqual(res.status_code, 200)

        self.call.refresh_from_db()
        self.assertEqual(self.call.dtmf_responses, "2547")

    def test_dtmf_events_are_not_idempotency_filtered(self):
        payload = {
            "Event": "DTMFReceived",
            "SingleCallId": str(self.call.id),
            "Digit": "9999",
        }
        headers = {"HTTP_X_WEBHOOK_SECRET": settings.WEBHOOK_SECRET}

        first = self.client.post("/api/call-events/", payload, format="json", **headers)
        second = self.client.post("/api/call-events/", payload, format="json", **headers)

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        self.call.refresh_from_db()
        self.assertEqual(self.call.dtmf_responses, "9999")
        self.assertEqual(SingleCallLog.objects.filter(call=self.call, message__contains="DTMF").count(), 2)
