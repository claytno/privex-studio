// Test-only helper: inspects/captures ONLY the exact synthetic host's Privex preview child.
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Text;
using System.Web.Script.Serialization;
class WindowProbe {
 delegate bool EnumProc(IntPtr hwnd, IntPtr data);
 [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr hwnd, EnumProc callback, IntPtr data);
 [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int count);
 [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
 [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hwnd, out Rect rect);
 [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint process);
 [DllImport("user32.dll")] static extern bool PrintWindow(IntPtr hwnd, IntPtr dc, uint flags);
 struct Rect { public int left,top,right,bottom; }
 static int Main(string[] args) {
  try {
   IntPtr parent = new IntPtr(long.Parse(args[0])), preview=IntPtr.Zero;
   EnumChildWindows(parent, delegate(IntPtr child, IntPtr data) { var text=new StringBuilder(200); GetWindowText(child,text,text.Capacity); if(text.ToString()=="Privex preview") { preview=child; return false; } return true; },IntPtr.Zero);
   if(preview==IntPtr.Zero) { Console.WriteLine("{\"exists\":false}"); return 0; }
   Rect bounds; GetWindowRect(preview,out bounds); uint pid; GetWindowThreadProcessId(preview,out pid);
   int width=bounds.right-bounds.left,height=bounds.bottom-bounds.top; bool printed=false; int red=0,green=0,blue=0;
   if(args.Length>1 && IsWindowVisible(preview) && width>0 && height>0 && width<8192 && height<8192) {
    using(var bitmap=new Bitmap(width,height,PixelFormat.Format32bppArgb)) {
     using(var graphics=Graphics.FromImage(bitmap)) { var dc=graphics.GetHdc(); try { printed=PrintWindow(preview,dc,2); } finally { graphics.ReleaseHdc(dc); } }
     bitmap.Save(args[1],ImageFormat.Png);
     for(int y=0;y<height;y+=4) for(int x=0;x<width;x+=4) {var color=bitmap.GetPixel(x,y);if(color.R>170&&color.G<90&&color.B<90)red++;if(color.G>170&&color.R<90&&color.B<90)green++;if(color.B>170&&color.R<90&&color.G<90)blue++;}
    }
   }
   Console.WriteLine(new JavaScriptSerializer().Serialize(new {exists=true,visible=IsWindowVisible(preview),width=width,height=height,processId=pid,printed=printed,redSamples=red,greenSamples=green,blueSamples=blue})); return 0;
  } catch(Exception e) {Console.Error.WriteLine(e.Message);return 1;}
 }
}
