# Synth Forge

A local image and text workspace. Processing runs on your computer; no account or API key is required.

## Install

Supports **Debian/Ubuntu x86-64 Linux**. You need internet access and at least **60 GB free disk space**. NVIDIA acceleration requires a working driver; CPU mode is much slower.

Download and extract this repository, open a terminal in its folder, and run:

```sh
bash install.sh
```

Setup downloads the dependencies and models, selects GPU or CPU mode, and opens the app. It may ask for your password to install system packages. If interrupted, rerun the same command to resume.

## Start

From the installation folder:

```sh
bash start-forge.sh
```

Open **http://127.0.0.1:8190**. Press **Ctrl+C** in the terminal to stop. Keep the installation folder in the same location.

## Use

- **Images:** upload an image, adjust settings, click **Run image**, then compare and download the result.
- **Text:** upload a `.txt`, `.md`, or `.text` file (up to 2 MB), click **Run text**, then review and download the result. Detector scores do not establish authorship.

Image outputs are saved in `ComfyUI/output/`; text files are saved in `data/text/`.
