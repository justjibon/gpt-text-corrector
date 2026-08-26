# ✨ GPT Text Corrector

A lightweight Chrome extension that uses OpenAI models to correct, rewrite, shorten, translate, and improve selected text anywhere on the web.

## Features

- ✨ Correct grammar, spelling, punctuation, and phrasing
- 💼 Professional rewrite
- 😊 Casual rewrite
- ✂️ Shorten text
- 🧠 Improve clarity and flow
- 🌍 Translate text
- ✏️ Custom instructions
- 🤖 Choose your OpenAI model
- ⌨️ `Ctrl + Shift + G` for quick correction
- 🖱️ Right-click selected text for GPT actions
- 🔐 API key stored locally in Chrome
- 🚫 No permanent floating toolbar

## Install in Chrome

1. Download or clone this repository.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select this repository folder — the folder containing `manifest.json`.
6. Open the extension's **Settings / API key** page.
7. Add your own OpenAI API key.

## How to use

1. Select text on a webpage.
2. Click the GPT Text Corrector extension icon.
3. Choose an action such as **Correct**, **Professional**, **Casual**, **Shorten**, **Improve**, or **Translate**.
4. The selected text is replaced with the result.

For quick correction, select text and press:

`Ctrl + Shift + G`

You can also right-click selected text and use the GPT Text Corrector menu.

## API key

This project does not include an OpenAI API key.

Each user supplies their own key through the extension settings. The key is stored in Chrome extension storage and is used to make requests to the OpenAI API.

**Never commit an API key to GitHub.**

## Privacy

GPT Text Corrector has no project-owned backend. When you request an AI action, the selected text is sent to the OpenAI API using the API key configured by the user.

Do not use the extension with sensitive information unless you are comfortable sending that information to your selected AI provider.

See [PRIVACY.md](PRIVACY.md) for more information.

## Project structure

```text
gpt-text-corrector/
├── icons/
│   ├── icon16.png
│   ├── icon32.png
│   ├── icon48.png
│   └── icon128.png
├── background.js
├── content.js
├── manifest.json
├── options.html
├── options.js
├── popup.html
└── popup.js
```

## Development

The extension is plain HTML, CSS, and JavaScript using Chrome Manifest V3.

No build step is required.

After changing the code:

1. Open `chrome://extensions`.
2. Find GPT Text Corrector.
3. Click **Reload**.
4. Refresh the webpage where you are testing it.

## Contributing

Bug reports, feature ideas, and pull requests are welcome.

Please do not include API keys or other secrets in issues or pull requests.

## License

MIT
