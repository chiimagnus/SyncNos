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
Sizes use decimal KB, MB, and GB (1 KB = 1,000 bytes).
These estimates are not exact disk usage. Unsupported browser estimates are shown as —;
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

After scanning, select eligible PNG/JPEG images and choose **Compress selected**, then confirm.
There are no image previews, visual comparisons, or lossy compression options.
Only smaller, pixel-identical images are saved. Animated and unsupported formats are skipped.
Images are processed one at a time; you can stop between items and see the actual space saved.
Saving replaces local bytes without changing asset IDs or conversation references.
Metadata may change, so export a Backup first if you need the originals.
Existing remote copies are not updated automatically.

Use **Find duplicate images** to explicitly inspect same-size cached files with chunked SHA-256.
The result lists byte-identical files across conversations and their potential duplicate bytes;
it never merges assets, rewrites IDs, deletes content, or triggers synchronization. You can cancel
or rerun after changes to the local library.
Existing remote copies are not updated automatically; rescan before further changes.

In **Settings → General**, **Optimize newly cached images** is off by default. Enable it to
try pixel-identical compression only when a new image is first cached. Unsupported images,
failed encoding, and candidates without smaller bytes keep their original data. The setting
does not turn on AI chat or article image caching, change previously stored images, or trigger remote sync.
