import asyncio
import json
from pathlib import Path
import sys
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'studio'))
from workflow import compile_workflow, describe_graph, make_run

sys.path.insert(0, str(ROOT / 'ComfyUI'))
sys.argv = ['check-workflow', '--cpu', '--disable-assets']
import comfy.options
comfy.options.enable_args_parsing()
import nodes
import execution
import server
from app.assets.manager import default_asset_manager


async def check():
    server.PromptServer(asyncio.get_running_loop(), default_asset_manager())
    await nodes.init_extra_nodes(init_api_nodes=False)
    with urlopen('http://127.0.0.1:8191/object_info') as response:
        registry = json.load(response)
    workflow = json.loads((ROOT / 'studio/workflows/image-reconstruction.json').read_text())
    template = compile_workflow(workflow, registry)
    prompt = make_run(template, 'example.png', {'adaptive_level': 6, 'denoise_min': .08, 'denoise_max': .15})
    result = await execution.validate_prompt('d895a64c-76f3-4282-9493-a5a5aeab9e43', prompt, None)
    print('VALIDATION:', result)
    assert result[0], result
    graph = describe_graph(prompt)
    assert len(graph['nodes']) == len(template)
    assert all(edge['from'] in prompt and edge['to'] in prompt for edge in graph['edges'])
    assert prompt['11']['inputs']['image'] == 'example.png'
    assert prompt['3']['inputs']['denoise'] == ['595', 0]
    assert prompt['564']['inputs']['lora_1']['strength'] == .8
    assert prompt['8']['inputs']['pixels'] == ['11', 0]
    assert '609' not in prompt
    print(f"PASS: {len(template)} executable nodes, {len(graph['edges'])} dependencies. ComfyUI accepts the full prompt.")


asyncio.run(check())
