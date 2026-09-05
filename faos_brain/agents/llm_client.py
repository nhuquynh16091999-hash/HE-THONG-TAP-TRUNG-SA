"""
faos_brain/agents/llm_client.py — F3: LLM client cho agent.

Nền Claude (stack thực tế của project; CLAUDE.md yêu cầu dùng Claude).
"Fallback chain" = thử model mạnh trước (opus), lỗi thì hạ xuống model nhanh (haiku),
kèm retry backoff cho lỗi tạm thời. Thiết kế Gemini→GPT trong doc cũ (FAOS v6) đã bỏ.

Usage:
  from faos_brain.agents.llm_client import LLMClient
  llm = LLMClient()
  text = llm.complete(system="Bạn là analyst...", prompt="Phân tích...")
"""
from __future__ import annotations

import os
import time
import logging

log = logging.getLogger(__name__)

# Chuỗi fallback: mạnh → nhanh/rẻ. ID model theo CLAUDE.md.
DEFAULT_MODEL_CHAIN = [
    os.environ.get("TALPHA_AI_MODEL", "claude-opus-4-8"),
    "claude-haiku-4-5-20251001",
]
MAX_RETRIES = 2          # số lần thử lại mỗi model khi lỗi tạm thời
RETRY_BACKOFF = 2.0      # giây × số lần thử


class LLMNotConfigured(RuntimeError):
    """Thiếu ANTHROPIC_API_KEY."""


class LLMClient:
    """Claude client với model fallback + retry."""

    def __init__(self, api_key: str | None = None, model_chain: list[str] | None = None):
        self.api_key = api_key or os.environ.get("ANTHROPIC_API_KEY", "")
        self.model_chain = model_chain or DEFAULT_MODEL_CHAIN
        self._client = None  # lazy

    def _ensure_client(self):
        if not self.api_key:
            raise LLMNotConfigured(
                "Thiếu ANTHROPIC_API_KEY — thêm vào .env hoặc dashboard-ui/.env.local rồi chạy lại."
            )
        if self._client is None:
            import anthropic  # import trễ để không bắt buộc khi chỉ test phần đọc BQ
            self._client = anthropic.Anthropic(api_key=self.api_key)
        return self._client

    def complete(
        self,
        system: str,
        prompt: str,
        max_tokens: int = 2000,
        temperature: float = 0.3,
    ) -> str:
        """Gọi Claude. Thử lần lượt các model trong chain; mỗi model retry MAX_RETRIES lần.

        Raises:
            LLMNotConfigured: nếu thiếu API key.
            RuntimeError: nếu tất cả model + retry đều thất bại.
        """
        client = self._ensure_client()
        import anthropic

        last_err: Exception | None = None
        for model in self.model_chain:
            for attempt in range(1, MAX_RETRIES + 1):
                try:
                    resp = client.messages.create(
                        model=model,
                        max_tokens=max_tokens,
                        temperature=temperature,
                        system=system,
                        messages=[{"role": "user", "content": prompt}],
                    )
                    parts = [b.text for b in resp.content if getattr(b, "type", "") == "text"]
                    return "\n".join(parts).strip()
                except (anthropic.APIStatusError, anthropic.APIConnectionError, anthropic.RateLimitError) as e:
                    last_err = e
                    status = getattr(e, "status_code", None)
                    # 4xx (trừ 429) = lỗi vĩnh viễn → chuyển model luôn
                    if status and 400 <= status < 500 and status != 429:
                        log.warning(f"[LLM] {model} lỗi {status} — chuyển model")
                        break
                    wait = RETRY_BACKOFF * attempt
                    log.warning(f"[LLM] {model} thử {attempt}/{MAX_RETRIES} lỗi: {e} — chờ {wait:.1f}s")
                    time.sleep(wait)
            log.warning(f"[LLM] {model} thất bại, thử model kế tiếp")

        raise RuntimeError(f"Tất cả model thất bại. Lỗi cuối: {last_err}")

    @property
    def available(self) -> bool:
        return bool(self.api_key)
