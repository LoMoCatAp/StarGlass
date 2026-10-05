#pragma once
#include <d3dcompiler.h>
#include <vector>
#include <cstring>

// Sample the finished glass, before glyphs. GPU reduction produces only four
// floats; a query + DO_NOT_WAIT keeps readback out of the render critical path.
struct AutoTextRegion { float x, y, w, h; };
class AutoTextSampler {
    struct Constants { float info[4]; AutoTextRegion regions[32]; };
    struct Slot { ID3D11Texture2D* staging=nullptr; ID3D11Query* query=nullptr; bool pending=false; };
    ID3D11VertexShader* vs=nullptr;
    ID3D11PixelShader* ps=nullptr;
    ID3D11Buffer* cb=nullptr;
    ID3D11Texture2D* result=nullptr;
    ID3D11RenderTargetView* target=nullptr;
    ID3D11RasterizerState* raster=nullptr;
    Slot slots[2];
    bool attempted=false, ready=false, initialized=false, light=false, candidate=false;
    double lastSubmit=-1, candidateSince=-1, lastSwitch=-1;
    float smoothDark=0, smoothLight=0;
    float visualFrom=0, visualTarget=0;
    double transitionStart=-1;
    std::string mode;
    static double Time() { return std::chrono::duration<double>(std::chrono::steady_clock::now().time_since_epoch()).count(); }
    void TransitionTo(bool toLight) {
        const float next=toLight?1.f:0.f;
        if(next==visualTarget) return;
        // Start from the visible color so reversing midway never jumps.
        visualFrom=LightMix();visualTarget=next;transitionStart=Time();
        if(EnvI("SG_TRACE_STATE",0)) {
            std::printf("[text-transition] start from=%.3f to=%.3f durationMs=250\n",visualFrom,visualTarget);std::fflush(stdout);
        }
    }
    template<typename T> static void Release(T*& p) { if(p) {p->Release();p=nullptr;} }
    bool Init(ID3D11Device* dev) {
        attempted=true;
        static const char* vertex=R"HLSL(
float4 main(uint id:SV_VertexID):SV_POSITION {
    float2 p=float2((id<<1)&2,id&2);
    return float4(p*float2(2,-2)+float2(-1,1),0,1);
})HLSL";
        static const char* pixel=R"HLSL(
Texture2D<float4> glass:register(t0);
cbuffer Sampling:register(b0) {float4 info;float4 rects[32];};
float linearChannel(float c) {return c<=.04045?c/12.92:pow((c+.055)/1.055,2.4);}
float luminance(float3 c) {
    return dot(float3(linearChannel(c.r),linearChannel(c.g),linearChannel(c.b)),float3(.2126,.7152,.0722));
}
float contrast(float a,float b) {return (max(a,b)+.05)/(min(a,b)+.05);}
float4 main():SV_TARGET {
    uint width,height;glass.GetDimensions(width,height);
    float dark=luminance(float3(27,49,52)/255),light=luminance(float3(247,251,250)/255);
    float sum=0,sd=0,sl=0,total=0;
    [loop] for(int i=0;i<(int)info.x;i++) {
        float4 r=rects[i];float weight=sqrt(max(1,r.z*r.w));
        [unroll] for(int y=0;y<2;y++) [unroll] for(int x=0;x<6;x++) {
            int2 p=clamp(int2(r.xy+r.zw*float2((x+.5)/6,(y+.5)/2)),int2(0,0),int2(width-1,height-1));
            float4 c=glass.Load(int3(p,0));
            if(c.a<.95) continue; // Ignore the transparent rounded corners.
            float l=luminance(saturate(c.rgb/c.a));
            sum+=l*weight;sd+=log(contrast(l,dark))*weight;sl+=log(contrast(l,light))*weight;total+=weight;
        }
    }
    return total>0?float4(sum/total,exp(sd/total),exp(sl/total),total):float4(0,0,0,0);
})HLSL";
        ID3DBlob* blob=nullptr; ID3DBlob* errors=nullptr;
        auto compile=[&](const char* source,const char* profile) {
            HRESULT hr=D3DCompile(source,std::strlen(source),nullptr,nullptr,nullptr,"main",profile,D3DCOMPILE_OPTIMIZATION_LEVEL3,0,&blob,&errors);
            if(FAILED(hr)&&errors) std::fprintf(stderr,"[auto-text] shader: %s\n",(char*)errors->GetBufferPointer());
            Release(errors);return SUCCEEDED(hr);
        };
        if(!compile(vertex,"vs_4_0")) return false;
        HRESULT hr=dev->CreateVertexShader(blob->GetBufferPointer(),blob->GetBufferSize(),nullptr,&vs);Release(blob);
        if(FAILED(hr)||!compile(pixel,"ps_4_0")) return false;
        hr=dev->CreatePixelShader(blob->GetBufferPointer(),blob->GetBufferSize(),nullptr,&ps);Release(blob);
        if(FAILED(hr)) return false;
        D3D11_BUFFER_DESC b={};b.ByteWidth=sizeof(Constants);b.Usage=D3D11_USAGE_DEFAULT;b.BindFlags=D3D11_BIND_CONSTANT_BUFFER;
        if(FAILED(dev->CreateBuffer(&b,nullptr,&cb))) return false;
        D3D11_TEXTURE2D_DESC t={};t.Width=t.Height=t.MipLevels=t.ArraySize=1;t.Format=DXGI_FORMAT_R32G32B32A32_FLOAT;
        t.SampleDesc.Count=1;t.Usage=D3D11_USAGE_DEFAULT;t.BindFlags=D3D11_BIND_RENDER_TARGET;
        if(FAILED(dev->CreateTexture2D(&t,nullptr,&result))||FAILED(dev->CreateRenderTargetView(result,nullptr,&target))) return false;
        t.Usage=D3D11_USAGE_STAGING;t.BindFlags=0;t.CPUAccessFlags=D3D11_CPU_ACCESS_READ;
        D3D11_QUERY_DESC q={D3D11_QUERY_EVENT,0};
        for(auto& s:slots) if(FAILED(dev->CreateTexture2D(&t,nullptr,&s.staging))||FAILED(dev->CreateQuery(&q,&s.query))) return false;
        D3D11_RASTERIZER_DESC r={};r.FillMode=D3D11_FILL_SOLID;r.CullMode=D3D11_CULL_NONE;r.DepthClipEnable=TRUE;
        if(FAILED(dev->CreateRasterizerState(&r,&raster))) return false;
        std::printf("[auto-text] GPU sampler ready (16-byte asynchronous readback, 8Hz)\n");std::fflush(stdout);
        ready=true;return true;
    }
    void Accept(const float* stats,double now) {
        if(!std::isfinite(stats[0])||stats[3]<=0||stats[1]<=0||stats[2]<=0) return;
        bool changed=false;
        if(!initialized) {
            smoothDark=stats[1];smoothLight=stats[2];light=smoothLight>smoothDark;
            initialized=true;lastSwitch=now;changed=true;
        } else {
            smoothDark+=.4f*(stats[1]-smoothDark);smoothLight+=.4f*(stats[2]-smoothLight);
            const bool wantLight=light ? !(smoothDark>smoothLight*1.3f) : smoothLight>smoothDark*1.3f;
            if(wantLight==light) candidateSince=-1;
            else if(candidateSince<0||candidate!=wantLight) {candidate=wantLight;candidateSince=now;}
            else if(now-candidateSince>=.35&&now-lastSwitch>=.65) {
                light=wantLight;lastSwitch=now;candidateSince=-1;changed=true;
            }
        }
        if(changed) TransitionTo(light);
        if(changed&&EnvI("SG_TRACE_STATE",0)) {
            std::printf("[auto-text] mode=auto color=%s luminance=%.3f darkContrast=%.2f lightContrast=%.2f\n",light?"light":"dark",stats[0],stats[1],stats[2]);std::fflush(stdout);
        }
    }
public:
    std::vector<AutoTextRegion> regions;
    void SetMode(const std::string& requested) {
        if(requested==mode) return;
        mode=requested;initialized=false;candidateSince=-1;lastSubmit=-1;
        if(mode!="auto") TransitionTo(mode=="light");
        for(auto& s:slots) s.pending=false;
        if(EnvI("SG_TRACE_STATE",0)) {std::printf("[auto-text] mode=%s\n",mode.c_str());std::fflush(stdout);}
    }
    float LightMix() {
        if(transitionStart<0) return visualTarget;
        const float t=std::clamp((float)((Time()-transitionStart)/.25),0.f,1.f);
        if(t>=1.f) {
            transitionStart=-1;
            if(EnvI("SG_TRACE_STATE",0)) {std::printf("[text-transition] end mix=%.3f\n",visualTarget);std::fflush(stdout);}
            return visualTarget;
        }
        return visualFrom+(visualTarget-visualFrom)*t*t*(3.f-2.f*t);
    }
    void Sample(ID3D11Device* dev,ID3D11DeviceContext* ctx,ID3D11ShaderResourceView* surface) {
        if(mode!="auto"||!surface||regions.empty()) return;
        if(!attempted&&!Init(dev)) {std::fprintf(stderr,"[auto-text] GPU sampling unavailable; retaining last text color\n");}
        if(!ready) return;
        const double now=Time();
        for(auto& s:slots) if(s.pending) {
            BOOL done=FALSE;
            if(ctx->GetData(s.query,&done,sizeof(done),D3D11_ASYNC_GETDATA_DONOTFLUSH)!=S_OK||!done) continue;
            D3D11_MAPPED_SUBRESOURCE m={};
            if(SUCCEEDED(ctx->Map(s.staging,0,D3D11_MAP_READ,D3D11_MAP_FLAG_DO_NOT_WAIT,&m))) {
                float stats[4];std::memcpy(stats,m.pData,sizeof(stats));ctx->Unmap(s.staging,0);
                s.pending=false;Accept(stats,now);
            }
        }
        if(now-lastSubmit<.125) return;
        Slot* freeSlot=nullptr;for(auto& s:slots) if(!s.pending) {freeSlot=&s;break;}
        if(!freeSlot) return;
        Constants c={};const size_t count=std::min(regions.size(),size_t(32));c.info[0]=(float)count;
        std::copy_n(regions.begin(),count,c.regions);ctx->UpdateSubresource(cb,0,nullptr,&c,0,0);
        ctx->OMSetRenderTargets(1,&target,nullptr);
        D3D11_VIEWPORT vp={};vp.Width=vp.Height=vp.MaxDepth=1;ctx->RSSetViewports(1,&vp);ctx->RSSetState(raster);
        const float blend[4]={};ctx->OMSetBlendState(nullptr,blend,0xffffffff);ctx->OMSetDepthStencilState(nullptr,0);
        ctx->IASetInputLayout(nullptr);ctx->IASetPrimitiveTopology(D3D11_PRIMITIVE_TOPOLOGY_TRIANGLELIST);
        ctx->VSSetShader(vs,nullptr,0);ctx->PSSetShader(ps,nullptr,0);ctx->GSSetShader(nullptr,nullptr,0);
        ctx->PSSetConstantBuffers(0,1,&cb);ctx->PSSetShaderResources(0,1,&surface);ctx->Draw(3,0);
        ID3D11ShaderResourceView* none=nullptr;ctx->PSSetShaderResources(0,1,&none);
        ctx->CopyResource(freeSlot->staging,result);ctx->End(freeSlot->query);freeSlot->pending=true;lastSubmit=now;
    }
    void Shutdown() {
        Release(vs);Release(ps);Release(cb);Release(target);Release(result);Release(raster);
        for(auto& s:slots) {Release(s.staging);Release(s.query);s.pending=false;}
    }
};
