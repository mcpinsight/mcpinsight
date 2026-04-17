---
version: 1
audience: ux-researcher
---

# Task Prompt: Synthesize Feedback

Use this to turn raw interview notes or alpha-feedback threads into named themes.

```
[SYNTHESIZE FEEDBACK]

Sources (paste file paths or URLs):
- research/<path>
- research/<path>

Question (optional — narrows the synthesis):
<e.g., "what do P2 users say about cost after Tool Search?">

Sample size (N): <number of distinct people or threads>

Please:

1. Quote extraction — paste 5-20 short quotes (1-2 sentences each) that capture variety. Anonymize names to P1/P2/... . Keep the raw language; don't paraphrase here.

2. Open coding — for each quote, give it 2-3 labels in brackets: [label_a] [label_b]. Labels are free-form, descriptive (e.g., [wants_export] [not_dashboard] [frustrated_with_cli]).

3. Clustering — group labels into themes. A theme has:
   - A plain name (≤8 words): "Power users reject dashboard in favor of export"
   - Evidence count: how many distinct sources express this theme
   - Confidence: high (≥5 sources, consistent), medium (3-4 or mixed), low (1-2)
   - 1-3 example quotes

4. Recommendations — for each high- or medium-confidence theme:
   - For PM: 1 sentence describing a candidate story
   - For UI Designer: 1 sentence on visual/interaction impact (if any)
   - For Documentation: 1 sentence on messaging impact (if any)

5. If sample is too thin → state "insufficient data for theme X, need Y more sources" and stop for that theme. Do not pad.

Return the UX Researcher Output Contract.
```
