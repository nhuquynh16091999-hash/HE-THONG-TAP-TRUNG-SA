"""Tests cho faos_brain.agents — F1/F2/F3 (GĐ F)."""
import sys
import os
import types
from unittest.mock import MagicMock

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from faos_brain.agents.llm_client import LLMClient, LLMNotConfigured


# Exception classes dùng CHUNG (định nghĩa 1 lần) để instance khớp với except trong client.
class _APIStatusError(Exception):
    def __init__(self, msg="", status_code=500):
        super().__init__(msg)
        self.status_code = status_code


class _APIConnectionError(Exception):
    pass


class _RateLimitError(Exception):
    def __init__(self, msg=""):
        super().__init__(msg)
        self.status_code = 429


def _fake_anthropic_module(behaviors):
    """Module anthropic giả. behaviors: list — string=trả text, Exception=raise."""
    mod = types.ModuleType("anthropic")
    calls = {"n": 0, "models": []}

    class _Messages:
        def create(self, model, **kw):
            calls["models"].append(model)
            i = calls["n"]
            calls["n"] += 1
            b = behaviors[min(i, len(behaviors) - 1)]
            if isinstance(b, Exception):
                raise b
            block = MagicMock()
            block.type = "text"
            block.text = b
            resp = MagicMock()
            resp.content = [block]
            return resp

    class Anthropic:
        def __init__(self, api_key=None):
            self.messages = _Messages()

    mod.APIStatusError = _APIStatusError
    mod.APIConnectionError = _APIConnectionError
    mod.RateLimitError = _RateLimitError
    mod.Anthropic = Anthropic
    return mod, calls


def test_no_key_raises():
    llm = LLMClient(api_key="")
    assert llm.available is False
    with pytest.raises(LLMNotConfigured):
        llm.complete(system="s", prompt="p")


def test_success_first_model(monkeypatch):
    mod, calls = _fake_anthropic_module(["Kết quả OK"])
    monkeypatch.setitem(sys.modules, "anthropic", mod)
    llm = LLMClient(api_key="k", model_chain=["claude-opus-4-8", "claude-haiku-4-5-20251001"])
    out = llm.complete(system="s", prompt="p")
    assert out == "Kết quả OK"
    assert calls["models"] == ["claude-opus-4-8"]  # không cần fallback


def test_fallback_to_second_model(monkeypatch):
    # Model 1 rate-limit (retry MAX_RETRIES=2) → chuyển model 2 thành công.
    err = _RateLimitError("rate")
    mod, calls = _fake_anthropic_module([err, err, "OK từ haiku"])
    monkeypatch.setitem(sys.modules, "anthropic", mod)
    monkeypatch.setattr("faos_brain.agents.llm_client.time.sleep", lambda *a: None)
    llm = LLMClient(api_key="k", model_chain=["opus", "haiku"])
    out = llm.complete(system="s", prompt="p")
    assert out == "OK từ haiku"
    assert calls["models"] == ["opus", "opus", "haiku"]


def test_permanent_4xx_skips_model(monkeypatch):
    # 400 ở model 1 → bỏ qua luôn (không retry), sang model 2 OK.
    err400 = _APIStatusError("bad", status_code=400)
    mod, calls = _fake_anthropic_module([err400, "OK haiku"])
    monkeypatch.setitem(sys.modules, "anthropic", mod)
    monkeypatch.setattr("faos_brain.agents.llm_client.time.sleep", lambda *a: None)
    llm = LLMClient(api_key="k", model_chain=["opus", "haiku"])
    out = llm.complete(system="s", prompt="p")
    assert out == "OK haiku"
    assert calls["models"] == ["opus", "haiku"]
