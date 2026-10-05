#pragma once
// Reconstruct the background from independent GPU window frames. The panel is
// never a capture source, so its HWND remains visible to screenshots and video.
#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Graphics.Capture.h>
#include <winrt/Windows.Graphics.DirectX.h>
#include <winrt/Windows.Graphics.DirectX.Direct3D11.h>
#include <windows.graphics.capture.interop.h>
#include <windows.graphics.directx.direct3d11.interop.h>
#include <wrl/client.h>
#include <dwmapi.h>
#include <wincodec.h>
#include <shobjidl.h>
#include <map>
#include <memory>
#include <vector>
#include <string>

namespace Glass {
class LiveDesktop {
    template<class T> using Ptr=Microsoft::WRL::ComPtr<T>;
    using Pool=winrt::Windows::Graphics::Capture::Direct3D11CaptureFramePool;
    using Session=winrt::Windows::Graphics::Capture::GraphicsCaptureSession;
    using Item=winrt::Windows::Graphics::Capture::GraphicsCaptureItem;
    using Device=winrt::Windows::Graphics::DirectX::Direct3D11::IDirect3DDevice;
    static constexpr auto Format=winrt::Windows::Graphics::DirectX::DirectXPixelFormat::B8G8R8A8UIntNormalized;
    struct Source {
        HWND hwnd=nullptr; Pool pool{nullptr}; Session session{nullptr};
        Ptr<ID3D11Texture2D> texture; Ptr<ID3D11ShaderResourceView> srv;
        winrt::Windows::Graphics::SizeInt32 size{};
        RECT bounds{}; bool ready=false; UINT textureW=0,textureH=0;
        ~Source(){try{if(session)session.Close();if(pool)pool.Close();}catch(...){} }
    };
    ID3D11Device* dev_=nullptr; ID3D11DeviceContext* ctx_=nullptr; HWND panel_=nullptr;
    Device device_{nullptr};
    std::map<HWND,std::unique_ptr<Source>> sources_;
    std::vector<HWND> order_; std::vector<RECT> panels_;
    Ptr<ID3D11Texture2D> output_,wallpaper_;
    Ptr<ID3D11RenderTargetView> rtv_; Ptr<ID3D11ShaderResourceView> wallpaperSrv_;
    Ptr<ID3D11VertexShader> vs_; Ptr<ID3D11PixelShader> ps_;
    Ptr<ID3D11Buffer> constants_; Ptr<ID3D11SamplerState> sampler_;
    Ptr<ID3D11BlendState> blend_; Ptr<ID3D11RasterizerState> raster_;
    Ptr<ID3D11DepthStencilState> depth_; Ptr<IDesktopWallpaper> desktop_;
    RECT monitor_{}; DWORD enumerated_=0,wallpaperChecked_=0,produced_=0,interval_=8;
    std::wstring wallpaperPath_; FILETIME wallpaperTime_{};
    UINT imageW_=0,imageH_=0; DESKTOP_WALLPAPER_POSITION position_=DWPOS_FILL;
    COLORREF desktopColor_=RGB(0,0,0);
    static bool PanelWindow(HWND h){wchar_t cls[80]={};::GetClassNameW(h,cls,80);return std::wcscmp(cls,L"StarGlassPanel")==0;}
    struct Layer {float alpha=1;COLORREF key=0;bool keyed=false;};
    static Layer WindowLayer(HWND h){
        Layer layer;COLORREF key=0;BYTE alpha=255;DWORD flags=0;
        if((::GetWindowLongPtrW(h,GWL_EXSTYLE)&WS_EX_LAYERED)&&::GetLayeredWindowAttributes(h,&key,&alpha,&flags)){
            if(flags&LWA_ALPHA)layer.alpha=alpha/255.f;
            if(flags&LWA_COLORKEY){layer.key=key;layer.keyed=true;}
        }
        return layer;
    }
    static bool Bounds(HWND h,RECT& r){
        if(!::IsWindowVisible(h)||::IsIconic(h))return false;
        DWORD cloaked=0;::DwmGetWindowAttribute(h,DWMWA_CLOAKED,&cloaked,sizeof(cloaked));if(cloaked)return false;
        if(FAILED(::DwmGetWindowAttribute(h,DWMWA_EXTENDED_FRAME_BOUNDS,&r,sizeof(r))))::GetWindowRect(h,&r);
        return r.right>r.left&&r.bottom>r.top;
    }
    static BOOL CALLBACK FindPanels(HWND h,LPARAM data){auto self=(LiveDesktop*)data;RECT r;if(PanelWindow(h)&&Bounds(h,r))self->panels_.push_back(r);return TRUE;}
    static BOOL CALLBACK FindSources(HWND h,LPARAM data){
        auto self=(LiveDesktop*)data;RECT r;
        // A fully transparent HWND can still yield an opaque WGC bitmap.
        if(PanelWindow(h)||!Bounds(h,r)||WindowLayer(h).alpha<=0)return TRUE;
        wchar_t cls[80]={};::GetClassNameW(h,cls,80);
        if(std::wcscmp(cls,L"tooltips_class32")==0)return TRUE;
        RECT overlap;if(!::IntersectRect(&overlap,&r,&self->monitor_))return TRUE;
        bool needed=std::wcscmp(cls,L"Progman")==0||std::wcscmp(cls,L"WorkerW")==0;
        for(auto p:self->panels_){::InflateRect(&p,96,96);if(::IntersectRect(&overlap,&r,&p)){needed=true;break;}}
        if(needed)self->order_.push_back(h);
        return TRUE;
    }
    void AddSource(HWND h){
        try{
            Item item{nullptr};auto interop=winrt::get_activation_factory<Item,IGraphicsCaptureItemInterop>();
            winrt::check_hresult(interop->CreateForWindow(h,winrt::guid_of<Item>(),winrt::put_abi(item)));
            auto source=std::make_unique<Source>();source->hwnd=h;source->size=item.Size();
            if(source->size.Width<=0||source->size.Height<=0)return;
            source->pool=Pool::CreateFreeThreaded(device_,Format,2,source->size);
            source->session=source->pool.CreateCaptureSession(item);
            try{source->session.IsCursorCaptureEnabled(false);source->session.IsBorderRequired(false);}catch(...){}
            source->session.StartCapture();sources_.emplace(h,std::move(source));
            char trace[8]={};if(::GetEnvironmentVariableA("SG_TRACE_STATE",trace,sizeof(trace))){
                wchar_t cls[80]={};RECT r={};::GetClassNameW(h,cls,80);::GetWindowRect(h,&r);
                std::printf("[live-desktop] source class=%ls bounds=%ld,%ld,%ld,%ld style=0x%08lx ex=0x%08lx\n",cls,r.left,r.top,r.right,r.bottom,(unsigned long)::GetWindowLongPtrW(h,GWL_STYLE),(unsigned long)::GetWindowLongPtrW(h,GWL_EXSTYLE));std::fflush(stdout);
            }
        }catch(winrt::hresult_error const& e){std::printf("[live-desktop] window source unavailable hr=0x%08lx\n",(unsigned long)e.code().value);}
    }
    void Reconcile(){
        panels_.clear();::EnumWindows(FindPanels,(LPARAM)this);
        if(panels_.empty()){RECT r;::GetWindowRect(panel_,&r);panels_.push_back(r);}
        order_.clear();::EnumWindows(FindSources,(LPARAM)this);
        for(auto it=sources_.begin();it!=sources_.end();){if(std::find(order_.begin(),order_.end(),it->first)==order_.end())it=sources_.erase(it);else ++it;}
        // EnumWindows gives front-to-back order; composition draws back-to-front.
        std::reverse(order_.begin(),order_.end());
        for(HWND h:order_)if(!sources_.count(h))AddSource(h);
    }
    void UpdateSource(Source& source){
        try{
            for(int i=0;i<2;++i){
                auto frame=source.pool.TryGetNextFrame();if(!frame)break;
                const auto size=frame.ContentSize();
                if(size.Width<=0||size.Height<=0){frame.Close();continue;}
                auto access=frame.Surface().as<Windows::Graphics::DirectX::Direct3D11::IDirect3DDxgiInterfaceAccess>();
                Ptr<ID3D11Texture2D> texture;winrt::check_hresult(access->GetInterface(IID_PPV_ARGS(&texture)));
                D3D11_TEXTURE2D_DESC desc{};texture->GetDesc(&desc);
                const UINT w=std::min((UINT)size.Width,desc.Width),h=std::min((UINT)size.Height,desc.Height);
                if(!source.texture||source.textureW!=w||source.textureH!=h){
                    source.srv.Reset();source.texture.Reset();desc.Width=w;desc.Height=h;desc.BindFlags=D3D11_BIND_SHADER_RESOURCE;desc.MiscFlags=0;desc.Usage=D3D11_USAGE_DEFAULT;desc.CPUAccessFlags=0;
                    winrt::check_hresult(dev_->CreateTexture2D(&desc,nullptr,&source.texture));
                    winrt::check_hresult(dev_->CreateShaderResourceView(source.texture.Get(),nullptr,&source.srv));
                    source.textureW=w;source.textureH=h;
                }
                const D3D11_BOX box{0,0,0,w,h,1};ctx_->CopySubresourceRegion(source.texture.Get(),0,0,0,0,texture.Get(),0,&box);
                source.ready=true;frame.Close();
                if(source.size.Width!=size.Width||source.size.Height!=size.Height){source.pool.Recreate(device_,Format,2,size);}
                source.size={size.Width,size.Height};
            }
        }catch(...){source.ready=false;}
    }
    void Wallpaper(){
        if(!desktop_)return;
        std::wstring path;UINT count=0;desktop_->GetMonitorDevicePathCount(&count);
        desktop_->GetPosition(&position_);desktop_->GetBackgroundColor(&desktopColor_);
        for(UINT i=0;i<count;++i){
            LPWSTR id=nullptr,file=nullptr;RECT r{};if(FAILED(desktop_->GetMonitorDevicePathAt(i,&id)))continue;
            desktop_->GetMonitorRECT(id,&r);
            if(::EqualRect(&r,&monitor_)&&SUCCEEDED(desktop_->GetWallpaper(id,&file))&&file)path=file;
            ::CoTaskMemFree(file);::CoTaskMemFree(id);
        }
        WIN32_FILE_ATTRIBUTE_DATA attrs{};::GetFileAttributesExW(path.c_str(),GetFileExInfoStandard,&attrs);
        if(path==wallpaperPath_&&::CompareFileTime(&attrs.ftLastWriteTime,&wallpaperTime_)==0)return;
        wallpaperPath_=path;wallpaperTime_=attrs.ftLastWriteTime;wallpaper_.Reset();wallpaperSrv_.Reset();
        if(path.empty())return;
        Ptr<IWICImagingFactory> factory;Ptr<IWICBitmapDecoder> decoder;Ptr<IWICBitmapFrameDecode> frame;Ptr<IWICFormatConverter> converter;
        if(FAILED(::CoCreateInstance(CLSID_WICImagingFactory,nullptr,CLSCTX_INPROC_SERVER,IID_PPV_ARGS(&factory)))||
           FAILED(factory->CreateDecoderFromFilename(path.c_str(),nullptr,GENERIC_READ,WICDecodeMetadataCacheOnLoad,&decoder))||
           FAILED(decoder->GetFrame(0,&frame))||FAILED(factory->CreateFormatConverter(&converter))||
           FAILED(converter->Initialize(frame.Get(),GUID_WICPixelFormat32bppPBGRA,WICBitmapDitherTypeNone,nullptr,0,WICBitmapPaletteTypeCustom)))return;
        converter->GetSize(&imageW_,&imageH_);if(!imageW_||!imageH_||imageW_>16384||imageH_>16384)return;
        std::vector<unsigned char> pixels((size_t)imageW_*imageH_*4);
        if(FAILED(converter->CopyPixels(nullptr,imageW_*4,(UINT)pixels.size(),pixels.data())))return;
        D3D11_TEXTURE2D_DESC desc{};desc.Width=imageW_;desc.Height=imageH_;desc.MipLevels=desc.ArraySize=1;desc.Format=DXGI_FORMAT_B8G8R8A8_UNORM;desc.SampleDesc.Count=1;desc.Usage=D3D11_USAGE_IMMUTABLE;desc.BindFlags=D3D11_BIND_SHADER_RESOURCE;
        const D3D11_SUBRESOURCE_DATA initial{pixels.data(),imageW_*4,0};
        if(SUCCEEDED(dev_->CreateTexture2D(&desc,&initial,&wallpaper_)))dev_->CreateShaderResourceView(wallpaper_.Get(),nullptr,&wallpaperSrv_);
    }
    void Draw(ID3D11ShaderResourceView* srv,float x,float y,float w,float h,Layer layer){
        if(!srv||w<=0||h<=0)return;
        D3D11_MAPPED_SUBRESOURCE map{};if(FAILED(ctx_->Map(constants_.Get(),0,D3D11_MAP_WRITE_DISCARD,0,&map)))return;
        const float ow=(float)(monitor_.right-monitor_.left),oh=(float)(monitor_.bottom-monitor_.top);
        float data[12]={x/ow*2-1,1-y/oh*2,w/ow*2,-h/oh*2,
            GetRValue(layer.key)/255.f,GetGValue(layer.key)/255.f,GetBValue(layer.key)/255.f,layer.keyed?1.f:0.f,
            layer.alpha,0,0,0};std::memcpy(map.pData,data,sizeof(data));ctx_->Unmap(constants_.Get(),0);
        ID3D11Buffer* cb=constants_.Get();ctx_->VSSetConstantBuffers(0,1,&cb);ctx_->PSSetConstantBuffers(0,1,&cb);ctx_->PSSetShaderResources(0,1,&srv);ctx_->Draw(6,0);
    }
public:
    bool Init(ID3D11Device* dev,ID3D11DeviceContext* ctx,HWND hwnd){
        dev_=dev;ctx_=ctx;panel_=hwnd;
        try{
            winrt::init_apartment(winrt::apartment_type::single_threaded);
            if(!Session::IsSupported())return false;
            Ptr<IDXGIDevice> dxgi;winrt::check_hresult(dev_->QueryInterface(IID_PPV_ARGS(&dxgi)));
            winrt::com_ptr<IInspectable> inspectable;winrt::check_hresult(CreateDirect3D11DeviceFromDXGIDevice(dxgi.Get(),inspectable.put()));device_=inspectable.as<Device>();
            const char* shader=R"(cbuffer Region:register(b0){float4 rect;float4 colorKey;float4 layer;} struct V{float4 p:SV_POSITION;float2 uv:TEXCOORD0;};
V VS(uint id:SV_VertexID){float2 uv[6]={float2(0,0),float2(1,0),float2(0,1),float2(0,1),float2(1,0),float2(1,1)};V v;v.uv=uv[id];v.p=float4(rect.xy+v.uv*rect.zw,0,1);return v;}
Texture2D image:register(t0);SamplerState smp:register(s0);
float4 Keyed(int2 p){float4 c=image.Load(int3(p,0));return all(abs(c.rgb-colorKey.rgb)<0.5/255.0)?float4(0,0,0,0):c;}
float4 PS(V v):SV_TARGET{
    float4 c=image.Sample(smp,v.uv);
    if(colorKey.a>0){uint w,h;image.GetDimensions(w,h);float2 p=v.uv*float2(w,h)-0.5;int2 i=(int2)floor(p);float2 t=frac(p);int2 hi=int2(w-1,h-1);
        c=lerp(lerp(Keyed(clamp(i,int2(0,0),hi)),Keyed(clamp(i+int2(1,0),int2(0,0),hi)),t.x),lerp(Keyed(clamp(i+int2(0,1),int2(0,0),hi)),Keyed(clamp(i+int2(1,1),int2(0,0),hi)),t.x),t.y);}
    return c*layer.x;
})";
            Ptr<ID3DBlob> vb,pb;winrt::check_hresult(D3DCompile(shader,std::strlen(shader),nullptr,nullptr,nullptr,"VS","vs_5_0",0,0,&vb,nullptr));winrt::check_hresult(D3DCompile(shader,std::strlen(shader),nullptr,nullptr,nullptr,"PS","ps_5_0",0,0,&pb,nullptr));
            winrt::check_hresult(dev_->CreateVertexShader(vb->GetBufferPointer(),vb->GetBufferSize(),nullptr,&vs_));winrt::check_hresult(dev_->CreatePixelShader(pb->GetBufferPointer(),pb->GetBufferSize(),nullptr,&ps_));
            D3D11_BUFFER_DESC bd{};bd.ByteWidth=48;bd.Usage=D3D11_USAGE_DYNAMIC;bd.BindFlags=D3D11_BIND_CONSTANT_BUFFER;bd.CPUAccessFlags=D3D11_CPU_ACCESS_WRITE;winrt::check_hresult(dev_->CreateBuffer(&bd,nullptr,&constants_));
            D3D11_SAMPLER_DESC sd{};sd.Filter=D3D11_FILTER_MIN_MAG_MIP_LINEAR;sd.AddressU=sd.AddressV=sd.AddressW=D3D11_TEXTURE_ADDRESS_CLAMP;dev_->CreateSamplerState(&sd,&sampler_);
            D3D11_BLEND_DESC blend{};auto& b=blend.RenderTarget[0];b.BlendEnable=TRUE;b.SrcBlend=D3D11_BLEND_ONE;b.DestBlend=D3D11_BLEND_INV_SRC_ALPHA;b.BlendOp=D3D11_BLEND_OP_ADD;b.SrcBlendAlpha=D3D11_BLEND_ONE;b.DestBlendAlpha=D3D11_BLEND_INV_SRC_ALPHA;b.BlendOpAlpha=D3D11_BLEND_OP_ADD;b.RenderTargetWriteMask=D3D11_COLOR_WRITE_ENABLE_ALL;dev_->CreateBlendState(&blend,&blend_);
            D3D11_RASTERIZER_DESC rs{};rs.FillMode=D3D11_FILL_SOLID;rs.CullMode=D3D11_CULL_NONE;rs.DepthClipEnable=TRUE;dev_->CreateRasterizerState(&rs,&raster_);
            D3D11_DEPTH_STENCIL_DESC ds{};ds.DepthEnable=FALSE;ds.StencilEnable=FALSE;dev_->CreateDepthStencilState(&ds,&depth_);
            ::CoCreateInstance(CLSID_DesktopWallpaper,nullptr,CLSCTX_ALL,IID_PPV_ARGS(&desktop_));
            std::printf("[live-desktop] independent GPU window capture ready; screenshots enabled\n");std::fflush(stdout);return true;
        }catch(winrt::hresult_error const& e){std::printf("[live-desktop] init failed hr=0x%08lx\n",(unsigned long)e.code().value);return false;}
    }
    ID3D11Texture2D* Capture(){
        // Independent of the main pane's drawing cap, but never a busy GPU loop.
        const DWORD now=::GetTickCount();if(produced_&&now-produced_<interval_)return nullptr;produced_=now;
        MONITORINFOEXW info{};info.cbSize=sizeof(info);if(!::GetMonitorInfoW(::MonitorFromWindow(panel_,MONITOR_DEFAULTTONEAREST),reinterpret_cast<MONITORINFO*>(&info)))return nullptr;
        const bool resized=!output_||!::EqualRect(&monitor_,&info.rcMonitor);
        if(resized){
            monitor_=info.rcMonitor;rtv_.Reset();output_.Reset();
            D3D11_TEXTURE2D_DESC d{};d.Width=monitor_.right-monitor_.left;d.Height=monitor_.bottom-monitor_.top;d.MipLevels=d.ArraySize=1;d.Format=DXGI_FORMAT_B8G8R8A8_UNORM;d.SampleDesc.Count=1;d.BindFlags=D3D11_BIND_RENDER_TARGET|D3D11_BIND_SHADER_RESOURCE;
            if(FAILED(dev_->CreateTexture2D(&d,nullptr,&output_))||FAILED(dev_->CreateRenderTargetView(output_.Get(),nullptr,&rtv_)))return nullptr;
        }
        if(resized||!enumerated_||now-enumerated_>=50){Reconcile();enumerated_=now;}
        if(resized||!wallpaperChecked_||now-wallpaperChecked_>=2000){
            DEVMODEW mode{};mode.dmSize=sizeof(mode);
            if(::EnumDisplaySettingsW(info.szDevice,ENUM_CURRENT_SETTINGS,&mode)&&mode.dmDisplayFrequency>=30)interval_=std::max(1u,1000u/std::min(360u,(unsigned)mode.dmDisplayFrequency));
            Wallpaper();wallpaperChecked_=now;
        }
        for(auto& p:sources_)UpdateSource(*p.second);
        ID3D11ShaderResourceView* none[3]={};ctx_->PSSetShaderResources(0,3,none);
        ID3D11RenderTargetView* target=rtv_.Get();ctx_->OMSetRenderTargets(1,&target,nullptr);
        const float clear[]={GetRValue(desktopColor_)/255.f,GetGValue(desktopColor_)/255.f,GetBValue(desktopColor_)/255.f,1};ctx_->ClearRenderTargetView(target,clear);
        const float width=(float)(monitor_.right-monitor_.left),height=(float)(monitor_.bottom-monitor_.top);
        D3D11_VIEWPORT vp{};vp.Width=width;vp.Height=height;vp.MaxDepth=1;ctx_->RSSetViewports(1,&vp);
        ctx_->IASetInputLayout(nullptr);ctx_->IASetPrimitiveTopology(D3D11_PRIMITIVE_TOPOLOGY_TRIANGLELIST);ctx_->VSSetShader(vs_.Get(),nullptr,0);ctx_->PSSetShader(ps_.Get(),nullptr,0);
        ctx_->OMSetBlendState(blend_.Get(),nullptr,0xffffffff);ctx_->OMSetDepthStencilState(depth_.Get(),0);ctx_->RSSetState(raster_.Get());ID3D11SamplerState* sampler=sampler_.Get();ctx_->PSSetSamplers(0,1,&sampler);
        if(wallpaperSrv_){
            if(position_==DWPOS_TILE){for(float y=0;y<height;y+=imageH_)for(float x=0;x<width;x+=imageW_)Draw(wallpaperSrv_.Get(),x,y,(float)imageW_,(float)imageH_,Layer{});}
            else{float w=width,h=height;if(position_==DWPOS_CENTER){w=(float)imageW_;h=(float)imageH_;}else if(position_==DWPOS_FILL||position_==DWPOS_FIT){const float scale=position_==DWPOS_FIT?std::min(width/imageW_,height/imageH_):std::max(width/imageW_,height/imageH_);w=imageW_*scale;h=imageH_*scale;}Draw(wallpaperSrv_.Get(),(width-w)*.5f,(height-h)*.5f,w,h,Layer{});}
        }
        for(HWND hwnd:order_){auto it=sources_.find(hwnd);if(it==sources_.end())continue;auto& s=*it->second;RECT r{};if(!s.ready||!Bounds(hwnd,r))continue;Draw(s.srv.Get(),(float)(r.left-monitor_.left),(float)(r.top-monitor_.top),(float)(r.right-r.left),(float)(r.bottom-r.top),WindowLayer(hwnd));}
        ctx_->PSSetShaderResources(0,3,none);ctx_->OMSetRenderTargets(0,nullptr,nullptr);return output_.Get();
    }
    const RECT& bounds()const{return monitor_;}
};
}
