# Pine Tree 01 texture source

Texture atlas source: [Poly Haven Pine Tree 01](https://polyhaven.com/a/pine_tree_01), by Rico Cilliers (model) and Rob Tuytel (photography). Poly Haven publishes its assets under [CC0](https://polyhaven.com/license). The local demo does not call their live API, so the demo has no API dependency or required attribution.

Only four 1K source files are included; no 17-million-polygon source tree or geometry binary is included. `twig_basecolor_alpha_1k.png` is generated from the original color and opacity atlases with the `scripts/prepare-pine-textures.py` Pillow script. The script verifies each source MD5 before combining unchanged RGB and grayscale alpha channels.

| File | Official source | MD5 |
| --- | --- | --- |
| `twig_diff_1k.jpg` | `https://dl.polyhaven.org/file/ph-assets/Models/jpg/1k/pine_tree_01/pine_tree_01_twig_diff_1k.jpg` | `b6e5f4e8c228c275e5ff75cb165c2e1f` |
| `twig_alpha_1k.jpg` | `https://dl.polyhaven.org/file/ph-assets/Models/jpg/1k/pine_tree_01/pine_tree_01_twig_alpha_1k.jpg` | `e9a69633f4c1d9b8a460c3f05fc8d75e` |
| `bark_diff_1k.jpg` | `https://dl.polyhaven.org/file/ph-assets/Models/jpg/1k/pine_tree_01/pine_tree_01_bark_diff_1k.jpg` | `7d3a558ed614c7e75594c7be3bf80311` |
| `bark_nor_gl_1k.jpg` | `https://dl.polyhaven.org/file/ph-assets/Models/jpg/1k/pine_tree_01/pine_tree_01_bark_nor_gl_1k.jpg` | `bb6e3a6eea777d992cef48fabfdc538c` |

The combined RGBA atlas is 1024×1024, 1,299,519 bytes, SHA-256 `c5e07b9cc8e4caa484d8c1ef645d3f9042ce8774ca3bca4c3d173d4cb0336916`.
