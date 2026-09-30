# Upscaler for Anime4K

Chrome extension that upscales HTML5 video in real time with [Anime4K](https://github.com/bloc97/Anime4K), running locally on your GPU via WebGPU. No servers, no network calls.

## Install

1. Download `upscaler-for-anime4k-vX.Y.Z.zip` from the [latest release](https://github.com/MtyldZ/upscaler-for-anime4k/releases/latest) and unzip it.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and select the unzipped folder.

**Updating:** unzip the new release over the old folder, click the reload icon on the extension card, then refresh any open video tabs.

Requires Chrome or Edge with WebGPU (Chrome 113+).

## Use

- Click the toolbar icon to open the menu: on/off, mode, strength.
- Shortcuts: **Alt+U** (Option+U on Mac) toggles, **Alt+Shift+U** cycles modes. Change them in `chrome://extensions/shortcuts`.

### Modes

| Mode | What it does |
| --- | --- |
| Auto | Starts on Fast, steps up to Balanced / A / A+A while the GPU keeps up with the video frame rate. |
| Fast | Small networks, one 2× pass. Lowest GPU load. |
| Balanced | Large networks, one 2× pass. |
| Upscale only | Anime4K 2× upscale without the restore pass. Changes the image less. |
| A, A+A, B, B+B, C, C+A | Original Anime4K presets. Heavier. |
| FSR (live action) | Edge-adaptive upscale + sharpen following AMD FSR 1. For YouTube / non-anime video. Very light. |

## Limitations

- Videos served cross-origin without CORS headers can't be read by WebGPU and won't upscale.
- DRM-protected video (Netflix, Crunchyroll, etc.) is not supported.
- Players that crop the video (`object-fit: cover`) may misalign.

## How it works

`content.js` copies each video frame into a WebGPU texture, runs the Anime4K shader pipeline, and draws the result on a canvas laid exactly over the video. The Anime4K library (`anime4k-webgpu.js`, 3.4 MB) is injected only into the frame you turn it on in.

## Credits

- [Anime4K](https://github.com/bloc97/Anime4K) by bloc97 (MIT)
- [anime4k-webgpu](https://github.com/Anime4KWebBoost/Anime4K-WebGPU) v1.0.0 by Anime4KWebBoost Team (MIT), bundled unmodified as `anime4k-webgpu.js`, see `LICENSE-anime4k-webgpu.md`
- FSR mode follows the [AMD FidelityFX FSR 1](https://github.com/GPUOpen-Effects/FidelityFX-FSR) algorithm (MIT), reimplemented in WGSL in `fsr.js`

## License

[MIT](LICENSE) © 2026 Umut YILDIZ. Not affiliated with the Anime4K project.
