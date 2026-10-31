# Evaluation goal

Evaluate the importance of timely AI news for readers who build with, research, or follow AI systems. The reader wants to know what changed, who is affected, how reliable the evidence is, and what deserves follow-up.

# Scoring rubric

- **9-10: Groundbreaking.** A major capability, price, availability, safety, or research change that materially shifts what developers or researchers can do.
- **7-8: High value.** An important model release, strong research result, useful tool, significant open-source project, or concrete industry/regulation change.
- **5-6: Interesting.** Incremental updates, useful technical detail, moderate community interest, or a result worth knowing but not urgent.
- **3-4: Low priority.** Routine updates, shallow reposts, vendor promotion, or topics with little AI-specific substance.
- **0-2: Noise.** Spam, off-topic material, clickbait, or content with no verifiable substance.

# Evaluation guidance

Consider novelty, concrete evidence, likely impact, source quality, reproducibility, and whether the item adds information beyond another source. Distinguish an announcement from a shipped capability and a vendor claim from an independent measurement. Do not equate popularity with importance. Use three to five specific topic tags.

# Required output

Return a JSON object with `score`, `reason`, `summary`, and `tags`. The reason must cite the evidence in the supplied material and explain why the score is not higher or lower. The summary must be one or two factual sentences.
