using System;
using System.Drawing;
using System.IO;
using System.Linq;

namespace Travny.PaintDotNetIco;

internal static class Program
{
    private static void Main()
    {
        using var source = new Bitmap(32, 20);
        using (Graphics graphics = Graphics.FromImage(source))
        {
            graphics.Clear(Color.Transparent);
            graphics.FillRectangle(Brushes.DodgerBlue, 4, 3, 20, 12);
        }

        using var encoded = new MemoryStream();
        double lastProgress = -1;
        IcoEncoder.Write(encoded, source, new[] { 16, 32, 256 }, preserveAspectRatio: true,
            progress => lastProgress = progress);
        Assert(lastProgress == 100, "Encoder did not report completion.");

        encoded.Position = 0;
        using IcoDocument document = IcoDecoder.Read(encoded);
        Assert(document.Frames.Count == 3, "Unexpected frame count.");
        int[] expectedSizes = { 16, 32, 256 };
        Assert(document.Frames.Select(frame => frame.Width).SequenceEqual(expectedSizes),
            "Encoded frame widths differ from requested sizes.");
        Assert(document.FindDefaultFrameIndex() == 2, "Largest decodable frame was not selected by default.");

        foreach (IcoFrame frame in document.Frames)
        {
            Assert(document.CanDecode(frame), $"Frame {frame.Index} is not decodable.");
            using Bitmap decoded = document.Decode(frame);
            Assert(decoded.Width == frame.Width && decoded.Height == frame.Height,
                $"Frame {frame.Index} dimensions do not match its directory entry.");
        }

        using var malformed = new MemoryStream(new byte[] { 1, 0, 1, 0, 1, 0 });
        try
        {
            using IcoDocument _ = IcoDecoder.Read(malformed);
            throw new InvalidOperationException("Malformed ICO header was accepted.");
        }
        catch (InvalidDataException)
        {
        }

        Console.WriteLine("Paint.NET ICO codec smoke test passed.");
    }
    private static void Assert(bool condition, string message)
    {
        if (!condition)
        {
            throw new InvalidOperationException(message);
        }
    }
}
