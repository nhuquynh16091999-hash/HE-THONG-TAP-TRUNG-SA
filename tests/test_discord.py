"""
🧪 Unit tests for tools/discord.py

Tests message splitting, rate limiting, payload structure.
Uses unittest.mock to avoid actual HTTP requests.
"""
import sys
import os
import unittest
from unittest.mock import patch, MagicMock
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

# Mock requests before importing discord to avoid env issues
with patch.dict(os.environ, {"DISCORD_WEBHOOK_URL": "https://discord.com/api/webhooks/test/test"}):
    import tools.discord as discord_mod
    from tools.discord import send, send_embed, send_alert, _check_rate_limit


class TestMessageSplitting(unittest.TestCase):
    """Test that long messages are split into chunks <= MAX_CHUNK."""

    @patch('tools.discord.requests.post')
    def test_short_message_single_call(self, mock_post):
        mock_post.return_value = MagicMock(status_code=204)
        result = send("Hello World", webhook_url="https://test.webhook/abc")
        self.assertTrue(result)
        mock_post.assert_called_once()

    @patch('tools.discord.requests.post')
    def test_long_message_split(self, mock_post):
        mock_post.return_value = MagicMock(status_code=204)
        long_msg = "A" * 5000  # > MAX_CHUNK (1900)
        result = send(long_msg, webhook_url="https://test.webhook/split")
        self.assertTrue(result)
        self.assertEqual(mock_post.call_count, 3)  # 5000/1900 = 3 chunks

    @patch('tools.discord.requests.post')
    def test_exact_chunk_size(self, mock_post):
        mock_post.return_value = MagicMock(status_code=204)
        msg = "B" * 1900  # Exactly MAX_CHUNK
        result = send(msg, webhook_url="https://test.webhook/exact")
        self.assertTrue(result)
        mock_post.assert_called_once()


class TestSendPayload(unittest.TestCase):
    """Test that send() builds correct payload."""

    @patch('tools.discord.requests.post')
    def test_payload_has_content(self, mock_post):
        mock_post.return_value = MagicMock(status_code=204)
        send("Test message", webhook_url="https://test.webhook/payload")
        called_json = mock_post.call_args[1].get("json") or mock_post.call_args[0][1] if len(mock_post.call_args[0]) > 1 else mock_post.call_args[1].get("json")
        self.assertIn("content", called_json)
        self.assertEqual(called_json["content"], "Test message")


class TestSendEmbed(unittest.TestCase):
    """Test send_embed() payload structure."""

    @patch('tools.discord.requests.post')
    def test_embed_payload(self, mock_post):
        mock_post.return_value = MagicMock(status_code=204)
        embed = {
            "title": "Test",
            "description": "Test embed",
            "color": 0xFF4444,
            "fields": [],
        }
        result = send_embed(embed, webhook_url="https://test.webhook/embed")
        self.assertTrue(result)
        called_json = mock_post.call_args[1].get("json")
        self.assertIn("embeds", called_json)
        self.assertEqual(len(called_json["embeds"]), 1)
        self.assertEqual(called_json["embeds"][0]["title"], "Test")

    @patch('tools.discord.requests.post')
    def test_embed_with_content(self, mock_post):
        mock_post.return_value = MagicMock(status_code=204)
        embed = {"title": "T", "description": "D", "color": 0, "fields": []}
        send_embed(embed, webhook_url="https://test.webhook/embed2",
                   content="Above embed text")
        called_json = mock_post.call_args[1].get("json")
        self.assertIn("content", called_json)
        self.assertEqual(called_json["content"], "Above embed text")


class TestNoWebhook(unittest.TestCase):
    """Test behavior when no webhook URL is set."""

    @patch('tools.discord.requests.post')
    def test_send_no_url_returns_false(self, mock_post):
        result = send("test", webhook_url="")
        self.assertFalse(result)
        mock_post.assert_not_called()

    @patch('tools.discord.requests.post')
    def test_embed_no_url_returns_false(self, mock_post):
        result = send_embed({"title": "T"}, webhook_url="")
        self.assertFalse(result)
        mock_post.assert_not_called()


class TestErrorHandling(unittest.TestCase):
    """Test error handling in send functions."""

    @patch('tools.discord.requests.post')
    def test_send_error_returns_false(self, mock_post):
        mock_post.side_effect = Exception("Connection timeout")
        result = send("test", webhook_url="https://test.webhook/err")
        self.assertFalse(result)

    @patch('tools.discord.requests.post')
    def test_send_bad_status_returns_false(self, mock_post):
        mock_post.return_value = MagicMock(status_code=500)
        result = send("test", webhook_url="https://test.webhook/500")
        self.assertFalse(result)

    @patch('tools.discord.requests.post')
    def test_429_retry(self, mock_post):
        """Test that 429 triggers a retry."""
        rate_resp = MagicMock(status_code=429)
        rate_resp.json.return_value = {"retry_after": 0.1}
        ok_resp = MagicMock(status_code=204)
        mock_post.side_effect = [rate_resp, ok_resp]

        result = send("test", webhook_url="https://test.webhook/retry")
        self.assertTrue(result)
        self.assertEqual(mock_post.call_count, 2)


class TestSendAlert(unittest.TestCase):
    """Test send_alert wrapper."""

    @patch('tools.discord.send')
    def test_alert_calls_send(self, mock_send):
        mock_send.return_value = True
        result = send_alert("Error happened!", webhook_url="https://test.webhook/alert")
        self.assertTrue(result)
        mock_send.assert_called_once()


class TestRateLimiter(unittest.TestCase):
    """Test rate limiting logic."""

    def setUp(self):
        # Clear rate limit tracker
        discord_mod._rate_limit_tracker.clear()

    def test_under_limit_returns_true(self):
        result = _check_rate_limit("https://test.webhook/ratelimit1")
        self.assertTrue(result)

    def test_tracker_records_timestamp(self):
        url = "https://test.webhook/ratelimit2"
        key = url[-20:]
        _check_rate_limit(url)
        self.assertIn(key, discord_mod._rate_limit_tracker)
        self.assertEqual(len(discord_mod._rate_limit_tracker[key]), 1)


if __name__ == "__main__":
    unittest.main()
