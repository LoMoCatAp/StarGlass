#pragma once
#include <d3d11.h>
#include <cstdint>
// Cache only the glass, before glyphs/hover controls. Never feed it to capture.
struct GlassFrameKey {
 std::uint64_t background=0;int x=0,y=0,w=0,h=0;float mouseX=0,mouseY=0;
 bool operator==(const GlassFrameKey& b)const{return background==b.background&&x==b.x&&y==b.y&&w==b.w&&h==b.h&&mouseX==b.mouseX&&mouseY==b.mouseY;}
};
class GlassFrameCache {
 ID3D11Texture2D* texture_=nullptr;GlassFrameKey key_{};bool valid_=false;
public:
 ~GlassFrameCache(){Reset();}
 void Reset(){if(texture_)texture_->Release();texture_=nullptr;valid_=false;}
 static bool CanReuse(const GlassFrameKey& saved,const GlassFrameKey& next,bool dirty,bool animated){return !dirty&&!animated&&saved==next;}
 bool Restore(ID3D11DeviceContext* ctx,ID3D11Texture2D* target,const GlassFrameKey& next,bool dirty,bool animated){
  if(!valid_||!target||!CanReuse(key_,next,dirty,animated))return false;
  ctx->CopyResource(target,texture_);return true;
 }
 void Save(ID3D11Device* dev,ID3D11DeviceContext* ctx,ID3D11Texture2D* source,const GlassFrameKey& next){
  if(!source){valid_=false;return;}
  D3D11_TEXTURE2D_DESC desc{};source->GetDesc(&desc);
  if(texture_){D3D11_TEXTURE2D_DESC old{};texture_->GetDesc(&old);if(old.Width!=desc.Width||old.Height!=desc.Height||old.Format!=desc.Format)Reset();}
  if(!texture_){desc.Usage=D3D11_USAGE_DEFAULT;desc.BindFlags=0;desc.MiscFlags=0;desc.CPUAccessFlags=0;if(FAILED(dev->CreateTexture2D(&desc,nullptr,&texture_))){valid_=false;return;}}
  ctx->CopyResource(texture_,source);key_=next;valid_=true;
 }
};
