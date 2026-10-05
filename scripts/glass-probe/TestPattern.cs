// StarGlass verification aid: a DPI-aware full-screen test pattern window.
//
// Purpose: the liquid glass panel samples the desktop, so judging sharpness /
// refraction / dispersion needs a *static, known* background.  The desktop is
// otherwise whatever the user happens to have open, which makes frame-to-frame
// comparison meaningless.
//
// It is deliberately ASCII-only: csc.exe reads BOM-less sources as ANSI, so any
// non-ASCII literal here would be mis-decoded (same trap as the .ps1 scripts).
//
// Build:
//   %WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe /nologo /target:winexe
//     /platform:x64 /optimize+ /r:System.Drawing.dll /r:System.Windows.Forms.dll
//     /out:TestPattern.exe TestPattern.cs
//
// Run:  TestPattern.exe [outFile]      Esc closes it.
// It always writes its physical window bounds to outFile (default
// %TEMP%\glass-probe.txt) so the caller does not have to guess DPI scaling.

using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Drawing.Text;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows.Forms;

static class Native
{
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
}

sealed class PatternForm : Form
{
    public PatternForm(Rectangle bounds)
    {
        FormBorderStyle = FormBorderStyle.None;
        StartPosition = FormStartPosition.Manual;
        Bounds = bounds;
        ShowInTaskbar = false;
        TopMost = false;
        DoubleBuffered = true;
        KeyPreview = true;
        BackColor = Color.Black;
    }

    protected override void OnKeyDown(KeyEventArgs e)
    {
        if (e.KeyCode == Keys.Escape) Close();
        base.OnKeyDown(e);
    }

    // The panel can sit anywhere, so the pattern is tiled to cover the whole
    // desktop instead of living in one corner.
    const int TileW = 1280;
    const int TileH = 1100;

    protected override void OnPaint(PaintEventArgs e)
    {
        Graphics g = e.Graphics;
        int W = ClientSize.Width, H = ClientSize.Height;
        g.Clear(Color.FromArgb(18, 18, 22));
        g.InterpolationMode = InterpolationMode.NearestNeighbor;
        g.PixelOffsetMode = PixelOffsetMode.Half;
        // Base layer: fine checkerboard across the whole desktop. The tiles below
        // paint over it, but their rows leave gaps, and the panel must never
        // sample a flat area or the sharpness comparison is meaningless.
        using (Bitmap baseBmp = MakeChecker(W, H, 2))
            g.DrawImageUnscaled(baseBmp, 0, 0);
        for (int ty = 0; ty < H; ty += TileH)
        {
            for (int tx = 0; tx < W; tx += TileW)
            {
                GraphicsState st = g.Save();
                g.SetClip(new Rectangle(tx, ty, TileW, TileH));
                g.TranslateTransform(tx, ty);
                DrawTile(g, TileW, TileH);
                g.Restore(st);
            }
        }
    }

    void DrawTile(Graphics g, int W, int H)
    {
        using (SolidBrush bg = new SolidBrush(Color.FromArgb(18, 18, 22)))
            g.FillRectangle(bg, 0, 0, W, H);

        int y = 16;

        // ---- fine text at many sizes: the primary blur indicator ----------
        DrawLabel(g, "TEXT RAMPS  (blur shows first on the small sizes)", 16, ref y);
        int[] sizes = { 8, 9, 10, 11, 12, 14, 16, 20, 26, 34 };
        foreach (int s in sizes)
        {
            using (Font f = new Font("Consolas", s, FontStyle.Regular, GraphicsUnit.Pixel))
            {
                g.TextRenderingHint = TextRenderingHint.SingleBitPerPixelGridFit;
                g.DrawString(s.ToString("00") + "px  The quick brown fox 0123456789 |#|#| l1I O0", f,
                             Brushes.White, 16, y);
                y += s + 6;
            }
        }

        // ---- exact checkerboards and line pairs ---------------------------
        y += 10;
        DrawLabel(g, "PIXEL GRIDS  (1px checker should survive only if nothing blurs)", 16, ref y);
        int gy = y;
        int gx = 16;
        int[] cells = { 1, 2, 3, 4, 6, 8 };
        foreach (int c in cells)
        {
            int size = 128;
            DrawLabel(g, c + "px checker", gx, ref gy);
            g.DrawImage(MakeChecker(size, size, c), gx, gy);
            DrawLabel(g, c + "px vlines", gx, ref gy);
            g.DrawImage(MakeVLines(size, 48, c), gx, gy);
            gx += size + 24;
            gy = y + 18;
        }
        y = gy + 48 + 24;

        // ---- colour bars for dispersion / saturation ----------------------
        DrawLabel(g, "COLOUR BARS  (edge dispersion tints these fringes)", 16, ref y);
        Color[] bars = { Color.Black, Color.Red, Color.Green, Color.Blue,
                         Color.Cyan, Color.Magenta, Color.Yellow, Color.White };
        int bw = 140, bh = 90;
        for (int i = 0; i < bars.Length; i++)
        {
            using (SolidBrush b = new SolidBrush(bars[i]))
                g.FillRectangle(b, 16 + i * bw, y, bw, bh);
        }
        y += bh + 20;

        // ---- hard edges + concentric rings for refraction ------------------
        DrawLabel(g, "HARD EDGES / RINGS  (refraction bends these at the rim)", 16, ref y);
        using (SolidBrush w = new SolidBrush(Color.White))
            g.FillRectangle(w, 16, y, 420, 200);
        using (SolidBrush k = new SolidBrush(Color.Black))
        {
            Point[] tri = { new Point(456, y + 200), new Point(640, y), new Point(824, y + 200) };
            g.FillPolygon(k, tri);
        }
        // radial spokes: strong high-frequency target
        PointF centre = new PointF(1050, y + 100);
        using (Pen pen = new Pen(Color.White, 2f))
            for (int i = 0; i < 72; i++)
            {
                double a = i * Math.PI / 36.0;
                g.DrawLine(pen, centre,
                           new PointF(centre.X + (float)(Math.Cos(a) * 96),
                                      centre.Y + (float)(Math.Sin(a) * 96)));
            }
        using (Pen pen = new Pen(Color.FromArgb(255, 255, 90), 1f))
            for (int r = 12; r <= 96; r += 12)
                g.DrawEllipse(pen, centre.X - r, centre.Y - r, r * 2, r * 2);
        y += 220;

        // ---- high-frequency noise field (blur kills it instantly) ---------
        DrawLabel(g, "NOISE FIELD", 16, ref y);
        g.DrawImage(MakeNoise(760, Math.Min(140, H - y - 20)), 16, y);

        using (SolidBrush note = new SolidBrush(Color.FromArgb(160, 160, 170)))
        using (Font f = new Font("Consolas", 13, FontStyle.Regular, GraphicsUnit.Pixel))
        {
            g.TextRenderingHint = TextRenderingHint.SingleBitPerPixelGridFit;
            g.DrawString("static controlled background - press Esc to close", f, note,
                         W - 340, H - 26);
        }
    }

    static void DrawLabel(Graphics g, string text, int x, ref int y)
    {
        using (Font f = new Font("Consolas", 12, FontStyle.Bold, GraphicsUnit.Pixel))
        {
            g.TextRenderingHint = TextRenderingHint.SingleBitPerPixelGridFit;
            g.DrawString(text, f, Brushes.Orange, x, y);
        }
        y += 18;
    }

    // Exact 1:1 bitmaps built through LockBits so GDI+ never resamples them.
    static Bitmap MakeChecker(int w, int h, int cell)
    {
        Bitmap bmp = new Bitmap(w, h, PixelFormat.Format24bppRgb);
        BitmapData d = bmp.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.WriteOnly,
                                    PixelFormat.Format24bppRgb);
        try
        {
            unsafe
            {
                byte* p = (byte*)d.Scan0;
                for (int y = 0; y < h; y++)
                {
                    byte* row = p + y * d.Stride;
                    for (int x = 0; x < w; x++)
                    {
                        bool on = (((x / cell) + (y / cell)) & 1) == 0;
                        byte v = (byte)(on ? 255 : 0);
                        row[x * 3 + 0] = v; row[x * 3 + 1] = v; row[x * 3 + 2] = v;
                    }
                }
            }
        }
        finally { bmp.UnlockBits(d); }
        return bmp;
    }

    static Bitmap MakeVLines(int w, int h, int period)
    {
        Bitmap bmp = new Bitmap(w, h, PixelFormat.Format24bppRgb);
        BitmapData d = bmp.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.WriteOnly,
                                    PixelFormat.Format24bppRgb);
        try
        {
            unsafe
            {
                byte* p = (byte*)d.Scan0;
                for (int y = 0; y < h; y++)
                {
                    byte* row = p + y * d.Stride;
                    for (int x = 0; x < w; x++)
                    {
                        byte v = (byte)(((x / period) & 1) == 0 ? 255 : 0);
                        row[x * 3 + 0] = v; row[x * 3 + 1] = v; row[x * 3 + 2] = v;
                    }
                }
            }
        }
        finally { bmp.UnlockBits(d); }
        return bmp;
    }

    static Bitmap MakeNoise(int w, int h)
    {
        if (h < 1) h = 1;
        Bitmap bmp = new Bitmap(w, h, PixelFormat.Format24bppRgb);
        BitmapData d = bmp.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.WriteOnly,
                                    PixelFormat.Format24bppRgb);
        try
        {
            unsafe
            {
                Random rng = new Random(12345);
                byte* p = (byte*)d.Scan0;
                for (int y = 0; y < h; y++)
                {
                    byte* row = p + y * d.Stride;
                    for (int x = 0; x < w; x++)
                    {
                        byte v = (byte)rng.Next(0, 256);
                        row[x * 3 + 0] = v; row[x * 3 + 1] = v; row[x * 3 + 2] = v;
                    }
                }
            }
        }
        finally { bmp.UnlockBits(d); }
        return bmp;
    }
}

static class Program
{
    [STAThread]
    static void Main(string[] args)
    {
        Native.SetProcessDPIAware();
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);

        string outFile = (args.Length > 0) ? args[0]
                        : Path.Combine(Path.GetTempPath(), "glass-probe.txt");

        Rectangle b = Screen.PrimaryScreen.Bounds;
        try
        {
            File.WriteAllText(outFile,
                string.Format("primary={0},{1},{2},{3}\n", b.X, b.Y, b.Width, b.Height));
        }
        catch { }

        Application.Run(new PatternForm(b));
    }
}
