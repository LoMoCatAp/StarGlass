#pragma once
#include <d3d11.h>
#include <dxgi.h>
#include <windows.h>
#include <cstdint>
#include <string>
#include <cstring>

namespace Glass {
// Only handles and frame metadata cross CPU memory. Desktop pixels remain in
// D3D11 textures; each consumer copies under the same keyed GPU mutex.
class SharedDesktop {
    struct Header {
        std::uint32_t magic=0; int epoch=0;
        std::uint64_t generation=0,serial=0,handle=0;
        int x=0,y=0,w=0,h=0;
    };
    ID3D11Device* dev_=nullptr;
    ID3D11DeviceContext* ctx_=nullptr;
    ID3D11Texture2D* texture_=nullptr;
    IDXGIKeyedMutex* gpu_mutex_=nullptr;
    HANDLE mapping_=nullptr,metadata_mutex_=nullptr;
    Header* header_=nullptr;
    std::wstring name_;
    bool consumer_=false,locked_=false;
    std::uint64_t generation_=0,seen_=0,input_serial_=0;
    int published_epoch_=0;
    static constexpr std::uint32_t MAGIC=0x53474750;
    bool Connect() {
        if(name_.empty())return false;
        if(!metadata_mutex_)metadata_mutex_=::CreateMutexW(nullptr,FALSE,(name_+L"_meta").c_str());
        if(!mapping_)mapping_=consumer_?::OpenFileMappingW(FILE_MAP_READ,FALSE,name_.c_str()):
            ::CreateFileMappingW(INVALID_HANDLE_VALUE,nullptr,PAGE_READWRITE,0,sizeof(Header),name_.c_str());
        if(mapping_&&!header_)header_=static_cast<Header*>(::MapViewOfFile(mapping_,consumer_?FILE_MAP_READ:FILE_MAP_ALL_ACCESS,0,0,sizeof(Header)));
        return header_&&metadata_mutex_;
    }
    bool LockMetadata() {
        const DWORD result=::WaitForSingleObject(metadata_mutex_,0);
        return result==WAIT_OBJECT_0||result==WAIT_ABANDONED;
    }
    void ReleaseTexture() {
        if(locked_&&gpu_mutex_)gpu_mutex_->ReleaseSync(0);locked_=false;
        if(gpu_mutex_){gpu_mutex_->Release();gpu_mutex_=nullptr;}
        if(texture_){texture_->Release();texture_=nullptr;}
    }
public:
    struct Frame { ID3D11Texture2D* texture=nullptr;int x=0,y=0,w=0,h=0,epoch=0; };
    void Init(ID3D11Device* dev,ID3D11DeviceContext* ctx) {
        dev_=dev;ctx_=ctx;
        char name[192]={},role[24]={};
        ::GetEnvironmentVariableA("SG_GPU_SHARED_NAME",name,sizeof(name));
        ::GetEnvironmentVariableA("SG_GPU_SHARED_ROLE",role,sizeof(role));
        name_=std::wstring(name,name+std::strlen(name));consumer_=std::strcmp(role,"consumer")==0;
        if(Connect()&&!consumer_&&LockMetadata()){*header_=Header{};::ReleaseMutex(metadata_mutex_);}
        std::printf("[shared-gpu] role=%s enabled=%d\n",consumer_?"consumer":"producer",!name_.empty());std::fflush(stdout);
    }
    bool consumer()const{return consumer_;}
    bool producer()const{return !consumer_&&!name_.empty();}
    bool published(std::uint64_t serial,int epoch)const{return !producer()||(input_serial_==serial&&published_epoch_==epoch);}
    bool Publish(ID3D11Texture2D* source,int x,int y,std::uint64_t serial,int epoch) {
        if(!producer()||!source||!Connect())return false;
        if(input_serial_==serial&&published_epoch_==epoch)return true;
        D3D11_TEXTURE2D_DESC desc={};source->GetDesc(&desc);
        D3D11_TEXTURE2D_DESC existing={};if(texture_)texture_->GetDesc(&existing);
        if(!texture_||existing.Width!=desc.Width||existing.Height!=desc.Height||existing.Format!=desc.Format){
            ReleaseTexture();desc.MipLevels=1;desc.ArraySize=1;desc.Usage=D3D11_USAGE_DEFAULT;
            desc.CPUAccessFlags=0;desc.MiscFlags=D3D11_RESOURCE_MISC_SHARED_KEYEDMUTEX;
            desc.BindFlags=D3D11_BIND_SHADER_RESOURCE|D3D11_BIND_RENDER_TARGET;
            if(FAILED(dev_->CreateTexture2D(&desc,nullptr,&texture_)))return false;
            if(FAILED(texture_->QueryInterface(__uuidof(IDXGIKeyedMutex),(void**)&gpu_mutex_))){ReleaseTexture();return false;}
            ++generation_;
        }
        if(gpu_mutex_->AcquireSync(0,0)!=S_OK)return false;
        ctx_->CopyResource(texture_,source);ctx_->Flush();gpu_mutex_->ReleaseSync(0);
        IDXGIResource* resource=nullptr;HANDLE handle=nullptr;
        if(FAILED(texture_->QueryInterface(__uuidof(IDXGIResource),(void**)&resource)))return false;
        const HRESULT result=resource->GetSharedHandle(&handle);resource->Release();
        if(FAILED(result)||!LockMetadata())return false;
        Header next;next.magic=MAGIC;next.epoch=epoch;next.generation=generation_;next.serial=header_->serial+1;
        next.handle=reinterpret_cast<std::uintptr_t>(handle);next.x=x;next.y=y;next.w=(int)desc.Width;next.h=(int)desc.Height;
        *header_=next;::ReleaseMutex(metadata_mutex_);input_serial_=serial;published_epoch_=epoch;return true;
    }
    bool Read(Frame& frame,int expected_epoch) {
        if(!consumer_||!Connect()||!LockMetadata())return false;
        const Header info=*header_;::ReleaseMutex(metadata_mutex_);
        if(info.magic!=MAGIC||!info.handle||!info.serial||info.w<=0||info.h<=0)return false;
        if(expected_epoch&&info.epoch!=expected_epoch)return false;
        if(info.serial==seen_&&info.generation==generation_)return false;
        if(info.generation!=generation_||!texture_){
            ReleaseTexture();
            if(FAILED(dev_->OpenSharedResource(reinterpret_cast<HANDLE>((std::uintptr_t)info.handle),__uuidof(ID3D11Texture2D),(void**)&texture_)))return false;
            if(FAILED(texture_->QueryInterface(__uuidof(IDXGIKeyedMutex),(void**)&gpu_mutex_))){ReleaseTexture();return false;}
            generation_=info.generation;
        }
        if(gpu_mutex_->AcquireSync(0,0)!=S_OK)return false;
        locked_=true;seen_=info.serial;frame={texture_,info.x,info.y,info.w,info.h,info.epoch};return true;
    }
    void FinishRead(){if(locked_){ctx_->Flush();gpu_mutex_->ReleaseSync(0);locked_=false;}}
    void Shutdown(){
        if(!consumer_&&header_&&metadata_mutex_&&LockMetadata()){*header_=Header{};::ReleaseMutex(metadata_mutex_);}
        ReleaseTexture();if(header_){::UnmapViewOfFile(header_);header_=nullptr;}
        if(mapping_){::CloseHandle(mapping_);mapping_=nullptr;}
        if(metadata_mutex_){::CloseHandle(metadata_mutex_);metadata_mutex_=nullptr;}
    }
};
}
