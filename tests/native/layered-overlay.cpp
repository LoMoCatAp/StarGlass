// Owned fixture: exercise real Windows global alpha and color-key compositing.
// No interaction with other apps. Only this HWND is controlled through stdin.
#include <windows.h>
#include <iostream>
#include <string>
#include <thread>
static COLORREF fill=RGB(0,0,0);
static LRESULT CALLBACK Proc(HWND h,UINT m,WPARAM w,LPARAM l){
    if(m==WM_APP){
        const int mode=(int)w;fill=mode==5?RGB(30,100,180):RGB(0,0,0);
        const BYTE alpha=mode==1?128:mode==2?255:0;
        SetLayeredWindowAttributes(h,mode==4?RGB(255,0,255):RGB(0,0,0),alpha,mode>=3?LWA_COLORKEY:LWA_ALPHA);
        InvalidateRect(h,nullptr,FALSE);UpdateWindow(h);
        std::cout<<"mode="<<mode<<std::endl;return 0;
    }
    if(m==WM_PAINT){PAINTSTRUCT p;HDC dc=BeginPaint(h,&p);RECT r;GetClientRect(h,&r);HBRUSH b=CreateSolidBrush(fill);FillRect(dc,&r,b);DeleteObject(b);EndPaint(h,&p);return 0;}
    if(m==WM_CLOSE){DestroyWindow(h);return 0;}
    if(m==WM_DESTROY){PostQuitMessage(0);return 0;}
    return DefWindowProcW(h,m,w,l);
}
int main(){
    SetProcessDPIAware();WNDCLASSW cls={};cls.lpfnWndProc=Proc;cls.hInstance=GetModuleHandleW(nullptr);cls.lpszClassName=L"StarGlassTestOverlay";RegisterClassW(&cls);
    HWND h=CreateWindowExW(WS_EX_LAYERED|WS_EX_TOPMOST|WS_EX_TOOLWINDOW|WS_EX_NOACTIVATE,cls.lpszClassName,L"StarGlass capture fixture",WS_POPUP,0,0,GetSystemMetrics(SM_CXSCREEN),GetSystemMetrics(SM_CYSCREEN),nullptr,nullptr,cls.hInstance,nullptr);
    if(!h)return 1;SendMessageW(h,WM_APP,0,0);ShowWindow(h,SW_SHOWNOACTIVATE);
    std::thread([h]{std::string s;while(std::getline(std::cin,s)){if(s=="quit")break;try{PostMessageW(h,WM_APP,std::stoi(s),0);}catch(...){}}PostMessageW(h,WM_CLOSE,0,0);}).detach();
    MSG msg;while(GetMessageW(&msg,nullptr,0,0)>0){TranslateMessage(&msg);DispatchMessageW(&msg);}return 0;
}
