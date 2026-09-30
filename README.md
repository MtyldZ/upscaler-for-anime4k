# Anime4K Local

Chrome extension that upscales HTML5 video in real time with [Anime4K](https://github.com/bloc97/Anime4K), running locally on your GPU via WebGPU. No servers, no network calls.

## Install

1. Download this repo (Code → Download ZIP) and unzip it.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and select the unzipped folder.

Requires Chrome or Edge with WebGPU (Chrome 113+).

## Use

- Click the toolbar icon to open the menu: on/off, mode, strength.
- Shortcuts: **Alt+U** (Option+U on Mac) toggles, **Alt+Shift+U** cycles modes. Change them in `chrome://extensions/shortcuts`.

### Modes

| Mode | What it does |
| --- | --- |
| Auto | Starts on Fast, steps up to Balanced / A while the GPU keeps up with the video frame rate. |
| Fast | Small networks, one 2× pass. Lowest GPU load. |
| Balanced | Large networks, one 2× pass. |
| A, A+A, B, B+B, C, C+A | Original Anime4K presets. Heavier. |

## Limitations

- Videos served cross-origin without CORS headers can't be read by WebGPU and won't upscale.
- DRM-protected video (Netflix, Crunchyroll, etc.) is not supported.
- Players that crop the video (`object-fit: cover`) may misalign.

## How it works

`content.js` copies each video frame into a WebGPU texture, runs the Anime4K shader pipeline, and draws the result on a canvas laid exactly over the video. The Anime4K library (`anime4k-webgpu.js`, 3.4 MB) is injected only into the frame you turn it on in.

## Credits

- [Anime4K](https://github.com/bloc97/Anime4K) by bloc97 (MIT)
- [anime4k-webgpu](https://github.com/Anime4KWebBoost/Anime4K-WebGPU) v1.0.0 by Anime4KWebBoost Team (MIT), bundled unmodified as `anime4k-webgpu.js`, see `LICENSE-anime4k-webgpu.md`
