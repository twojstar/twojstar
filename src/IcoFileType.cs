using PaintDotNet;
using PaintDotNet.PropertySystem;
using PaintDotNet.Rendering;
using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;

namespace Travny.PaintDotNetIco;

[PluginSupportInfo(typeof(PluginSupportInfo))]
public sealed class IcoFileType : PropertyBasedFileType
{
    public IcoFileType()
        : base(
            "Windows Icon",
            new FileTypeOptions
            {
                LoadExtensions = new[] { ".ico" },
                SaveExtensions = new[] { ".ico" },
                SupportsCancellation = true,
                SupportsLayers = false
            })
    {
    }

    public override PropertyCollection OnCreateSavePropertyCollection()
    {
        var properties = new List<Property>
        {
            new BooleanProperty(IcoExportOptions.PreserveAspectRatio, true)
        };

        foreach ((string name, int _) in IcoExportOptions.Sizes)
        {
            properties.Add(new BooleanProperty(name, true));
        }

        return new PropertyCollection(properties);
    }

    protected override Document OnLoad(Stream input)
    {
        using IcoDocument icon = IcoDecoder.Read(input);
        IReadOnlyList<IcoFrame> frames = icon.Frames;

        if (frames.Count == 1)
        {
            return CreateDocument(icon, frames, skipInvalid: false);
        }

        int defaultIndex = icon.FindDefaultFrameIndex();
        FrameSelectionChoice choice = FrameSelectionDialog.ShowOnStaThread(frames, defaultIndex);

        if (choice.OpenAll)
        {
            return CreateDocument(icon, frames, skipInvalid: true);
        }

        return CreateDocument(
            icon,
            new[] { frames[choice.SelectedIndex] },
            skipInvalid: false);
    }

    private static Document CreateDocument(
        IcoDocument icon,
        IReadOnlyList<IcoFrame> frames,
        bool skipInvalid)
    {
        var usableFrames = new List<IcoFrame>(frames.Count);
        foreach (IcoFrame frame in frames)
        {
            if (!skipInvalid || icon.CanDecode(frame))
            {
                usableFrames.Add(frame);
            }
        }

        if (usableFrames.Count == 0)
        {
            throw new InvalidDataException("ICO contains no decodable images.");
        }

        int width = 1;
        int height = 1;
        foreach (IcoFrame frame in usableFrames)
        {
            width = Math.Max(width, frame.Width);
            height = Math.Max(height, frame.Height);
        }

        var document = new Document(width, height);
        try
        {
            foreach (IcoFrame frame in usableFrames)
            {
                using Bitmap bitmap = icon.Decode(frame);
                if (bitmap.Width != frame.Width || bitmap.Height != frame.Height)
                {
                    throw new InvalidDataException("ICO frame dimensions do not match its directory entry.");
                }

                var layer = new BitmapLayer(width, height)
                {
                    Name = FrameName(frame)
                };

                using Bitmap target = layer.Surface.CreateAliasedBitmap();
                using Graphics graphics = Graphics.FromImage(target);
                graphics.CompositingMode = System.Drawing.Drawing2D.CompositingMode.SourceCopy;
                graphics.Clear(Color.Transparent);
                graphics.DrawImageUnscaled(bitmap, 0, 0);
                document.Layers.Add(layer);
            }

            return document;
        }
        catch
        {
            document.Dispose();
            throw;
        }
    }

    private static string FrameName(IcoFrame frame)
    {
        string encoding = frame.IsPng ? "PNG" : "bitmap";
        return $"{frame.Width} x {frame.Height}, {frame.BitCount}-bit {encoding}";
    }

    protected override void OnSaveT(
        Document input,
        Stream output,
        PropertyBasedSaveConfigToken token,
        Surface scratchSurface,
        ProgressEventHandler progressCallback)
    {
        progressCallback(null, new ProgressEventArgs(0));
        scratchSurface.Clear();
        input.CreateRenderer().Render(scratchSurface);

        var sizes = new List<int>(IcoExportOptions.Sizes.Length);
        foreach ((string name, int size) in IcoExportOptions.Sizes)
        {
            if (Convert.ToBoolean(token.GetProperty(name)!.Value))
            {
                sizes.Add(size);
            }
        }

        if (sizes.Count == 0)
        {
            throw new InvalidOperationException("Select at least one icon size before saving.");
        }

        bool preserve = Convert.ToBoolean(token.GetProperty(IcoExportOptions.PreserveAspectRatio)!.Value);
        using Bitmap source = scratchSurface.CreateAliasedBitmap();
        IcoEncoder.Write(output, source, sizes, preserve,
            percent => progressCallback(null, new ProgressEventArgs(percent)));
    }
}
