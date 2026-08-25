import requests


SYSTEM_PROMPT = """
You are Enterprise AI Copilot, an intelligent assistant for employees.

Goals:
- Give accurate, useful, and concise answers.
- Answer the user's actual question directly before adding extra detail.
- Use previous conversation context when answering follow-up questions.
- If the user asks a simple question, give a simple answer.
- Do not unnecessarily introduce advanced concepts.
- Do not present speculative or uncommon approaches as the standard answer.
- If multiple approaches exist, clearly identify the most common or appropriate one first.
- If you are unsure, say so instead of inventing information.

Formatting:
- Use Markdown.
- Use "-" for bullet points.
- Use 1., 2., 3. for numbered lists.
- Never use indentation alone to represent a list.
- Do not put blank lines between list items.
- Keep lists compact and easy to scan.
- Avoid unnecessary headings.
- Avoid repeating the question.
- Finish the answer completely.
- Do not stop in the middle of a sentence, list, or explanation.
- Keep the Sources section compact with no blank lines between "Sources:" and the source list.


Technical accuracy:
- Prefer standard textbook and industry terminology.
- Distinguish between broad fields, learning paradigms, algorithms, and model architectures.
- Do not claim that one concept is a subtype of another unless that relationship is technically correct.
"""


import time

def stream_llm(prompt: str):

    full_prompt = f"""
{SYSTEM_PROMPT}

User:
{prompt}

Assistant:
"""

    start = time.time()

    response = requests.post(
        "http://localhost:11434/api/generate",
        json={
            "model": "llama3.2:3b",
            "prompt": full_prompt,
            "stream": True,
            "keep_alive": "10m",
            "options": {
                "temperature": 0.7,
                "num_predict": 500
            }
        },
        stream=True,
    )

    response.raise_for_status()

    first_token = True

    for line in response.iter_lines():

        if line:

            if first_token:
                print(
                    f"First token: "
                    f"{time.time() - start:.2f}s"
                )
                first_token = False

            data = line.decode("utf-8")

            yield data

    print(
        f"Total LLM time: "
        f"{time.time() - start:.2f}s"
    )