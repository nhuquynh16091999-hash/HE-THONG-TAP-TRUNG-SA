"""
faos_brain.agents — Agent Revival (GĐ F).

Agent đọc dữ liệu từ BigQuery views chuẩn hoá (TALPHA_Dataset) và dùng Claude
để phân tích / đề xuất. KHÔNG tạo nguồn dữ liệu mới — chỉ đọc.

  - llm_client.LLMClient     : F3 — Claude wrapper (model fallback + retry)
  - bq_context.*             : helper đọc views → context gọn cho LLM
  - analyst.AnalystAgent     : F1 — phân tích sức khỏe kinh doanh
  - marketing_director.*     : F2 — đề xuất tối ưu marketing/ads
"""
