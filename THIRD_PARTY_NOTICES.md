# Third-party notices

## liquid-glass-studio

https://github.com/iyinchao/liquid-glass-studio

The refraction edge formula and chromatic channel sampling in
`src/glass/fragment.glsl` are adapted from this project. StarGlass uses a
smaller, single-panel shader and a separate Windows region sampler.

MIT License

Copyright (c) 2024 Charles Yin

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## dynamic-island

https://github.com/molian313/dynamic-island

MIT-licensed architectural reference for GDI desktop-region sampling,
capture exclusion and texture-driven glass. Its Rust implementation was not
copied; StarGlass's sampler is implemented independently in C#.

## liquidDX11 (native glass panel)

https://github.com/poncippg-spec/liquidDX11

The native desktop panel (`native/glass-panel/`) is built on the glass module
from this project: `glass/backdrop.cpp` (original desktop capture, replaced in StarGlass by
independent Windows Graphics Capture sources), `glass/glass.cpp` and `glass/shaders.h` (HLSL glass surface).

StarGlass changes on top of it:

- an unfiltered desktop texture is bound to the shader as `BlurRaw`, so the glass
  centre can be perfectly crisp instead of always passing through one blur tap;
- the material table's animated film grain is disabled by default;
- a different application layer, window setup and IPC.

MIT License

Copyright (c) 2026 poncipp (https://github.com/poncippg-spec)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

> StarGlass vendors only the components needed to build the panel. The
> upstream demo, fonts, icon fonts and media are not redistributed. ImGui and
> FreeType retain the licenses below.

## Dear ImGui (linked into glasspanel.exe)

https://github.com/ocornut/imgui — version 1.92.8

Dear ImGui is compiled into the native panel for its UI layout and draw lists.

MIT License

Copyright (c) 2014-2026 Omar Cornut

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## FreeType (linked into glasspanel.exe)

https://freetype.org

The bundled FreeType build is used for font rasterisation through ImGui's
`misc/freetype` backend. It is distributed under the FreeType License (FTL) or
GPLv2, at your option; StarGlass relies on the FTL option. The full texts ship
with the source under
`native/vendor/freetype/FTL.TXT` and `LICENSE.TXT`; distribution copies are
also in `licenses/FreeType-FTL.txt` and `licenses/FreeType-LICENSE.txt`.

Portions of this software are copyright (c) 1996-2024 The FreeType Project
(https://www.freetype.org). All rights reserved.

Copyright (c) 1996-2024 David Turner, Robert Wilhelm, and Werner Lemberg.

## Application dependencies

- React / React DOM: MIT; distribution texts in `licenses/React-MIT.txt` and
  `licenses/React-DOM-MIT.txt`. https://github.com/facebook/react
- Lucide: ISC, including the Feather attribution; full text in
  `licenses/Lucide-ISC.txt`. https://github.com/lucide-icons/lucide
- Electron: MIT; `licenses/Electron-MIT.txt`, plus the runtime
  `LICENSE` and `LICENSES.chromium.html` beside the packaged executable.
  https://github.com/electron/electron
- Vite: MIT, build-time dependency. https://github.com/vitejs/vite

StarGlass code is MIT licensed under the root `LICENSE`. Third-party licenses
remain applicable to their components.
