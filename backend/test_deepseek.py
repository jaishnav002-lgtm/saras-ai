import os
from pathlib import Path
from dotenv import load_dotenv
from openai import OpenAI

env_path = Path(__file__).resolve().parent / ".env"
load_dotenv(env_path, override=True)


key = os.getenv("NVIDIA_API_KEY")

if not key:
    raise SystemExit(f"NVIDIA_API_KEY not found. Checked: {env_path}")

print("API key loaded successfully.")

client = OpenAI(
    base_url="https://integrate.api.nvidia.com/v1",
    api_key=key,
    timeout=120.0,
    max_retries=0,
)

try:
    response = client.chat.completions.create(
        model="deepseek-ai/deepseek-v4.1-flash",
        messages=[
            {"role": "user", "content": "Reply with exactly: NVIDIA KEY TEST OK"}
        ],
        max_tokens=30,
        stream=False,
    )
    print("SUCCESS:", response.choices[0].message.content)
except Exception as e:
    print("API REQUEST FAILED:", type(e).__name__)
    print(str(e)[:500])

