# Documentation assets

Original Xantum SVG banners and buttons use the app's navy, turquoise and purple palette. They contain no scripts, remote images or external font requests. The README provides real links and accessible labels.

Regenerate SVG assets with Python 3, `pango-view` and Montserrat installed:

```bash
python3 docs/assets/generate.py
```

Headlines and button text are outlined for consistent rendering. Montserrat is distributed under the SIL Open Font License; font files are not included here. Check both compact and desktop layouts after changes.

`chat-preview.png` and `settings-preview.png` show the current English interface at 740 × 600. Chat participants and messages are synthetic fixtures on a local test server; no VPN connection or production credentials are shown.
