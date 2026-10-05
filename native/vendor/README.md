# Native dependencies

This directory contains the minimal build dependencies used by StarGlass.
No build step reads the local `references/` directory.

Upstream snapshot: [poncippg-spec/liquidDX11](https://github.com/poncippg-spec/liquidDX11),
commit `00c2b2b19eb5523abde473b2c08220326d4146d4`.

- `imgui/`: Dear ImGui 1.92.8 core, Win32/DX11 backends and FreeType backend.
  MIT license in `imgui/LICENSE.txt`. The upstream `imconfig.h` enables FreeType.
- `liquidDX11/glass/`: glass surface, desktop capture, shaders and widget fragments.
  MIT license; full notice in the root `THIRD_PARTY_NOTICES.md`.
  StarGlass replaces desktop duplication with `live_desktop.h` (independent
  Windows Graphics Capture window frames composited on the GPU), so panels can
  be screenshotted without feedback or a frozen background. It also modifies
  raw sampling and material parameters, and adds `shared_desktop.h` for a shared
  GPU background across up to 12 windows.
- `freetype/`: upstream FreeType headers and x64 static library. Distributed under
  the FTL option, with full license texts in `FTL.TXT` and `LICENSE.TXT`.

The demo application, bundled fonts, icon fonts and media are not included.
StarGlass loads fonts installed on Windows and uses its own application icon.
See `../CMakeLists.txt` for the complete compiled source list.
