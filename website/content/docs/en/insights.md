---
title: Insights
description: View local capture counts, trends, and source distribution.
---

Open **Settings → Insights**.

You can see:

- Counts for AI chats, web articles, and videos
- Message totals and source distribution
- Article domains and video platforms
- Longest chats and items with more comments
- Daily capture trends

Ranges include all time, today, the last 7 days, and the last 30 days. Top items can be opened
directly.

The **Local storage** section shows the number of image cache records and browser-estimated origin
usage and quota. Storage totals cover all local data, independent of the clip date filter.
These estimates are not exact disk usage. Unsupported browser estimates are shown as unavailable;
a cache record does not necessarily mean its image data is readable.

Use **Scan resources** to inspect actual image Blob bytes, formats, animation status, and records
that are missing, legacy Data URLs, metadata mismatches, or no longer owned by a saved conversation.
The scan does not download, remove, or modify images. Unconfirmed animation is labeled as unknown.
You can cancel a scan; changes to the local library require rescanning.

The resource audit also reports logical UTF-8 message and comment bytes, image occurrence and unique-target
counts, readable versus broken local asset references, and cache records with no Markdown image references.
Image totals count cache records only once, even when many messages point to the same asset.
You can navigate from the largest-image and per-conversation rankings to the saved conversation.
The ordinary conversation detail menu counts **local image references**, not verified cached images;
only the on-demand resource audit verifies local ownership and readable bytes.
