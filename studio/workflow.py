"""Translate the bundled graph to ComfyUI's execution API and describe its nodes."""
import copy
import secrets


DESCRIPTIONS = {
    'LoadImage': ('Read input image', 'Opens your uploaded image and separates its pixels and alpha mask.', 'ComfyUI', 0),
    'UnetLoaderGGUF': ('Load diffusion model', 'Loads the quantized diffusion model into memory. Loading may take time before sampling begins.', 'ComfyUI GGUF', 1),
    'CLIPLoaderGGUF': ('Load text encoder', 'Loads the quantized text encoder that converts the prompt into model conditioning.', 'ComfyUI GGUF', 1),
    'VAELoader': ('Load image codec', 'Loads the VAE used to translate between pixels and the model’s latent representation.', 'ComfyUI', 1),
    'ModelPatchLoader': ('Load structure control', 'Loads Qwen’s Canny control model to guide reconstruction using image edges.', 'ComfyUI', 1),
    'Power Lora Loader (rgthree)': ('Apply Lightning LoRA', 'Applies the fast reconstruction LoRA to the diffusion model.', 'rgthree', 1),
    'CLIPTextEncode': ('Encode prompt', 'Converts the positive or negative text prompt into conditioning for the diffusion model.', 'ComfyUI', 1),
    'ModelSamplingAuraFlow': ('Configure sampling', 'Configures the model’s sampling schedule for reconstruction.', 'ComfyUI', 1),
    'Synthid-Bypass-AdaptiveDenoise': ('Choose reconstruction strength', 'Measures image resolution and calculates denoise strength from the adaptive settings.', 'Synthid Bypass', 0),
    'Canny': ('Trace image edges', 'Extracts edges to help preserve composition and structural outlines.', 'ComfyUI', 1),
    'QwenImageDiffsynthControlnet': ('Guide reconstruction', 'Attaches edge guidance to Qwen so the reconstruction follows the original structure.', 'ComfyUI', 1),
    'VAEEncode': ('Encode original pixels', 'Compresses the input image into the latent representation used by the sampler.', 'ComfyUI', 1),
    'KSampler': ('Reconstruct image', 'Qwen redraws the image with controlled denoise. The step counter reports actual sampling progress.', 'Qwen Image', 2),
    'VAEDecode': ('Decode reconstructed image', 'Converts reconstructed latents back into visible image pixels.', 'ComfyUI', 2),
    'UltralyticsDetectorProvider': ('Load face detector', 'Loads the YOLO face detector used to locate face regions.', 'Impact Subpack', 3),
    'BboxDetectorCombined_v2': ('Locate face regions', 'Runs face detection and builds a mask of the detected regions.', 'Impact Pack', 3),
    'MaskToSEGS': ('Build region segments', 'Converts a mask into separate regions for targeted processing.', 'Impact Pack', 3),
    'ImpactSEGSToMaskBatch': ('Prepare region masks', 'Converts detected segments into masks for cropping and reconstruction.', 'Impact Pack', 3),
    'InpaintCropImproved': ('Crop image regions', 'Prepares masked crops with the surrounding context needed for local image processing.', 'Crop and Stitch', 3),
    'ImageResizeKJv2': ('Align image dimensions', 'Resizes the image or crop to match the dimensions required by the next processing stage.', 'KJNodes', 3),
    'Get Image Size': ('Measure image dimensions', 'Reads image width and height so processed regions can be aligned correctly.', 'Masquerade', 3),
    'VAEEncodeTiled': ('Encode image tiles', 'Encodes cropped pixels in tiles to reduce peak memory use.', 'ComfyUI', 3),
    'MediaPipe-FaceMeshPreprocessor': ('Map facial landmarks', 'Runs MediaPipe to find face geometry and improve the face-region masks.', 'ControlNet Aux', 3),
    'MediaPipeFaceMeshToSEGS': ('Segment facial geometry', 'Converts facial landmarks into detailed face regions.', 'Impact Pack', 3),
    'SAMLoader': ('Load segmentation model', 'Loads Segment Anything on the CPU, leaving GPU memory available for the diffusion models.', 'Impact Pack · CPU', 3),
    'ImpactSimpleDetectorSEGS': ('Refine face boundaries', 'Combines detector results with CPU-based SAM masks to define face regions.', 'Impact Pack + SAM CPU', 3),
    'SEGSDetailerModelSwap': ('Refine faces', 'Switches to Z-Image Turbo for face-region reconstruction. Images without detected faces can skip this work.', 'Synthid Bypass + Z-Image', 4),
    'SEGSPaste': ('Composite refined regions', 'Blends the processed regions back into the reconstructed image.', 'Impact Pack', 4),
    'PreviewImage': ('Write intermediate preview', 'Saves a temporary intermediate image for inspection; this is not the final result.', 'ComfyUI', 5),
    'SaveImage': ('Save final image', 'Writes the finished image into this copy’s output directory.', 'ComfyUI', 5),
    'Image Comparer (rgthree)': ('Prepare comparison', 'Makes the original and final image available for a before-and-after comparison.', 'rgthree', 5),
}


def compile_workflow(workflow, registry):
    nodes = {str(n['id']): n for n in workflow['nodes']}
    links = {link[0]: link for link in workflow['links']}

    def source(link_id, visited=None):
        visited = set() if visited is None else visited
        link = links[link_id]
        node_id = str(link[1])
        node = nodes[node_id]
        if node.get('mode', 0) != 4:
            return [node_id, link[2]]
        if node_id in visited:
            raise ValueError('Cycle while resolving bypassed nodes')
        visited.add(node_id)
        for socket in node.get('inputs', []):
            if socket.get('link') is not None and socket['type'] == link[5]:
                return source(socket['link'], visited)
        raise ValueError(f'Cannot resolve bypassed node {node_id}')

    prompt = {}
    for node_id, node in nodes.items():
        kind = node['type']
        if kind == 'Note' or node.get('mode', 0) in (2, 4):
            continue
        if kind not in registry:
            raise ValueError(f'Missing node: {kind}')
        schema = registry[kind]
        inputs = {}
        widgets = iter(node.get('widgets_values', []))
        if kind == 'Power Lora Loader (rgthree)':
            for value in node.get('widgets_values', []):
                if isinstance(value, dict) and 'lora' in value:
                    inputs[f'lora_{len(inputs) + 1}'] = value
        else:
            for group in ('required', 'optional'):
                names = schema.get('input_order', {}).get(group, list(schema['input'].get(group, {})))
                for name in names:
                    spec = schema['input'][group][name]
                    options = spec[1] if len(spec) > 1 and isinstance(spec[1], dict) else {}
                    is_widget = isinstance(spec[0], list) or spec[0] in ('INT', 'FLOAT', 'BOOLEAN', 'STRING')
                    if is_widget and not options.get('forceInput', False):
                        value = next(widgets, options.get('default', spec[0][0] if isinstance(spec[0], list) else None))
                        if value is not None:
                            inputs[name] = value
                        if options.get('control_after_generate'):
                            next(widgets, None)
        for socket in node.get('inputs', []):
            if socket.get('link') is not None:
                inputs[socket['name']] = source(socket['link'])
        # SAM's custom GPU loader does not account for its large attention
        # workspace alongside diffusion weights. Use its supported CPU mode.
        if kind == 'SAMLoader':
            inputs['device_mode'] = 'CPU'
        prompt[node_id] = {'class_type': kind, 'inputs': inputs, '_meta': {'title': node.get('title', kind)}}

    # Show only nodes that contribute to an actual output, as ComfyUI does.
    needed = set()

    def visit(node_id):
        if node_id in needed:
            return
        needed.add(node_id)
        for value in prompt[node_id]['inputs'].values():
            if isinstance(value, list) and len(value) == 2 and str(value[0]) in prompt:
                visit(str(value[0]))

    for node_id, node in prompt.items():
        if registry[node['class_type']].get('output_node'):
            visit(node_id)
    return {key: value for key, value in prompt.items() if key in needed}


def describe_graph(prompt):
    descriptions = []
    for node_id, node in prompt.items():
        kind = node['class_type']
        label, description, tool, stage = DESCRIPTIONS[kind]
        if kind == 'UnetLoaderGGUF':
            label = 'Load Qwen model' if 'qwen' in node['inputs']['unet_name'].lower() else 'Load Z-Image model'
        details = {k: v for k, v in node['inputs'].items() if not isinstance(v, (list, dict))}
        descriptions.append({'id': node_id, 'type': kind, 'label': label, 'description': description,
                             'tool': tool, 'stage': stage, 'details': details})
    edges = [{'from': str(value[0]), 'to': node_id, 'input': name}
             for node_id, node in prompt.items() for name, value in node['inputs'].items()
             if isinstance(value, list) and len(value) == 2 and str(value[0]) in prompt]
    return {'nodes': descriptions, 'edges': edges}


def make_run(template, image, settings):
    prompt = copy.deepcopy(template)
    prompt['11']['inputs']['image'] = image
    for node_id in ('3', '592'):
        prompt[node_id]['inputs']['seed'] = secrets.randbelow(2**48)
    for key in ('adaptive_level', 'denoise_min', 'denoise_max'):
        prompt['595']['inputs'][key] = settings[key]
    prompt['62']['inputs']['filename_prefix'] = 'Synth-Studio'
    return prompt
