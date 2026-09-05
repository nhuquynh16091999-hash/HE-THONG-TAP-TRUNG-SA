import pytest
import asyncio
from unittest.mock import patch
from faos_brain.ads_spy.fb_ad_library_api import search_fb_ad_library_api

class MockResponse:
    def __init__(self, json_data=None, text_data=None, status_code=200):
        self._json_data = json_data
        self.text = text_data
        self.status_code = status_code
        
    def json(self):
        return self._json_data

@pytest.mark.asyncio
async def test_meta_api_fetches_raw_media():
    fake_api_response = {
        "data": [
            {
                "id": "12345",
                "page_name": "Test Page",
                "ad_creative_bodies": ["Test necklace"],
                "ad_creative_link_titles": ["Buy now"],
                "ad_snapshot_url": "https://www.facebook.com/ads/archive/render_ad/?id=12345"
            }
        ],
        "paging": {}
    }
    
    fake_snapshot_html = '''
        <html><body>
        <script>
            var data = {
                "video_hd_url": "https://video.com/best_necklace.mp4",
                "resized_image_url": "https://image.com/necklace.jpg"
            };
        </script>
        </body></html>
    '''

    async def mock_get(url, *args, **kwargs):
        if "ads_archive" in str(url):
            return MockResponse(json_data=fake_api_response)
        elif "render_ad" in str(url):
            return MockResponse(text_data=fake_snapshot_html)
        return MockResponse(status_code=404)

    with patch('httpx.AsyncClient.get', side_effect=mock_get):
        with patch('faos_brain.ads_spy.fb_ad_library_api._get_access_token', return_value="fake_token"):
            res = await search_fb_ad_library_api(keyword="necklace", limit=2, media_type="all")
            
            assert "ads" in res
            assert len(res["ads"]) == 1
            ad = res["ads"][0]
            
            assert ad["ad_text"] == "Test necklace"
            assert ad["headline"] == "Buy now"
            
            assert ad["cover_url"] == "https://image.com/necklace.jpg", "cover_url is missing or incorrect"
            assert ad["video_url"] == "https://video.com/best_necklace.mp4", "video_url is missing or incorrect"
            assert ad["creative_type"] == "video"

