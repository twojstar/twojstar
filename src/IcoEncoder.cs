using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Linq;
using System.Text;

namespace Travny.PaintDotNetIco;

internal static class IcoEncoder
{
    public static void Write(Stream output, Bitmap source, IEnumerable<int> requestedSizes, bool preserveAspectRatio, Action<double>? progressCallback = null)
    {
        ArgumentNullException.ThrowIfNull(output);
        ArgumentNullException.ThrowIfNull(source);

        int[] sizes = requestedSizes
            .Where(size => size is >= 1 and <= 256)
            .Distinct()
            .OrderBy(size => size)
            .ToArray();

        if (sizes.Length == 0)
        {
            throw new InvalidOperationException("Select at least one icon size before saving.");
        }

        progressCallback?.Invoke(0);
        var frames = new List<IconFrame>(sizes.Length);
        for (int index = 0; index < sizes.Length; index++)
        {
            int size = sizes[index];
            using Bitmap resized = Resize(source, size, preserveAspectRatio);
            using var png = new MemoryStream();
            resized.Save(png, ImageFormat.Png);
            frames.Add(new IconFrame(size, png.ToArray()));
            progressCallback?.Invoke(((index + 1) * 90.0) / sizes.Length);
        }

        using var writer = new BinaryWriter(output, Encoding.UTF8, leaveOpen: true);
        writer.Write((ushort)0); // reserved
        writer.Write((ushort)1); // ICO
        writer.Write(checked((ushort)frames.Count));

        int dataOffset = 6 + (16 * frames.Count);
        foreach (IconFrame frame in frames)
        {
            writer.Write(frame.Size == 256 ? (byte)0 : checked((byte)frame.Size));
            writer.Write(frame.Size == 256 ? (byte)0 : checked((byte)frame.Size));
            writer.Write((byte)0); // palette size
            writer.Write((byte)0); // reserved
            writer.Write((ushort)1); // color planes
            writer.Write((ushort)32); // bits per pixel
            writer.Write(frame.Data.Length);
            writer.Write(dataOffset);
            dataOffset = checked(dataOffset + frame.Data.Length);
        }

        foreach (IconFrame frame in frames)
        {
            writer.Write(frame.Data);
        }

        writer.Flush();
        progressCallback?.Invoke(100);
    }

    private static Bitmap Resize(Bitmap source, int size, bool preserveAspectRatio)
    {
        var target = new Bitmap(size, size, PixelFormat.Format32bppArgb);
        using Graphics graphics = Graphics.FromImage(target);
        graphics.Clear(Color.Transparent);
        graphics.CompositingMode = CompositingMode.SourceCopy;
        graphics.CompositingQuality = CompositingQuality.HighQuality;
        graphics.InterpolationMode = InterpolationMode.HighQualityBicubic;
        graphics.SmoothingMode = SmoothingMode.HighQuality;
        graphics.PixelOffsetMode = PixelOffsetMode.HighQuality;

        Rectangle destination = preserveAspectRatio
            ? GetContainedRectangle(source.Width, source.Height, size)
            : new Rectangle(0, 0, size, size);

        using var attributes = new ImageAttributes();
        attributes.SetWrapMode(WrapMode.TileFlipXY);
        graphics.DrawImage(
            source,
            destination,
            0,
            0,
            source.Width,
            source.Height,
            GraphicsUnit.Pixel,
            attributes);

        return target;
    }

    private static Rectangle GetContainedRectangle(int sourceWidth, int sourceHeight, int size)
    {
        double scale = Math.Min((double)size / sourceWidth, (double)size / sourceHeight);
        int width = Math.Max(1, (int)Math.Round(sourceWidth * scale));
        int height = Math.Max(1, (int)Math.Round(sourceHeight * scale));
        int x = (size - width) / 2;
        int y = (size - height) / 2;
        return new Rectangle(x, y, width, height);
    }

    private sealed record IconFrame(int Size, byte[] Data);
}
