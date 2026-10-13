# Synth Forge

A local image and text workspace built around the copied Synthid-Bypass V2 workflow. Processing runs on this device's GPU or CPU.

## Source checkout

This repository contains the Synth Forge interface, the image workflow under
`studio/workflows/image-reconstruction.json`, and the local processing adapters.
Model weights, installed dependencies, uploads, outputs, and logs are excluded
from Git.

## Start

```sh
cd /home/nishant/github/synth
./start-forge.sh
```

Open **http://127.0.0.1:8190**. The launcher also starts this copy's ComfyUI engine
on port **8191**. The original installation on port 8188 is independent.
Press Ctrl+C in the launch terminal to stop Synth Forge and its engine.

The interface and image engine listen on localhost. Image reconstruction uses
the local ComfyUI engine; text editing uses the local Ollama service. No account,
hosted workspace, or billing setup is required.

For CPU testing: `./start-forge.sh --cpu`. CPU diffusion is substantially slower.
If NVIDIA reports a fatal UVM error or “Node Reboot Required”, reboot the computer
before using the normal GPU launcher. Do not run heavy inference in both installs
at once: they share the same physical GPU.

## Views

- **Process:** upload an image and click Run image. The graph initially stays
  empty; nodes and their actual dependency connections appear as tools execute.
  The right panel explains the active tool and shows timestamped activity.
  Sampling steps and intermediate previews appear when the engine provides them.
  Completed and cached nodes have separate indicators. “Show full graph” reveals
  the plan before execution; “Follow live” keeps the current node in view.
- **Minimal:** shows input, output, and an interactive before/after comparison.
  Switching views does not stop or restart processing.
- **Compare:** move the slider to inspect changes. Save comparison downloads a
  labelled side-by-side PNG. Download saves the output at its original resolution.

SVG files can be selected, previewed, and processed. A Rasterize SVG step renders
the SVG as PNG pixels before the image engine reads it, while keeping the original
SVG for preview and comparison. The prepared PNG is reused on later runs.

Settings are visible by default in both views. Adaptive level, minimum denoise,
and maximum denoise are editable before each run and persist in your browser.
They are locked while a job runs. CPU mode has a persistent warning banner and
an explicitly labelled Run image on CPU (slow) button.
No image-quality or watermark-removal changes were made to the supplied pipeline.
Segment Anything runs on the CPU to avoid exhausting GPU memory during face-boundary
refinement; reconstruction and face detail sampling still use the GPU engine.
Image runs finish after the local engine saves the final image. Images are not
submitted to external provenance checkers. Text verification uses the local
Desklib model; completed attempts display Done, with the estimate or failure
message available in the selected node's details.
The progress bar counts completed tools; it is not an estimate of remaining time.
Some nodes load models without reporting an internal percentage. Graph clicks
show a node's explanation and technical settings. Stop run cancels only that job.

The last upload, output, view, and job ID persist in the browser. A running job can
be reconnected after a page refresh. Intermediate previews are labelled separately
and are not offered as final downloads.

## Text files

Select **Text files**, upload a `.txt`, `.md`, or `.text` file (up to 2 MB), and
click **Run text**. The output is downloadable in the original text format.
Input/output previews and a highlighted comparison let you review changes. Image
and text sessions are retained separately when switching workspaces.

Text editing uses the existing local Ollama service, defaulting to `qwen2.5:7b`
when installed. The default wording-change limit is 12%. Each proposed passage
is checked for protected names, numbers, currencies, percentages, qualifications,
quotations, citations, Markdown structure, edit size, and semantic equivalence.
Edits that fail a check retain the original passage. These are safeguards rather
than a guarantee of perfect equivalence; review the comparison. Fenced code is
retained verbatim, including unclosed fences. Encoding/BOM and line endings are
retained. UTF-8, UTF-16/32 with BOM, and Windows-1252 are supported.

The graph follows Read text → Load model → Light edit → Meaning checks → Save text
→ Check Desklib → Save report. Text processing and the detector use CPU, avoiding
competition with image models for GPU memory. Desklib scores the final output
once; its score is not fed back into editing. Finished detector attempts display
Done, with the actual estimate in the node details.

The detector is Desklib’s published
[open English-text model](https://huggingface.co/desklib/ai-text-detector-v1.01),
run locally at a pinned revision. Scores may differ from Desklib’s website and
do not establish authorship. Longer outputs are scored in token windows rather
than silently truncated. Text files stay local. Original uploads and complete
outputs are under `data/text/`; model files are under `studio/models/desklib/`.
Displayed previews are limited to 50,000 characters, while downloads contain
the full output.

The detector is installed in this workspace. To install it in a fresh copy:

```sh
bash studio/install-desklib.sh
```

Ollama must be running with an installed local text model. No API key is needed.

## Files

Images and their metadata are saved in this installation's `ComfyUI/input/` and
`ComfyUI/output/` directories. Text inputs and outputs are under `data/text/`.
The Save verification report node in text mode downloads the local detector
report. Processing and checks use installed local models; initial dependency
and model installation requires downloads.

