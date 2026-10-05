// StarGlass native glass panel.
//
// This replaces the rejected GDI-capture + WebGL shader path with the liquidDX11
// approach: DXGI Desktop Duplication -> GPU texture -> D3D11/HLSL glass.
//
// The panel is a borderless transparent desktop window rendering the glass
// surface plus the GitHub figures, with drag / always-on-top / click-through.
// It carries no data logic of its own: the Electron main process owns GitHub
// fetching and settings, and pushes them over loopback TCP (see SG_IPC_PORT).
//
// Independent Windows Graphics Capture sources provide a live GPU background
// without capturing our own panels. Normal screenshots can include the window.
// SG_DUMP_FRAME remains available for renderer diagnostics.
//
// Environment:
//   SG_W, SG_H, SG_RADIUS, SG_MARGIN, SG_FONT_PX, SG_X, SG_Y
//   SG_BLUR, SG_OPACITY, SG_SAT, SG_REFRACTION, SG_CHROMA, SG_EDGE, SG_SHADOW
//   SG_FLOW, SG_GRAIN, SG_GRAIN_MAT, SG_SHEEN, SG_LENS, SG_GLOW_ANIM, SG_MATERIAL
//   SG_TOPMOST, SG_CLICKTHROUGH, SG_DRAG_H, SG_SHOW_FPS
//   SG_DUMP_FRAME, SG_DUMP_AT, SG_DUMP_EVERY, SG_DUMP_COUNT
//   SG_IPC_PORT  (0 / unset = no IPC, standalone mode)
//
// ASCII-only source on purpose: MSVC is driven with /utf-8 for this target, but
// keeping it ASCII avoids the BOM-less encoding trap entirely.

// winsock2.h MUST come before windows.h, or winsock1 headers clash with winsock2.
#include <winsock2.h>
#include <ws2tcpip.h>
#include <windows.h>
#include <d3d11.h>
#include <dxgi.h>
#include <dwmapi.h>
#include <commctrl.h>
#include <uxtheme.h>

#include <algorithm>
#include <atomic>
#include <cstdio>
#include <cstdlib>
#include <mutex>
#include <string>
#include <thread>
#include <cmath>
#include <sstream>
#include <chrono>
#include <mmsystem.h>
#pragma comment(lib, "winmm.lib")

#include "imgui.h"
#include "imgui_impl_dx11.h"
#include "imgui_impl_win32.h"
#include "glass/backdrop.h"
#include "glass/glass.h"
#include "logo_pixels.h"

#pragma comment(lib, "ws2_32.lib")
#pragma comment(lib, "d3d11.lib")
#pragma comment(lib, "dxgi.lib")
#pragma comment(lib, "dwmapi.lib")
#pragma comment(lib, "comctl32.lib")
#pragma comment(lib, "uxtheme.lib")
#pragma comment(lib, "d3dcompiler.lib")
#pragma comment(lib, "user32.lib")
#pragma comment(lib, "gdi32.lib")

extern IMGUI_IMPL_API LRESULT ImGui_ImplWin32_WndProcHandler(HWND, UINT, WPARAM, LPARAM);

// ---------------------------------------------------------------- env helpers

static std::string EnvS(const char* name, const char* def) {
    char buf[512] = {};
    DWORD n = ::GetEnvironmentVariableA(name, buf, sizeof(buf));
    return (n > 0 && n < sizeof(buf)) ? std::string(buf) : std::string(def);
}
static float EnvF(const char* name, float def) {
    char buf[64] = {};
    DWORD n = ::GetEnvironmentVariableA(name, buf, sizeof(buf));
    return (n > 0 && n < sizeof(buf)) ? (float)::atof(buf) : def;
}
static int EnvI(const char* name, int def) {
    char buf[64] = {};
    DWORD n = ::GetEnvironmentVariableA(name, buf, sizeof(buf));
    return (n > 0 && n < sizeof(buf)) ? ::atoi(buf) : def;
}

#include "auto_text.h"
static AutoTextSampler g_autoText;

// -------------------------------------------------------------------- globals

static ID3D11Device*           g_dev  = nullptr;
static ID3D11DeviceContext*    g_ctx  = nullptr;
static IDXGISwapChain*         g_swap = nullptr;
static ID3D11RenderTargetView* g_rtv  = nullptr;
static ID3D11ShaderResourceView* g_glassSurface = nullptr;
static ID3D11ShaderResourceView* g_logo = nullptr;
static float g_textOutline = 0.f, g_textOutlineWidth = 1.f;
static float g_textLightMix = 0.f;
static Glass::Backdrop         g_backdrop;
static Glass::Renderer         g_renderer;
static bool                    g_occluded = false;
static UINT                    g_rw = 0, g_rh = 0;
static HWND                    g_hwnd = nullptr;
static int                     g_dragH = 46;
static float                   g_radius = 28.0f;
static float                   g_margin = 0.0f;
static float                   g_scale  = 1.0f;
static float g_outlineRadius=28.f;
static bool g_outlinePill=false;
static bool g_dragging=false;
static bool g_mini=false,g_canResize=false,g_capturePaused=false,g_miniTipEnabled=false;
static int g_minPanelHeight=330,g_prepareRound=-1;
static DWORD g_prepareSince=0;
static unsigned long long g_prepareFrame=0;
static HWND g_miniTip=nullptr;
static std::wstring g_miniTipText;
static POINT g_dragAnchor={}, g_dragOrigin={};
static unsigned g_dragFrames=0;
static bool g_captureRequested=false;

// Material constants that the host does not drive (yet); captured once from the
// environment so ApplyLiveState() can re-issue SetGlobalMaterial each change.
static float g_sat = 1.10f, g_refr = 18.0f, g_chroma = 4.0f, g_edge = 0.35f, g_shadow = 0.046f;

// Defined with the IPC client further down, but WndProc needs it.
static void PanelSend(const std::string& line);
// Defined near main(); WndProc's modal-loop timer calls it.
static void RenderFrame();

// ------------------------------------------------------------- device / window

static void CreateRenderTarget() {
    ID3D11Texture2D* back = nullptr;
    if (SUCCEEDED(g_swap->GetBuffer(0, IID_PPV_ARGS(&back))) && back) {
        g_dev->CreateRenderTargetView(back, nullptr, &g_rtv);
        g_dev->CreateShaderResourceView(back, nullptr, &g_glassSurface);
        back->Release();
    }
}
static void CleanupRenderTarget() {
    if (g_glassSurface) { g_glassSurface->Release(); g_glassSurface=nullptr; }
    if (g_rtv) { g_rtv->Release(); g_rtv = nullptr; }
}

static bool CreateDeviceD3D(HWND hwnd) {
    DXGI_SWAP_CHAIN_DESC sd;
    ZeroMemory(&sd, sizeof(sd));
    sd.BufferCount = 2;
    sd.BufferDesc.Format = DXGI_FORMAT_R8G8B8A8_UNORM;
    sd.BufferDesc.RefreshRate.Numerator = 60;
    sd.BufferDesc.RefreshRate.Denominator = 1;
    sd.Flags = DXGI_SWAP_CHAIN_FLAG_ALLOW_MODE_SWITCH;
    sd.BufferUsage = DXGI_USAGE_RENDER_TARGET_OUTPUT | DXGI_USAGE_SHADER_INPUT;
    sd.OutputWindow = hwnd;
    sd.SampleDesc.Count = 1;
    sd.Windowed = TRUE;
    sd.SwapEffect = DXGI_SWAP_EFFECT_DISCARD;

    UINT flags = D3D11_CREATE_DEVICE_BGRA_SUPPORT;
    D3D_FEATURE_LEVEL fl;
    const D3D_FEATURE_LEVEL fla[2] = { D3D_FEATURE_LEVEL_11_0, D3D_FEATURE_LEVEL_10_0 };
    HRESULT res = D3D11CreateDeviceAndSwapChain(nullptr, D3D_DRIVER_TYPE_HARDWARE, nullptr,
                                                flags, fla, 2, D3D11_SDK_VERSION, &sd,
                                                &g_swap, &g_dev, &fl, &g_ctx);
    if (res == DXGI_ERROR_UNSUPPORTED) {
        res = D3D11CreateDeviceAndSwapChain(nullptr, D3D_DRIVER_TYPE_WARP, nullptr,
                                            flags, fla, 2, D3D11_SDK_VERSION, &sd,
                                            &g_swap, &g_dev, &fl, &g_ctx);
    }
    if (res != S_OK) return false;
    IDXGIDevice1* latencyDevice=nullptr;
    if (SUCCEEDED(g_dev->QueryInterface(__uuidof(IDXGIDevice1),(void**)&latencyDevice))) {
        const HRESULT latencyResult=latencyDevice->SetMaximumFrameLatency(1);
        std::printf("[panel] frameLatency=1 hr=0x%08lx\n",(unsigned long)latencyResult);
        latencyDevice->Release();
    }
    CreateRenderTarget();
    return true;
}

// ----------------------------------------------------------------- frame dump

static void DumpBackBuffer(IDXGISwapChain* sc, ID3D11Device* dev, ID3D11DeviceContext* ctx) {
    static int  s_at = -1, s_every = 0, s_count = 1, s_frame = 0, s_taken = 0;
    static bool s_init = false, s_disabled = false;
    static std::string s_path;
    if (s_disabled) return;
    if (!s_init) {
        s_init = true;
        char env[MAX_PATH] = {};
        DWORD n = ::GetEnvironmentVariableA("SG_DUMP_FRAME", env, MAX_PATH);
        if (n == 0 || n >= MAX_PATH) { s_disabled = true; return; }
        s_path = env;
        s_at = EnvI("SG_DUMP_AT", 90);          if (s_at < 1) s_at = 1;
        s_count = EnvI("SG_DUMP_COUNT", 1);     if (s_count < 1) s_count = 1;
        s_every = EnvI("SG_DUMP_EVERY", 0);
        if (s_count > 1 && s_every < 1) s_every = 1;
    }
    ++s_frame;
    const bool requested=g_captureRequested; g_captureRequested=false;
    if (!requested && (s_taken >= s_count || s_frame < s_at)) return;
    if (!requested && s_every > 0 && ((s_frame - s_at) % s_every) != 0) return;
    // A multi-frame run writes "<path>.NNNN" so two frames from the SAME process
    // can be compared, which separates real per-frame animation from run-to-run
    // variation in what the desktop duplication happens to deliver.
    std::string out = s_path;
    if (requested) {
        static int requestNumber=0; char suffix[32];
        std::snprintf(suffix,sizeof(suffix),".request-%d",++requestNumber); out+=suffix;
        if(EnvI("SG_TRACE_STATE",0)) {std::printf("[capture] request=%d textMix=%.3f\n",requestNumber,g_textLightMix);std::fflush(stdout);}
    } else if (s_count > 1) {
        char suffix[32];
        std::snprintf(suffix, sizeof(suffix), ".%04d", s_frame);
        out += suffix;
    }
    ++s_taken;

    ID3D11Texture2D* bb = nullptr;
    if (FAILED(sc->GetBuffer(0, IID_PPV_ARGS(&bb))) || !bb) return;
    D3D11_TEXTURE2D_DESC d = {};
    bb->GetDesc(&d);
    d.Usage = D3D11_USAGE_STAGING;
    d.BindFlags = 0;
    d.CPUAccessFlags = D3D11_CPU_ACCESS_READ;
    d.MiscFlags = 0;
    ID3D11Texture2D* stg = nullptr;
    if (SUCCEEDED(dev->CreateTexture2D(&d, nullptr, &stg)) && stg) {
        ctx->CopyResource(stg, bb);
        D3D11_MAPPED_SUBRESOURCE m = {};
        if (SUCCEEDED(ctx->Map(stg, 0, D3D11_MAP_READ, 0, &m))) {
            FILE* f = fopen(out.c_str(), "wb");
            if (f) {
                for (UINT y = 0; y < d.Height; ++y)
                    fwrite((const unsigned char*)m.pData + (size_t)y * m.RowPitch, 1, (size_t)d.Width * 4, f);
                fclose(f);
            }
            ctx->Unmap(stg, 0);
            FILE* mf = fopen((out + ".txt").c_str(), "wb");
            if (mf) { std::fprintf(mf, "%u %u %u\n", d.Width, d.Height, (unsigned)d.Format); fclose(mf); }
        }
        stg->Release();
    }
    bb->Release();
}

// --------------------------------------------------------------------- window

static void ReportPosition(HWND hwnd) {
    RECT wr; ::GetWindowRect(hwnd,&wr);
    char cmd[96];
    std::snprintf(cmd,sizeof(cmd),"CMD moved x=%ld y=%ld",(long)std::lround(wr.left/g_scale),(long)std::lround(wr.top/g_scale));
    PanelSend(cmd);
}
static void UpdateMiniTipRect(HWND hwnd) {
    if(!g_miniTip) return;
    TOOLINFOW info={};info.cbSize=sizeof(info);info.hwnd=hwnd;info.uId=1;
    if(g_miniTipEnabled) ::GetClientRect(hwnd,&info.rect);
    ::SendMessageW(g_miniTip,TTM_NEWTOOLRECTW,0,(LPARAM)&info);
}
static void UpdateDragPosition() {
    if (!g_dragging) return;
    POINT cursor; ::GetCursorPos(&cursor);
    ::SetWindowPos(g_hwnd,nullptr,g_dragOrigin.x+cursor.x-g_dragAnchor.x,
        g_dragOrigin.y+cursor.y-g_dragAnchor.y,0,0,SWP_NOSIZE|SWP_NOZORDER|SWP_NOACTIVATE);
}
static void EndDrag(HWND hwnd) {
    if (!g_dragging) return;
    UpdateDragPosition(); g_dragging=false;
    if (::GetCapture()==hwnd) ::ReleaseCapture();
    ReportPosition(hwnd);
    std::printf("[drag] end frames=%u\n",g_dragFrames); std::fflush(stdout);
}

// Clip the actual HWND, not only the shader. This also clips DWM/non-client
// painting and the shader's faint external shadow at the bottom corners.
static void UpdatePanelOutline(HWND hwnd,bool force=false) {
    if(!hwnd)return;
    RECT client;::GetClientRect(hwnd,&client);const int width=client.right,height=client.bottom;
    if(width<=0||height<=0)return;
    const float radius=g_outlinePill?std::min(width,height)*.5f:std::clamp(g_outlineRadius,0.f,std::min(width,height)*.5f);
    static HWND lastWindow=nullptr;static int lastW=0,lastH=0;static float lastRadius=-1;
    if(!force&&lastWindow==hwnd&&lastW==width&&lastH==height&&lastRadius==radius)return;
    lastWindow=hwnd;lastW=width;lastH=height;lastRadius=radius;
    const DWORD noBorder=0xfffffffe;const int customCorners=1;
    ::DwmSetWindowAttribute(hwnd,34,&noBorder,sizeof(noBorder));
    ::DwmSetWindowAttribute(hwnd,33,&customCorners,sizeof(customCorners));
    HRGN shape=radius>0?::CreateRoundRectRgn(0,0,width+1,height+1,(int)std::lround(radius*2),(int)std::lround(radius*2)):nullptr;
    if(radius>0&&!shape){lastRadius=-1;return;}
    if(!::SetWindowRgn(hwnd,shape,TRUE)){
        if(shape)::DeleteObject(shape);lastRadius=-1;
    }
    // On success the system owns the region. Do not DeleteObject(shape).
}
static LRESULT WINAPI WndProc(HWND h, UINT m, WPARAM w, LPARAM l) {
    if (ImGui_ImplWin32_WndProcHandler(h, m, w, l)) return true;
    switch (m) {
    case WM_NCCALCSIZE: return 0; // Keep the resize frame outside the glass client.
    case WM_NCPAINT: return 0;
    case WM_NCACTIVATE: return TRUE;
    case WM_SIZE:
        if (w != SIZE_MINIMIZED) { g_rw = LOWORD(l); g_rh = HIWORD(l); }
        UpdateMiniTipRect(h);
        if(g_hwnd==h)UpdatePanelOutline(h);
        return 0;
    case WM_GETMINMAXINFO: {
        MINMAXINFO* bounds=(MINMAXINFO*)l;
        bounds->ptMinTrackSize=POINT{(LONG)(260*g_scale),(LONG)(g_minPanelHeight*g_scale)};
        bounds->ptMaxTrackSize=POINT{(LONG)(1200*g_scale),(LONG)(1200*g_scale)};return 0;
    }
    case WM_NCHITTEST:
        if(g_canResize) {
            POINT p={(short)LOWORD(l),(short)HIWORD(l)};::ScreenToClient(h,&p);RECT r;::GetClientRect(h,&r);
            const int edge=(int)(5*g_scale);bool left=p.x<edge,right=p.x>=r.right-edge,top=p.y<edge,bottom=p.y>=r.bottom-edge;
            if(top&&left)return HTTOPLEFT;if(top&&right)return HTTOPRIGHT;if(bottom&&left)return HTBOTTOMLEFT;if(bottom&&right)return HTBOTTOMRIGHT;
            if(left)return HTLEFT;if(right)return HTRIGHT;if(top)return HTTOP;if(bottom)return HTBOTTOM;
        }
        // The client drag path leaves the normal render loop running at display refresh.
        // Header actions are handled by ImGui; the remaining strip starts manual dragging.
        return HTCLIENT;
    case WM_LBUTTONDOWN: {
        POINT local={(short)LOWORD(l),(short)HIWORD(l)},cursor=local;
        ::ClientToScreen(h,&cursor);
        RECT cr,wr; ::GetClientRect(h,&cr); ::GetWindowRect(h,&wr);
        if (local.y>=0 && local.y<(g_mini?cr.bottom:g_dragH) && local.x>=0 && local.x<(g_mini?cr.right:cr.right-106*g_scale)) {
            if(g_miniTip) ::SendMessageW(g_miniTip,TTM_POP,0,0);
            // ImGui may already own capture for this press; taking it twice can
            // synchronously deliver WM_CAPTURECHANGED to the same window.
            if (::GetCapture()!=h) ::SetCapture(h);
            g_dragging=true; g_dragAnchor=cursor; g_dragOrigin=POINT{wr.left,wr.top}; g_dragFrames=0;
            std::printf("[drag] begin\n"); std::fflush(stdout); return 0;
        }
        break;
    }
    case WM_LBUTTONUP: if (g_dragging) { EndDrag(h); return 0; } break;
    case WM_CAPTURECHANGED: if ((HWND)l!=h) EndDrag(h); break;
    case WM_CANCELMODE: EndDrag(h); break;
    case WM_SYSCOMMAND:
        if ((w & 0xfff0) == SC_KEYMENU) return 0;
        break;
    case WM_ENTERSIZEMOVE:
        // The OS runs a modal move/size loop here, and our own message pump is
        // blocked inside DispatchMessage for its whole duration.  Without this
        // timer the panel would slide around showing a frozen picture and only
        // snap to the correct content after the drop.
        ::SetTimer(h, 1, 15, nullptr);
        return 0;
    case WM_TIMER:
        if (w == 1) RenderFrame();
        return 0;
    case WM_EXITSIZEMOVE: {
        ::KillTimer(h, 1);
        // Report the resting position so the host can persist it.
        RECT wr; ::GetWindowRect(h, &wr);
        char cmd[96];
        // Report logical coordinates: the host stores them next to getBounds()
        // values and feeds them back through SG_X/SG_Y.
        std::snprintf(cmd, sizeof(cmd), "CMD moved x=%ld y=%ld",
                      (long)(wr.left / g_scale + (wr.left < 0 ? -0.5f : 0.5f)),
                      (long)(wr.top  / g_scale + (wr.top  < 0 ? -0.5f : 0.5f)));
        PanelSend(cmd);
        RECT client;::GetClientRect(h,&client);
        std::snprintf(cmd,sizeof(cmd),"CMD resized w=%ld h=%ld",(long)std::lround(client.right/g_scale),(long)std::lround(client.bottom/g_scale));PanelSend(cmd);
        return 0;
    }
    case WM_RBUTTONUP: {
        if(g_miniTip) ::SendMessageW(g_miniTip,TTM_POP,0,0);
        PanelSend("CMD openSettings");
        return 0;
    }
    case WM_SHOWWINDOW: if(!w&&g_miniTip) ::SendMessageW(g_miniTip,TTM_POP,0,0); break;
    case WM_KEYDOWN:
        if (w == VK_ESCAPE) {
            PanelSend("CMD quit");
            ::PostQuitMessage(0);
            return 0;
        }
        break;
    case WM_DESTROY:
        ::PostQuitMessage(0);
        return 0;
    }
    return ::DefWindowProcW(h, m, w, l);
}

// ----------------------------------------------------------------------- fonts

static int SystemDpi() {
    HDC dc = ::GetDC(nullptr);
    int dpi = dc ? ::GetDeviceCaps(dc, LOGPIXELSX) : 96;
    if (dc) ::ReleaseDC(nullptr, dc);
    return dpi ? dpi : 96;
}

static void LoadFonts(int px, bool bold) {
    ImGuiIO& io = ImGui::GetIO();
    if (px < 8) px = 8; else if (px > 96) px = 96;
    const char* candidates[6];
    int n = 0;
    if (bold) {
        candidates[n++] = "C:\\Windows\\Fonts\\msyhbd.ttc";
        candidates[n++] = "C:\\Windows\\Fonts\\segoeuib.ttf";
        candidates[n++] = "C:\\Windows\\Fonts\\arialbd.ttf";
    }
    candidates[n++] = "C:\\Windows\\Fonts\\msyh.ttc";
    candidates[n++] = "C:\\Windows\\Fonts\\segoeui.ttf";
    candidates[n++] = "C:\\Windows\\Fonts\\arial.ttf";
    for (int i = 0; i < n; ++i) {
        if (::GetFileAttributesA(candidates[i]) == INVALID_FILE_ATTRIBUTES) continue;
        ImFontConfig cfg;
        cfg.OversampleH = 2;
        cfg.OversampleV = 2;
        cfg.PixelSnapH = true;
        cfg.FontNo = 0;
        ImFont* f = io.Fonts->AddFontFromFileTTF(candidates[i], (float)px, &cfg,
                                                 io.Fonts->GetGlyphRangesChineseSimplifiedCommon());
        if (f) {
            io.FontDefault = f;
            // Adding a replacement font restores ImGui's previous current size.
            // Set the requested base after the atlas update, before NewFrame.
            ImGui::GetStyle().FontSizeBase = (float)px;
            return;
        }
    }
    io.FontDefault = io.Fonts->AddFontDefault();
    ImGui::GetStyle().FontSizeBase = (float)px;
}

// Rebuilds the atlas in place so the host can change size/weight at runtime.
static void ReloadFonts(int px, bool bold) {
    ImGuiIO& io = ImGui::GetIO();
    io.Fonts->Clear();
    LoadFonts(px, bold);
    ImGui_ImplDX11_InvalidateDeviceObjects();
    ImGui_ImplDX11_CreateDeviceObjects();
}

// ------------------------------------------------------------------ IPC client
//
// Loopback TCP, newline-delimited "key=value" records.  A flat key=value line
// was chosen over JSON deliberately: the C++ side then needs no parser at all,
// and the Node side is a one-line join.  Records:
//
//   panel -> host : HELLO panel
//                   CMD quit | openSettings | refresh | menu
//                   CMD moved x=<px> y=<py>
//   host -> panel : STATE repo=<s> stars=<n> downloads=<n> flow=<f> opacity=<f>
//                         blur=<f> radius=<f> material=<i> fps=<0|1> status=<rest>
//
// "status" is taken as the remainder of the line, so it may contain spaces.

struct PanelState {
    std::string repo = "LoMoCatAp/Bika-HarmonyOS";
    long long   stars = 0;
    long long   downloads = 0;
    float       flow = 0.0f;
    float       opacity = 0.18f;
    float       blur = 0.0f;
    float       radius = 28.0f;
    int         material = 1;
    int         fps = 1;
    int         glassOnly = 0;
    int showLogo=1, showBrandText=1;
    int mini=0,resizeEnabled=0,showTooltips=0;
    std::string panelShape="auto";
    std::string status, description, version, updated, tint = "pearl", textColor = "dark";
    std::string seriesStars, seriesDownloads, deltaStars, deltaDownloads;
    long long forks = -1;
    int repoIndex = 0, repoCount = 1, refreshing = 0, hasError = 0;
    int compact = 0, topmost = 0, clickThrough = 0, frameLimit = 0;
    float gloss = .4f, refraction = 18.f, dispersion = 4.f;
    float textOutline = 0.f, textOutlineWidth = 1.f;
};

static PanelState        g_state;
static std::mutex        g_stateMutex;
static std::atomic<bool> g_stateDirty{true};
static SOCKET            g_sock = INVALID_SOCKET;
static std::mutex        g_sendMutex;
static std::atomic<bool> g_ipcConnected{false};

static void PanelSend(const std::string& line) {
    std::lock_guard<std::mutex> lk(g_sendMutex);
    if (g_sock == INVALID_SOCKET) return;
    std::string s = line + "\n";
    ::send(g_sock, s.c_str(), (int)s.size(), 0);
}

// Host commands are QUEUED, not stored in a single slot: several can arrive in
// one recv() and a lone "last command wins" cell silently dropped all but the
// final one (resize was being overwritten by the font command that followed it).
struct HostCmd { int code; int a, b, c; };
static std::mutex            g_cmdMutex;
static std::vector<HostCmd>  g_cmds;

static void PushCmd(int code, int a = 0, int b = 0, int c = 0) {
    std::lock_guard<std::mutex> lk(g_cmdMutex);
    if (g_cmds.size() < 64) g_cmds.push_back(HostCmd{ code, a, b, c });
}
static bool PopCmd(HostCmd& out) {
    std::lock_guard<std::mutex> lk(g_cmdMutex);
    if (g_cmds.empty()) return false;
    out = g_cmds.front();
    g_cmds.erase(g_cmds.begin());
    return true;
}

static std::atomic<int> g_resizeW{440}, g_resizeH{560};
static std::atomic<int> g_fontPx{14}, g_fontBold{0};

// Splits "k=v" tokens out of a HOST argument list.
static int HostArg(const std::string& s, const char* key, int def) {
    const std::string pat = std::string(key) + "=";
    const size_t at = s.find(pat);
    return (at == std::string::npos) ? def : ::atoi(s.c_str() + at + pat.size());
}

static std::string DecodeText(const std::string& value) {
    std::string out;
    for (size_t i=0;i<value.size();++i) {
        if (value[i]=='%' && i+2<value.size()) {
            char hex[3] = {value[i+1],value[i+2],0}; char* end=nullptr;
            long byte=std::strtol(hex,&end,16);
            if (*end==0) { out.push_back((char)byte); i+=2; continue; }
        }
        out.push_back(value[i]);
    }
    return out;
}

static void ApplyStateLine(const std::string& line) {
    if (line.compare(0, 5, "HOST ") == 0) {
        const std::string c = line.substr(5);
        if      (c == "show") PushCmd(1);
        else if (c == "hide") PushCmd(2);
        else if (c == "quit") PushCmd(3);
        else if (c == "capture") PushCmd(7);
        else if (c.compare(0,15,"capturePrepare ")==0) PushCmd(8,HostArg(c,"id",0));
        else if (c.compare(0,10,"captureOn ")==0) PushCmd(9,HostArg(c,"id",0));
        else if (c == "captureOff" || c == "captureLive") PushCmd(10);
        else if (c.compare(0, 5, "move ") == 0)   PushCmd(4, HostArg(c, "x", 0), HostArg(c, "y", 0));
        else if (c.compare(0, 7, "resize ") == 0) PushCmd(5, HostArg(c, "w", 440), HostArg(c, "h", 560));
        else if (c.compare(0, 5, "font ") == 0)   PushCmd(6, HostArg(c, "px", 20), HostArg(c, "bold", 0));
        return;
    }
    if (line.compare(0, 6, "STATE ") != 0) return;
    std::lock_guard<std::mutex> lk(g_stateMutex);
    const size_t statusAt = line.find(" status=");
    const size_t end = (statusAt == std::string::npos) ? line.size() : statusAt;
    size_t i = 6;
    while (i < end) {
        size_t sp = line.find(' ', i);
        if (sp == std::string::npos || sp > end) sp = end;
        std::string tok = line.substr(i, sp - i);
        size_t eq = tok.find('=');
        if (eq != std::string::npos) {
            const std::string k = tok.substr(0, eq);
            const std::string v = tok.substr(eq + 1);
            if      (k == "repo")      g_state.repo = v;
            else if (k == "stars")     g_state.stars = _strtoi64(v.c_str(), nullptr, 10);
            else if (k == "downloads") g_state.downloads = _strtoi64(v.c_str(), nullptr, 10);
            else if (k == "flow")      g_state.flow = (float)::atof(v.c_str());
            else if (k == "opacity")   g_state.opacity = (float)::atof(v.c_str());
            else if (k == "blur")      g_state.blur = (float)::atof(v.c_str());
            else if (k == "radius")    g_state.radius = (float)::atof(v.c_str());
            else if (k == "material")  g_state.material = ::atoi(v.c_str());
            else if (k == "fps")       g_state.fps = ::atoi(v.c_str());
            else if (k == "showLogo") g_state.showLogo=::atoi(v.c_str());
            else if (k == "showBrandText") g_state.showBrandText=::atoi(v.c_str());
            else if (k == "glassOnly") g_state.glassOnly = ::atoi(v.c_str());
            else if (k == "repoIndex") g_state.repoIndex = ::atoi(v.c_str());
            else if (k == "repoCount") g_state.repoCount = ::atoi(v.c_str());
            else if (k == "refreshing") g_state.refreshing = ::atoi(v.c_str());
            else if (k == "hasError") g_state.hasError = ::atoi(v.c_str());
            else if (k == "compact") g_state.compact = ::atoi(v.c_str());
            else if (k == "mini") g_state.mini = ::atoi(v.c_str());
            else if (k == "resizeEnabled") g_state.resizeEnabled = ::atoi(v.c_str());
            else if (k == "showTooltips") g_state.showTooltips = ::atoi(v.c_str());
            else if (k == "panelShape") g_state.panelShape = v;
            else if (k == "topmost") g_state.topmost = ::atoi(v.c_str());
            else if (k == "clickThrough") g_state.clickThrough = ::atoi(v.c_str());
            else if (k == "frameLimit") g_state.frameLimit = ::atoi(v.c_str());
            else if (k == "textOutline") g_state.textOutline = (float)::atof(v.c_str());
            else if (k == "textOutlineWidth") g_state.textOutlineWidth = (float)::atof(v.c_str());
            else if (k == "gloss") g_state.gloss = (float)::atof(v.c_str());
            else if (k == "refraction") g_state.refraction = (float)::atof(v.c_str());
            else if (k == "dispersion") g_state.dispersion = (float)::atof(v.c_str());
            else if (k == "description") g_state.description = DecodeText(v);
            else if (k == "version") g_state.version = DecodeText(v);
            else if (k == "updated") g_state.updated = DecodeText(v);
            else if (k == "tint") g_state.tint = v;
            else if (k == "textColor") g_state.textColor = v;
            else if (k == "seriesStars") g_state.seriesStars = v;
            else if (k == "seriesDownloads") g_state.seriesDownloads = v;
            else if (k == "deltaStars") g_state.deltaStars = v;
            else if (k == "deltaDownloads") g_state.deltaDownloads = v;
            else if (k == "forks") g_state.forks = _strtoi64(v.c_str(), nullptr, 10);
        }
        if (sp >= end) break;
        i = sp + 1;
    }
    if (statusAt != std::string::npos) g_state.status = line.substr(statusAt + 8);
    g_stateDirty = true;
}

static void IpcThread(int port) {
    WSADATA wsa;
    if (::WSAStartup(MAKEWORD(2, 2), &wsa) != 0) return;
    for (;;) {
        SOCKET s = ::socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
        if (s == INVALID_SOCKET) { ::Sleep(1000); continue; }
        sockaddr_in a = {};
        a.sin_family = AF_INET;
        a.sin_port = htons((u_short)port);
        ::InetPtonA(AF_INET, "127.0.0.1", &a.sin_addr);
        if (::connect(s, (sockaddr*)&a, sizeof(a)) != 0) {
            ::closesocket(s);
            ::Sleep(1000);
            continue;
        }
        {
            std::lock_guard<std::mutex> lk(g_sendMutex);
            g_sock = s;
        }
        g_ipcConnected = true;
        PanelSend("HELLO panel");

        std::string buf;
        char tmp[2048];
        for (;;) {
            int n = ::recv(s, tmp, sizeof(tmp), 0);
            if (n <= 0) break;
            buf.append(tmp, (size_t)n);
            size_t nl;
            while ((nl = buf.find('\n')) != std::string::npos) {
                ApplyStateLine(buf.substr(0, nl));
                buf.erase(0, nl + 1);
            }
            if (buf.size() > 65536) buf.clear();
        }
        g_ipcConnected = false;
        {
            std::lock_guard<std::mutex> lk(g_sendMutex);
            g_sock = INVALID_SOCKET;
        }
        ::closesocket(s);
        ::Sleep(1000);   // host not up yet / restarted: keep retrying
    }
}

// ------------------------------------------------------------------ appearance

// Applies the host-driven subset (blur / opacity / flow) live.
// A separate Windows tooltip can extend outside the 44px capsule window.
static void UpdateMiniTip(const PanelState& st) {
    g_miniTipEnabled=st.mini&&!st.glassOnly&&st.showTooltips;
    if(!g_hwnd) return;
    if(!st.mini||st.glassOnly||!st.showTooltips) {
        if(g_miniTip) {
            ::SendMessageW(g_miniTip,TTM_POP,0,0);
            TOOLINFOW info={};info.cbSize=sizeof(info);info.hwnd=g_hwnd;info.uId=1;
            ::SendMessageW(g_miniTip,TTM_NEWTOOLRECTW,0,(LPARAM)&info);
        }
        return;
    }
    g_miniTipText=st.repo.empty()?L"右键添加项目":std::wstring(st.repo.begin(),st.repo.end());
    g_miniTipText+=L"\r\nStars: "+(st.stars<0?std::wstring(L"--"):std::to_wstring(st.stars));
    g_miniTipText+=L"\r\nDownloads: "+(st.downloads<0?std::wstring(L"--"):std::to_wstring(st.downloads));
    TOOLINFOW info={};info.cbSize=sizeof(info);info.hwnd=g_hwnd;info.uId=1;
    info.uFlags=TTF_SUBCLASS;info.lpszText=(LPWSTR)g_miniTipText.c_str();::GetClientRect(g_hwnd,&info.rect);
    if(!g_miniTip) {
        INITCOMMONCONTROLSEX controls={sizeof(controls),ICC_WIN95_CLASSES};::InitCommonControlsEx(&controls);
        g_miniTip=::CreateWindowExW(WS_EX_TOPMOST|WS_EX_TOOLWINDOW,TOOLTIPS_CLASSW,nullptr,WS_POPUP|TTS_ALWAYSTIP|TTS_NOPREFIX,
            CW_USEDEFAULT,CW_USEDEFAULT,CW_USEDEFAULT,CW_USEDEFAULT,g_hwnd,nullptr,::GetModuleHandleW(nullptr),nullptr);
        if(!g_miniTip) return;
        ::SetWindowDisplayAffinity(g_miniTip,WDA_NONE);
        ::SetWindowTheme(g_miniTip,L"",L"");
        ::SendMessageW(g_miniTip,TTM_SETTIPBKCOLOR,RGB(228,240,235),0);
        ::SendMessageW(g_miniTip,TTM_SETTIPTEXTCOLOR,RGB(27,49,52),0);
        int corners=2;::DwmSetWindowAttribute(g_miniTip,33,&corners,sizeof(corners));
        ::SendMessageW(g_miniTip,TTM_ADDTOOLW,0,(LPARAM)&info);
        ::SendMessageW(g_miniTip,TTM_SETMAXTIPWIDTH,0,(LPARAM)(360*g_scale));
        ::SendMessageW(g_miniTip,TTM_SETDELAYTIME,TTDT_INITIAL,650);
        ::SendMessageW(g_miniTip,TTM_SETDELAYTIME,TTDT_AUTOPOP,10000);
    } else {
        ::SendMessageW(g_miniTip,TTM_UPDATETIPTEXTW,0,(LPARAM)&info);
        ::SendMessageW(g_miniTip,TTM_NEWTOOLRECTW,0,(LPARAM)&info);
    }
}

static void ApplyLiveState() {
    PanelState st;
    {
        std::lock_guard<std::mutex> lk(g_stateMutex);
        st = g_state;
        g_stateDirty = false;
    }
    Glass::SetGlobalMaterial(st.blur, st.opacity, g_sat, st.refraction,
                             st.dispersion, st.gloss, g_shadow);
    g_textOutline = std::clamp(st.textOutline,0.f,100.f);
    g_textOutlineWidth = std::clamp(st.textOutlineWidth,.5f,3.f);
    Glass::SetLiquidFlow(st.flow);
    float r=.89f, g=.94f, b=.945f;
    if (st.tint=="ocean") { r=.67f; g=.82f; b=.96f; }
    if (st.tint=="rose") { r=.95f; g=.80f; b=.83f; }
    if (st.tint=="graphite") { r=.41f; g=.48f; b=.56f; }
    for (int i=0;i<=5;++i) {
        auto& m=Glass::EditParams((Glass::Material)i);
        m.tint_rgb[0]=r; m.tint_rgb[1]=g; m.tint_rgb[2]=b;
        m.sheen=st.gloss; m.grain=0;
        m.blur_mix=st.blur; m.tint_opacity=st.opacity; m.refr_strength=st.refraction;
        m.refr_band=std::max(8.f,st.refraction); m.chroma=st.dispersion; m.highlight=st.gloss;
    }
    static int lastTop=-1, lastPass=-1;
    g_mini=st.mini!=0;g_canResize=st.resizeEnabled!=0;g_minPanelHeight=st.mini?32:330+(g_fontPx-12)*14;
    g_outlinePill=st.panelShape=="pill"||(st.panelShape=="auto"&&st.mini);
    g_outlineRadius=st.panelShape=="rectangle"?0.f:st.radius*g_scale;
    LONG_PTR style=::GetWindowLongPtrW(g_hwnd,GWL_STYLE);
    const bool hasResizeFrame=(style&WS_THICKFRAME)!=0;
    if(hasResizeFrame!=g_canResize) {
        ::SetWindowLongPtrW(g_hwnd,GWL_STYLE,g_canResize?style|WS_THICKFRAME:style&~WS_THICKFRAME);
        ::SetWindowPos(g_hwnd,nullptr,0,0,0,0,SWP_FRAMECHANGED|SWP_NOMOVE|SWP_NOSIZE|SWP_NOZORDER|SWP_NOACTIVATE);
    }
    UpdatePanelOutline(g_hwnd,hasResizeFrame!=g_canResize);
    UpdateMiniTip(st);
    if (lastTop!=st.topmost) {
        ::SetWindowPos(g_hwnd, st.topmost ? HWND_TOPMOST : HWND_NOTOPMOST, 0,0,0,0,
                       SWP_NOMOVE|SWP_NOSIZE|SWP_NOACTIVATE);
        lastTop=st.topmost;
    }
    if (lastPass!=st.clickThrough) {
        LONG_PTR ex=::GetWindowLongPtrW(g_hwnd,GWL_EXSTYLE);
        ::SetWindowLongPtrW(g_hwnd,GWL_EXSTYLE,st.clickThrough ? ex|WS_EX_TRANSPARENT : ex&~WS_EX_TRANSPARENT);
        lastPass=st.clickThrough;
    }
    if (EnvI("SG_TRACE_STATE",0)) {
        std::printf("[layout] mini=%d\n",st.mini);
        std::printf("[applied] repo=%s compact=%d gloss=%.2f refraction=%.2f dispersion=%.2f tint=%s frameLimit=%d topmost=%d clickThrough=%d points=%zu outline=%.1f outlineWidth=%.1f radius=%.1f showLogo=%d showBrandText=%d\n",
            st.repo.c_str(),st.compact,st.gloss,st.refraction,st.dispersion,st.tint.c_str(),st.frameLimit,st.topmost,st.clickThrough,st.seriesStars.size(),st.textOutline,st.textOutlineWidth,st.radius,st.showLogo,st.showBrandText);
        std::fflush(stdout);
    }
}

static void ApplyLook() {
    // Defaults mirror the "clear" preset that measured 3.6x sharper than the
    // demo's own blur=0 path (see PROGRESS-gpu-glass.md).
    Glass::SetAppearance(0);
    Glass::SetAccent(0.02f, 0.48f, 1.0f);

    g_sat    = EnvF("SG_SAT", 1.10f);
    g_refr   = EnvF("SG_REFRACTION", 18.0f);
    g_chroma = EnvF("SG_CHROMA", 4.0f);
    g_edge   = EnvF("SG_EDGE", 0.35f);
    g_shadow = EnvF("SG_SHADOW", 0.046f);
    {
        std::lock_guard<std::mutex> lk(g_stateMutex);
        g_state.blur     = EnvF("SG_BLUR", 0.0f);        // 0 = raw desktop, no blur
        g_state.opacity  = EnvF("SG_OPACITY", 0.18f);
        g_state.flow     = EnvF("SG_FLOW", 0.0f);        // 0 = static, like real glass
        g_state.radius   = EnvF("SG_RADIUS", 28.0f);
        g_state.mini     = EnvI("SG_MINI",0);
        g_state.material = EnvI("SG_MATERIAL", (int)Glass::Material::Regular);
        g_state.fps      = EnvI("SG_SHOW_FPS", 1);
        g_state.refraction = g_refr; g_state.dispersion = g_chroma; g_state.gloss = g_edge;
        g_state.topmost = EnvI("SG_TOPMOST",0); g_state.clickThrough = EnvI("SG_CLICKTHROUGH",0);
    g_stateDirty = true;
    }
    ApplyLiveState();

    Glass::GlassEdgeConfig ec;
    ec.fresnel_exp  = EnvF("SG_FRESNEL", 2.551f);
    ec.bevel_scale  = 1.0f;
    ec.lip          = EnvF("SG_LIP", 0.6f);
    ec.specular_exp = EnvF("SG_SPEC_EXP", 62.42f);
    ec.specular_amt = EnvF("SG_SPEC_AMT", 1.071f);
    ec.front_amt    = EnvF("SG_FRONT", 1.332f);
    ec.back_amt     = EnvF("SG_BACK", 2.281f);
    ec.sat_pop      = EnvF("SG_SAT_POP", 1.439f);
    ec.bevel_tilt   = EnvF("SG_BEVEL_TILT", 0.5f);
    ec.light_height = EnvF("SG_LIGHT_H", 0.2f);
    ec.edge_shadow  = EnvF("SG_EDGE_SH", 2.0f);
    ec.cursor_size  = 40.0f;
    ec.cursor_glow  = 0.0f;
    ec.sheen_amt    = EnvF("SG_SHEEN", 1.056f);
    ec.grain_amt    = EnvF("SG_GRAIN", 0.0f);
    ec.ambient_rim  = EnvF("SG_AMBIENT", 2.0f);
    ec.front_spread     = EnvF("SG_FRONT_SPREAD", 430.5f) * 0.01f;
    ec.back_spread      = EnvF("SG_BACK_SPREAD", 341.7f) * 0.01f;
    ec.panel_br_spread  = EnvF("SG_PANEL_SPREAD", 437.7f) * 0.01f;
    ec.panel_br_smooth  = EnvF("SG_PANEL_SMOOTH", 400.0f) * 0.01f;
    ec.panel_rim_angle  = EnvF("SG_PANEL_ANGLE", 330.6f);
    ec.tbl_fill     = 2.0f;
    ec.adapt_strength = 0.0f;
    ec.smooth_refraction = 0.0f;
    ec.squircle_power = 2.0f;
    ec.lens_amount  = EnvF("SG_LENS", 0.0f);
    ec.lens_power   = 4.0f;
    ec.lens_a = 1.505f; ec.lens_b = 2.020f; ec.lens_c = 2.143f; ec.lens_d = 3.214f;
    ec.glow_weight  = EnvF("SG_GLOW_W", 0.388f);
    ec.glow_phase   = 1.089f;
    ec.glow_edge0   = 0.102f;
    ec.glow_edge1   = -0.571f;
    ec.glow_bias    = 0.0f;
    ec.glow_anim    = EnvF("SG_GLOW_ANIM", 0.0f);          // another "flowing" source
    g_renderer.SetEdgeConfig(ec);

    g_renderer.SetLights(308.6f, 0.474f, 130.4f, 0.490f);

    // The material table carries its own animated film grain (Material::Regular
    // ships grain = 0.010), and glass.cpp feeds that -- not edge_cfg_.grain_amt --
    // into the shader.  Left alone it re-randomises every frame, so the glass can
    // never be truly static even with material.flow = 0.  Default it off.
    const float matGrain = EnvF("SG_GRAIN_MAT", 0.0f);
    Glass::EditParams(Glass::Material::Thin).grain    = matGrain;
    Glass::EditParams(Glass::Material::Regular).grain = matGrain;
    Glass::EditParams(Glass::Material::Thick).grain   = matGrain;
}

// ----------------------------------------------------------------------- panel

static std::string WithSeparators(long long v) {
    char raw[32];
    std::snprintf(raw, sizeof(raw), "%lld", v);
    const std::string s(raw);
    std::string out;
    int count = 0;
    for (int i = (int)s.size() - 1; i >= 0; --i) {
        out.push_back(s[(size_t)i]);
        if (++count % 3 == 0 && i > 0 && s[(size_t)i - 1] != '-') out.push_back(',');
    }
    std::reverse(out.begin(), out.end());
    return out;
}

// ImGui has no text shadow, so the glyphs are stamped in a translucent dark ink
// at four small offsets before the real text is drawn.  White text then stays
// readable over bright wallpaper without having to tint the glass itself.
static ImU32 PanelColor(ImU32 darkColor,ImU32 lightColor) {
    ImU32 mixed=0;
    for(int shift=0;shift<32;shift+=8) {
        const float a=(float)((darkColor>>shift)&255),b=(float)((lightColor>>shift)&255);
        mixed|=(ImU32)std::lround(a+(b-a)*g_textLightMix)<<shift;
    }
    return mixed;
}
static void AddTextShadowed(ImDrawList* dl, ImFont* font, float size, ImVec2 pos,
                            ImU32 ink, const char* text) {
    const int strength = (int)(g_textOutline * 2.55f + .5f);
    if (strength <= 0) { dl->AddText(font, size, pos, ink, text); return; }
    const int alpha = strength > 255 ? 255 : strength;
    const float o = g_textOutlineWidth * g_scale;
    const ImU32 halo = PanelColor(IM_COL32(255,255,255,alpha),IM_COL32(0,0,0,alpha));
    dl->AddText(font, size, ImVec2(pos.x - o, pos.y), halo, text);
    dl->AddText(font, size, ImVec2(pos.x + o, pos.y), halo, text);
    dl->AddText(font, size, ImVec2(pos.x, pos.y - o), halo, text);
    dl->AddText(font, size, ImVec2(pos.x, pos.y + o), halo, text);
    const float diagonal=o*.7071f;
    for (int x : {-1,1}) for (int y : {-1,1})
        dl->AddText(font,size,ImVec2(pos.x+x*diagonal,pos.y+y*diagonal),halo,text);
    dl->AddText(font, size, pos, ink, text);
}

#include "panel_content.h"

// ------------------------------------------------------------------------ main

// ------------------------------------------------------------------ one frame

// Called from the main loop and from WndProc's modal-loop timer.  Everything the
// panel draws happens here.
static void UpdateBackdropFrame() {
    if(::IsWindowVisible(g_hwnd)||g_backdrop.sharedProducer())g_backdrop.Capture();
}

static void RenderFrame() {
    if (!g_swap || !ImGui::GetCurrentContext()) return;
    if(g_backdrop.sharedProducer())UpdateBackdropFrame();
    static auto nextFrame = std::chrono::steady_clock::now();
    int limit;
    { std::lock_guard<std::mutex> lk(g_stateMutex); limit=g_dragging||g_state.frameLimit==0?0:std::clamp(g_state.frameLimit,15,360); }
    const auto now=std::chrono::steady_clock::now();
    if (limit>0 && now<nextFrame) { ::Sleep(1); return; }
    if(!g_backdrop.sharedProducer())UpdateBackdropFrame();
    // Hidden and occluded overlays must still complete the snapshot barrier.
    if (!::IsWindowVisible(g_hwnd) && (g_prepareRound<0 || g_capturePaused)) { ::Sleep(20); return; }
    nextFrame=now+std::chrono::microseconds(limit>0?1000000/limit:0);
    if (g_rw != 0 && g_rh != 0) {
        // A frozen recording background does not run the blur pass that usually
        // unbinds the old RTV. Explicitly release context references before resize.
        g_ctx->OMSetRenderTargets(0,nullptr,nullptr);
        ID3D11ShaderResourceView* none[3]={};g_ctx->PSSetShaderResources(0,3,none);
        CleanupRenderTarget();
        const HRESULT resized=g_swap->ResizeBuffers(0,g_rw,g_rh,DXGI_FORMAT_UNKNOWN,0);
        if(FAILED(resized)){
            std::printf("[panel] resize retry hr=0x%08lx\n",(unsigned long)resized);
            CreateRenderTarget();return;
        }
        g_rw = g_rh = 0;
        CreateRenderTarget();
    }

    UpdateDragPosition();
    // Wait for every overlay's exclusion to reach DWM before acquiring a new
    // duplication session. A retained texture must never count as a fresh frame.

    ImGuiIO& io = ImGui::GetIO();
    RECT cr; ::GetClientRect(g_hwnd, &cr);
    RECT wr; ::GetWindowRect(g_hwnd, &wr);
    const int cw = cr.right - cr.left;
    const int ch = cr.bottom - cr.top;
    const int origin_x = wr.left - g_backdrop.originX();
    const int origin_y = wr.top - g_backdrop.originY();

    ImGui_ImplDX11_NewFrame();
    ImGui_ImplWin32_NewFrame();
    ImGui::NewFrame();
    if (EnvI("SG_TRACE_STATE",0)) {
        static float lastSize=0;
        if (lastSize!=ImGui::GetFontSize()) {
            lastSize=ImGui::GetFontSize();
            std::printf("[draw-font] physical=%.1f\n",lastSize); std::fflush(stdout);
        }
    }
    if (g_dragging) ++g_dragFrames;
    if (io.DeltaTime > 0.05f) io.DeltaTime = 1.0f / 30.0f;

    ImVec2 cursor_local = io.MousePos;
    g_renderer.BeginFrame(cw, ch, origin_x, origin_y,
                          g_backdrop.width(), g_backdrop.height(), cursor_local);

    if (g_stateDirty) ApplyLiveState();
    PanelState st;
    {
        std::lock_guard<std::mutex> lk(g_stateMutex);
        st = g_state;
    }

    Glass::Primitive panel{};
    panel.cx = cw * 0.5f;
    panel.cy = ch * 0.5f;
    panel.hw = cw * 0.5f - g_margin;
    panel.hh = ch * 0.5f - g_margin;
    panel.corner_radius = st.panelShape=="rectangle"?0.f:(st.panelShape=="pill"||(st.panelShape=="auto"&&st.mini))?std::min(cw,ch)*.5f:std::min(st.radius*g_scale,std::min(cw,ch)*.5f);
    panel.fade = 1.0f;
    panel.material = (Glass::Material)st.material;
    g_renderer.SetSubmitFade(1.0f);
    g_renderer.Submit(panel);

    g_autoText.SetMode(st.textColor);
    g_autoText.regions.clear();
    DrawPanelText(cw, ch);

    const float clear[4] = { 0.0f, 0.0f, 0.0f, 0.0f };
    g_ctx->OMSetRenderTargets(1, &g_rtv, nullptr);
    g_ctx->ClearRenderTargetView(g_rtv, clear);
    D3D11_VIEWPORT vp = {};
    vp.Width = (float)cw; vp.Height = (float)ch; vp.MaxDepth = 1.0f;
    g_ctx->RSSetViewports(1, &vp);

    g_renderer.Render(g_backdrop.heavySRV(), g_backdrop.softSRV(), g_backdrop.rawSRV());
    g_autoText.Sample(g_dev,g_ctx,g_glassSurface);
    g_ctx->OMSetRenderTargets(1,&g_rtv,nullptr);
    g_ctx->RSSetViewports(1,&vp);
    ImGui::Render();
    ImGui_ImplDX11_RenderDrawData(ImGui::GetDrawData());

    DumpBackBuffer(g_swap, g_dev, g_ctx);

    static int s_frames = 0;
    static DWORD s_lastLog = 0;
    ++s_frames;
    const DWORD nowMs = ::GetTickCount();
    if (nowMs - s_lastLog >= 2000) {
        s_lastLog = nowMs;
        std::printf("[panel] rendered=%d occluded=%d fps=%.1f\n",
                    s_frames, (int)g_occluded, io.Framerate);
        std::fflush(stdout);
    }

    HRESULT hr = g_swap->Present(1, 0);
    g_occluded = (hr == DXGI_STATUS_OCCLUDED);
}

int main(int, char**) {
    ::timeBeginPeriod(1);
    // Console subsystem on purpose (matches the liquidDX11 demo target): it gives
    // stdout for diagnostics.  Switch to WIN32_EXECUTABLE for the shipped build.
    ImGui_ImplWin32_EnableDpiAwareness();
    HINSTANCE hInst = ::GetModuleHandleW(nullptr);
    const int dpi = SystemDpi();
    const float scale = (float)dpi / 96.0f;
    g_scale = scale;
    g_mini=EnvI("SG_MINI",0)!=0;g_minPanelHeight=g_mini?32:330+(EnvI("SG_FONT_PX",14)-12)*14;
    g_outlinePill=g_mini;g_outlineRadius=EnvF("SG_RADIUS",28.f)*scale;

    const int logicalW = EnvI("SG_W", 440);
    const int logicalH = EnvI("SG_H", 560);
    const int winW = (int)(logicalW * scale + 0.5f);
    const int winH = (int)(logicalH * scale + 0.5f);
    g_dragH = (int)(EnvI("SG_DRAG_H", 46) * scale + 0.5f);
    g_radius = EnvF("SG_RADIUS", 28.0f) * scale;
    g_margin = EnvF("SG_MARGIN", 0.0f) * scale;

    WNDCLASSEXW wc = { sizeof(wc), CS_CLASSDC, WndProc, 0, 0, hInst, nullptr, nullptr,
                       nullptr, nullptr, L"StarGlassPanel", nullptr };
    wc.hIcon = ::LoadIconW(hInst,MAKEINTRESOURCEW(1));
    wc.hIconSm = wc.hIcon;
    ::RegisterClassExW(&wc);

    int screenW = ::GetSystemMetrics(SM_CXSCREEN);
    int screenH = ::GetSystemMetrics(SM_CYSCREEN);
    // SG_X/SG_Y are LOGICAL, matching Electron's coordinate system everywhere
    // (getBounds, workArea, BrowserWindow options).  HOST move is logical and
    // CMD moved reports logical too, so only this window ever sees physical
    // pixels -- mixing the two silently offsets every host-driven move at
    // non-100% scaling.
    const int logicalX = EnvI("SG_X", (int)(screenW / scale) - logicalW - 32);
    const int logicalY = EnvI("SG_Y", 64);
    const int px = (int)(logicalX * scale + 0.5f);
    const int py = (int)(logicalY * scale + 0.5f);

    // Same transparency recipe the liquidDX11 demo uses: layered popup + DWM
    // frame extension, so the swap chain's alpha decides what shows through.
    //
    // SG_LAYERED=0 drops WS_EX_LAYERED + SetLayeredWindowAttributes and keeps
    // only the DWM frame extension.  The layered combination makes DWM cache the
    // window bitmap: the back buffer updates every frame but the *screen* stays
    // frozen until something forces a recomposite (dragging the window).  See
    // PROGRESS-gpu-glass.md.
    const bool useLayered = EnvI("SG_LAYERED", 1) != 0;
    HWND hwnd = ::CreateWindowExW(useLayered ? WS_EX_LAYERED : 0, wc.lpszClassName, L"StarGlass Panel",
                                  WS_POPUP, px, py, winW, winH,
                                  nullptr, nullptr, wc.hInstance, nullptr);
    if (!hwnd) return 1;
    g_hwnd = hwnd;
    if (useLayered) ::SetLayeredWindowAttributes(hwnd, RGB(0, 0, 0), 255, LWA_ALPHA);
    MARGINS margins = { -1 };
    ::DwmExtendFrameIntoClientArea(hwnd, &margins);
    UpdatePanelOutline(hwnd);

    if (!CreateDeviceD3D(hwnd)) {
        CleanupRenderTarget();
        if (g_swap) { g_swap->Release(); g_swap = nullptr; }
        if (g_ctx)  { g_ctx->Release();  g_ctx = nullptr; }
        if (g_dev)  { g_dev->Release();  g_dev = nullptr; }
        ::DestroyWindow(hwnd);
        ::UnregisterClassW(wc.lpszClassName, wc.hInstance);
        return 1;
    }

    // SW_SHOW, never SW_SHOWDEFAULT: the host spawns us with windowsHide (to
    // suppress the console-subsystem window), which puts SW_HIDE into our
    // STARTUPINFO -- SW_SHOWDEFAULT would honour that and leave the panel
    // invisible while it happily renders frames off-screen.
    ::ShowWindow(hwnd, SW_SHOW);
    ::UpdateWindow(hwnd);

    if (!g_renderer.Init(g_dev, g_ctx)) return 1;
    Glass::g = &g_renderer;
    if(!g_backdrop.Init(g_dev,g_ctx,hwnd)){std::fprintf(stderr,"[panel] live background initialization failed\n");return 2;}

    D3D11_TEXTURE2D_DESC logoDesc={}; logoDesc.Width=kLogoSize; logoDesc.Height=kLogoSize;
    logoDesc.MipLevels=1; logoDesc.ArraySize=1; logoDesc.Format=DXGI_FORMAT_R8G8B8A8_UNORM;
    logoDesc.SampleDesc.Count=1; logoDesc.Usage=D3D11_USAGE_IMMUTABLE; logoDesc.BindFlags=D3D11_BIND_SHADER_RESOURCE;
    D3D11_SUBRESOURCE_DATA logoData={}; logoData.pSysMem=kLogoPixels; logoData.SysMemPitch=kLogoSize*4;
    ID3D11Texture2D* logoTexture=nullptr;
    if (SUCCEEDED(g_dev->CreateTexture2D(&logoDesc,&logoData,&logoTexture))) {
        g_dev->CreateShaderResourceView(logoTexture,nullptr,&g_logo); logoTexture->Release();
    }
    ApplyLook();
    g_renderer.SetRenderScale(1.0f);

    const bool topmost = EnvI("SG_TOPMOST", 1) != 0;
    if (topmost)
        ::SetWindowPos(hwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
    if (EnvI("SG_CLICKTHROUGH", 0)) {
        LONG_PTR ex = ::GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        ::SetWindowLongPtrW(hwnd, GWL_EXSTYLE, ex | WS_EX_TRANSPARENT | WS_EX_LAYERED);
    }

    IMGUI_CHECKVERSION();
    ImGui::CreateContext();
    ImGuiIO& io = ImGui::GetIO();
    io.IniFilename = nullptr;
    io.LogFilename = nullptr;
    LoadFonts((int)(EnvI("SG_FONT_PX", 14) * scale + 0.5f), EnvI("SG_FONT_BOLD", 0) != 0);
    g_fontPx = EnvI("SG_FONT_PX", 14);
    g_fontBold = EnvI("SG_FONT_BOLD", 0);
    g_resizeW = logicalW;
    g_resizeH = logicalH;
    ImGui_ImplWin32_Init(hwnd);
    ImGui_ImplDX11_Init(g_dev, g_ctx);

    // Start the host link (Electron owns GitHub fetching and settings).
    // 0 / unset keeps the panel fully standalone, which is how the visual sweeps
    // run it.
    const int ipcPort = EnvI("SG_IPC_PORT", 0);
    if (ipcPort > 0) {
        std::thread(IpcThread, ipcPort).detach();
        std::printf("[panel] IPC client -> 127.0.0.1:%d\n", ipcPort);
    }
    std::printf("[panel] window=%dx%d topmost=%d clickthrough=%d material=%d\n",
                winW, winH, (int)topmost, EnvI("SG_CLICKTHROUGH", 0),
                EnvI("SG_MATERIAL", (int)Glass::Material::Regular));
    std::fflush(stdout);

    bool done = false;
    while (!done) {
        MSG msg;
        int messages=0;
        while (messages++<32 && ::PeekMessageW(&msg, nullptr, 0U, 0U, PM_REMOVE)) {
            ::TranslateMessage(&msg);
            ::DispatchMessageW(&msg);
            if (msg.message == WM_QUIT) done = true;
        }
        if (done) break;

        HostCmd hc;
        while (!done && PopCmd(hc)) {
            switch (hc.code) {
            case 1: ::ShowWindow(hwnd, SW_SHOWNOACTIVATE); break;
            case 2: ::ShowWindow(hwnd, SW_HIDE); break;
            case 3: done = true; break;
            case 4: {
                // HOST coordinates are logical; the window wants physical pixels.
                const int mx = (int)(hc.a * g_scale + 0.5f);
                const int my = (int)(hc.b * g_scale + 0.5f);
                ::SetWindowPos(hwnd, nullptr, mx, my, 0, 0,
                               SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE);
                break;
            }
            case 5: {
                const int w = (int)(hc.a * g_scale + 0.5f);
                const int h = (int)(hc.b * g_scale + 0.5f);
                ::SetWindowPos(hwnd, nullptr, 0, 0, w, h,
                               SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE);
                break;
            }
            case 6:
                if (g_fontPx != hc.a || g_fontBold != hc.b) {
                    ReloadFonts((int)(hc.a * g_scale + 0.5f), hc.b != 0);
                    g_fontPx=hc.a; g_fontBold=hc.b;
                }
                break;
            case 7: g_captureRequested=true; break;
            case 8:
            case 9:
            case 10:
                ::SetWindowDisplayAffinity(hwnd,WDA_NONE);
                if(g_miniTip)::SetWindowDisplayAffinity(g_miniTip,WDA_NONE);
                g_capturePaused=false;g_prepareRound=-1;g_backdrop.ResumeCapture();break;
            default: break;
            }
        }
        if (done) break;

        if (g_occluded && !g_backdrop.sharedProducer() && (g_prepareRound<0 || g_capturePaused) && g_swap->Present(0, DXGI_PRESENT_TEST) == DXGI_STATUS_OCCLUDED) {
            // Diagnostics: a stalled loop here looks exactly like "the glass does
            // not follow the desktop" from the outside.
            static int s_skipped = 0;
            if (++s_skipped % 100 == 1)
                std::printf("[panel] render SKIPPED (seen occluded) count=%d\n", s_skipped);
            std::fflush(stdout);
            ::Sleep(10);
            continue;
        }
        g_occluded = false;

        RenderFrame();
    }

    ::timeEndPeriod(1);
    if(g_miniTip) {::DestroyWindow(g_miniTip);g_miniTip=nullptr;}
    g_backdrop.Shutdown();
    g_autoText.Shutdown();
    if (g_logo) { g_logo->Release(); g_logo=nullptr; }
    g_renderer.Shutdown();
    ImGui_ImplDX11_Shutdown();
    ImGui_ImplWin32_Shutdown();
    ImGui::DestroyContext();
    CleanupRenderTarget();
    if (g_swap) { g_swap->Release(); g_swap = nullptr; }
    if (g_ctx)  { g_ctx->Release();  g_ctx = nullptr; }
    if (g_dev)  { g_dev->Release();  g_dev = nullptr; }
    ::DestroyWindow(hwnd);
    ::UnregisterClassW(wc.lpszClassName, wc.hInstance);
    return 0;
}
