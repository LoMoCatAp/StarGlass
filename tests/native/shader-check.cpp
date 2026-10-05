// Compile production shaders without creating a device or desktop window.
#include <d3dcompiler.h>
#include <cstdio>
#include <cstring>
#include "shaders.h"
int main(){
 const char* entries[]={"VS_Glass","PS_Glass","VSFull","PSDown","PSUp"};
 for(int i=0;i<5;++i){
  const char* source=i<2?Glass::kGlassHLSL:Glass::kBlurHLSL;ID3DBlob* result=nullptr;ID3DBlob* errors=nullptr;
  const HRESULT status=D3DCompile(source,std::strlen(source),entries[i],nullptr,nullptr,entries[i],i==0||i==2?"vs_5_0":"ps_5_0",0,0,&result,&errors);
  if(FAILED(status)){if(errors)std::fwrite(errors->GetBufferPointer(),1,errors->GetBufferSize(),stderr);if(errors)errors->Release();return 1;}
  std::printf("shader=%s bytes=%zu passed=true\n",entries[i],result->GetBufferSize());result->Release();if(errors)errors->Release();
 }
 return 0;
}
