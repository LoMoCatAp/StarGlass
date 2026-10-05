// Local region sampler. Reuses a top-down DIB and sends raw BGRA frames.
using System;
using System.IO;
using System.Diagnostics;
using System.Threading;
using System.Runtime.InteropServices;
class GlassCapture {
 [DllImport("winmm.dll")] static extern uint timeBeginPeriod(uint period);
 [DllImport("winmm.dll")] static extern uint timeEndPeriod(uint period);
 [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr value);
 [DllImport("user32.dll")] static extern IntPtr GetDC(IntPtr hwnd);
 [DllImport("user32.dll")] static extern int ReleaseDC(IntPtr hwnd,IntPtr dc);
 [DllImport("gdi32.dll")] static extern IntPtr CreateCompatibleDC(IntPtr dc);
 [DllImport("gdi32.dll")] static extern bool DeleteDC(IntPtr dc);
 [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr obj);
 [DllImport("gdi32.dll")] static extern IntPtr SelectObject(IntPtr dc,IntPtr obj);
 [DllImport("gdi32.dll")] static extern IntPtr CreateDIBSection(IntPtr dc,ref BitmapInfo info,uint usage,out IntPtr bits,IntPtr section,uint offset);
 [DllImport("gdi32.dll")] static extern bool StretchBlt(IntPtr dst,int x,int y,int w,int h,IntPtr src,int sx,int sy,int sw,int sh,uint rop);
 [DllImport("gdi32.dll")] static extern bool BitBlt(IntPtr dst,int x,int y,int w,int h,IntPtr src,int sx,int sy,uint rop);
 [DllImport("gdi32.dll")] static extern int SetStretchBltMode(IntPtr dc,int mode);
 [StructLayout(LayoutKind.Sequential)] struct BitmapInfo {public uint size;public int width,height;public ushort planes,bpp;public uint compression,imageSize;public int xppm,yppm;public uint used,important;}
 static void Main() {
  SetThreadDpiAwarenessContext(new IntPtr(-4));
  timeBeginPeriod(1);var clock=Stopwatch.StartNew();double nextFrame=0;
  IntPtr screen=GetDC(IntPtr.Zero),dc=CreateCompatibleDC(screen),bitmap=IntPtr.Zero,bits=IntPtr.Zero,old=IntPtr.Zero;
  int currentW=0,currentH=0;byte[] pixels=null;SetStretchBltMode(dc,3);
  using(var output=new BinaryWriter(Console.OpenStandardOutput())) {
   try {string line;while((line=Console.ReadLine())!=null){
    try {
     var p=Array.ConvertAll(line.Split(' '),int.Parse);if(p.Length!=7)throw new Exception();
     while(clock.Elapsed.TotalMilliseconds<nextFrame)Thread.Sleep(1);
     nextFrame=clock.Elapsed.TotalMilliseconds+1000.0/Math.Max(15,Math.Min(60,p[6]));
     int w=p[4],h=p[5];if(w<1||h<1||w>2400||h>2400||p[2]<1||p[3]<1||p[2]>8000||p[3]>8000)throw new Exception();
     if(w!=currentW||h!=currentH){
      if(bitmap!=IntPtr.Zero){SelectObject(dc,old);DeleteObject(bitmap);bitmap=IntPtr.Zero;}
      var info=new BitmapInfo{size=40,width=w,height=-h,planes=1,bpp=32};
      bitmap=CreateDIBSection(dc,ref info,0,out bits,IntPtr.Zero,0);if(bitmap==IntPtr.Zero)throw new Exception();
      old=SelectObject(dc,bitmap);pixels=new byte[w*h*4];currentW=w;currentH=h;
     }
     bool success=w==p[2]&&h==p[3]?BitBlt(dc,0,0,w,h,screen,p[0],p[1],0x00CC0020):StretchBlt(dc,0,0,w,h,screen,p[0],p[1],p[2],p[3],0x00CC0020);
     if(!success)throw new Exception();
     Marshal.Copy(bits,pixels,0,pixels.Length);output.Write(pixels.Length);output.Write(pixels);
    }catch{output.Write(0);}output.Flush();
   }}finally{if(bitmap!=IntPtr.Zero){SelectObject(dc,old);DeleteObject(bitmap);}DeleteDC(dc);ReleaseDC(IntPtr.Zero,screen);timeEndPeriod(1);}
  }
 }
}

