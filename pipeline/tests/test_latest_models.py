"""Verify actual request compatibility for updated model presets without network calls."""
import asyncio
import importlib.util
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock
import pytest
from src.ai.client import OpenAIClient
from src.models import AIConfig, AIProvider


@pytest.mark.parametrize("model,token_key", [
    ("gpt-6.1-sol", "max_completion_tokens"),
    ("kimi-k3.1-pro", "max_tokens"),
])
def test_current_models_send_documented_parameters(monkeypatch, model, token_key):
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    client = OpenAIClient(AIConfig(provider=AIProvider.OPENAI, model=model,
        api_key_env="OPENAI_API_KEY"))
    response = MagicMock()
    response.choices[0].message.content = "{}"
    response.usage = None
    create = AsyncMock(return_value=response)
    monkeypatch.setattr(client.client.chat.completions, "create", create)
    asyncio.run(client.complete(system="Return JSON", user="test", max_tokens=256))
    payload = create.call_args.kwargs
    assert payload["model"] == model
    assert payload[token_key] == 256
    assert "temperature" not in payload
    assert ("max_tokens" if token_key == "max_completion_tokens" else "max_completion_tokens") not in payload
    assert create.await_count == 1


@pytest.mark.parametrize("model,token_key", [
    ("gpt-6.1-sol", "max_completion_tokens"),
    ("kimi-k3.1-pro", "max_tokens"),
    ("deepseek-flash", "max_tokens"),
])
def test_setup_connection_uses_current_model_without_sampling(monkeypatch, model, token_key):
    spec = importlib.util.spec_from_file_location("latest_model_runner",
        Path(__file__).resolve().parents[1] / "scripts" / "signalweb_runner.py")
    runner = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(runner)
    post = MagicMock(return_value=MagicMock(status_code=200))
    monkeypatch.setattr(runner.httpx, "post", post)
    result = runner.test_connection({"endpoint": "https://example.com/v1", "model": model}, key="test-key")
    payload = post.call_args.kwargs["json"]
    assert payload["model"] == model
    assert payload[token_key] == 64
    assert "temperature" not in payload
    assert result["ok"]
    assert post.call_count == 1
