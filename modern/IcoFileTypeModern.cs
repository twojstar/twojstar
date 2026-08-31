using PaintDotNet;
using PaintDotNet.AppModel;
using PaintDotNet.FileTypes;
using PaintDotNet.Imaging;
using PaintDotNet.PropertySystem;
using System;
using System.Collections.Generic;
using System.Drawing;
using DrawingPixelFormat = System.Drawing.Imaging.PixelFormat;
using System.Drawing.Imaging;
using System.IO;
using System.Linq;
using System.Windows.Forms;

namespace Travny.PaintDotNetIco;

public sealed class IcoFileTypeModern : PropertyBasedFileType, IPluginSupportInfoProvider
{
    private readonly IUISynchronizationContext uiContext;
    public IcoFileTypeModern(IFileTypeHost host)
        : base(host, "Windows Icon", FileTypeOptions.Create() with
        {
            LoadExtensions = new[] { ".ico" },
            SaveExtensions = new[] { ".ico" },
            IsSavingConfigurable = true,
            SupportsSavingLayers = false,
            SupportsCancellationExceptions = true
        })
    {
        uiContext = (IUISynchronizationContext?)host.Services.GetService(typeof(IUISynchronizationContext))
            ?? throw new InvalidOperationException("Paint.NET did not provide a UI synchronization context.");
    }
    public IPluginSupportInfo GetPluginSupportInfo() => new PluginSupportInfo();

    protected override PropertyBasedFileTypeLoader OnCreatePropertyBasedLoader() =>
        new Loader(this);

    protected override PropertyBasedFileTypeSaver OnCreatePropertyBasedSaver() =>
        new Saver(this);

    private FrameSelectionChoice ShowFrameSelection(IReadOnlyList<IcoFrame> frames, int defaultIndex)
    {
        FrameSelectionChoice? choice = null;
        uiContext.Send(_ =>
        {
            using var dialog = new FrameSelectionDialog(frames, defaultIndex);
            if (dialog.ShowDialog() == DialogResult.OK)
            {
                choice = new FrameSelectionChoice(dialog.SelectedIndex, dialog.OpenAll);
            }
        }, null);

        return choice ?? throw new OperationCanceledException("ICO loading cancelled.");
    }

    private sealed class Loader : PropertyBasedFileTypeLoader
    {
        private readonly IcoFileTypeModern fileType;

        public Loader(IcoFileTypeModern fileType) : base(fileType)
        {
            this.fileType = fileType;
        }

        protected override IFileTypeDocument OnLoad(IPropertyBasedFileTypeLoadContext context)
        {
            using IcoDocument icon = IcoDecoder.Read(context.Input);
            IReadOnlyList<IcoFrame> frames = icon.Frames;
            if (frames.Count == 1)
            {
                return CreateDocument(context, icon, new[] { frames[0] });
            }

            int defaultIndex = icon.FindDefaultFrameIndex();
            FrameSelectionChoice choice = fileType.ShowFrameSelection(frames, defaultIndex);

            IReadOnlyList<IcoFrame> selected = choice.OpenAll
                ? frames.Where(icon.CanDecode).ToArray()
                : new[] { frames[choice.SelectedIndex] };
            return CreateDocument(context, icon, selected);
        }
    }
    private static IFileTypeDocument CreateDocument(
        IPropertyBasedFileTypeLoadContext context,
        IcoDocument icon,
        IReadOnlyList<IcoFrame> frames)
    {
        if (frames.Count == 0)
        {
            throw new InvalidDataException("ICO contains no decodable images.");
        }

        int width = frames.Max(frame => frame.Width);
        int height = frames.Max(frame => frame.Height);
        IFileTypeDocument<ColorBgra32> document =
            context.Factory.CreateDocumentBgra32(width, height);

        try
        {
            foreach (IcoFrame frame in frames)
            {
                using Bitmap bitmap = icon.Decode(frame);
                if (bitmap.Width != frame.Width || bitmap.Height != frame.Height)
                {
                    throw new InvalidDataException("ICO frame dimensions do not match its directory entry.");
                }

                using IFileTypeBitmapLayer<ColorBgra32> layer = document.CreateBitmapLayer();
                layer.Name = FrameName(frame);
                using IFileTypeBitmapSink<ColorBgra32> sink = layer.GetBitmap();
                CopyBitmapToSink(bitmap, sink);
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
    private static unsafe void CopyBitmapToSink(
        Bitmap source,
        IFileTypeBitmapSink<ColorBgra32> sink)
    {
        if (source.Width > sink.Size.Width || source.Height > sink.Size.Height)
        {
            throw new InvalidDataException("Decoded ICO frame exceeds the destination bitmap bounds.");
        }

        using var normalized = new Bitmap(source.Width, source.Height, DrawingPixelFormat.Format32bppArgb);
        using (Graphics graphics = Graphics.FromImage(normalized))
        {
            graphics.CompositingMode = System.Drawing.Drawing2D.CompositingMode.SourceCopy;
            graphics.Clear(Color.Transparent);
            graphics.DrawImageUnscaled(source, 0, 0);
        }

        Rectangle rect = new(0, 0, normalized.Width, normalized.Height);
        BitmapData data = normalized.LockBits(rect, ImageLockMode.ReadOnly, DrawingPixelFormat.Format32bppArgb);
        try
        {
            using IFileTypeBitmapLock<ColorBgra32> target = sink.Lock(BitmapLockOptions.Write);
            int copyBytes = normalized.Width * 4;
            for (int y = 0; y < normalized.Height; y++)
            {
                byte* src = (byte*)data.Scan0 + (y * data.Stride);
                byte* dst = (byte*)target.Buffer + (y * target.BufferStride);
                Buffer.MemoryCopy(src, dst, target.BufferStride, copyBytes);
            }
        }
        finally
        {
            normalized.UnlockBits(data);
        }
    }

    private sealed class Saver : PropertyBasedFileTypeSaver
    {
        public Saver(IcoFileTypeModern fileType) : base(fileType)
        {
        }
        protected override PropertyCollection OnCreateDefaultSaveProperties()
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

        protected override void OnSave(IPropertyBasedFileTypeSaveContext context)
        {
            var sizes = new List<int>(IcoExportOptions.Sizes.Length);
            foreach ((string name, int size) in IcoExportOptions.Sizes)
            {
                if (Convert.ToBoolean(context.Options.GetProperty(name)!.Value))
                {
                    sizes.Add(size);
                }
            }

            if (sizes.Count == 0)
            {
                throw new InvalidOperationException("Select at least one icon size before saving.");
            }

            bool preserve = Convert.ToBoolean(
                context.Options.GetProperty(IcoExportOptions.PreserveAspectRatio)!.Value);
            using IFileTypeCompositeBitmap<ColorBgra32> composite =
                context.Document.GetCompositeBitmapBgra32();
            using Bitmap source = CopyCompositeToBitmap(composite);
            IcoEncoder.Write(context.Output, source, sizes, preserve,
                percent => context.ProgressCallback(null, new ProgressEventArgs(percent)));
        }
    }
    private static unsafe Bitmap CopyCompositeToBitmap(
        IFileTypeCompositeBitmap<ColorBgra32> source)
    {
        int width = source.Size.Width;
        int height = source.Size.Height;
        var bitmap = new Bitmap(width, height, DrawingPixelFormat.Format32bppArgb);
        Rectangle rect = new(0, 0, width, height);
        BitmapData data = bitmap.LockBits(rect, ImageLockMode.WriteOnly, DrawingPixelFormat.Format32bppArgb);

        try
        {
            uint bufferSize = checked((uint)(Math.Abs(data.Stride) * height));
            source.CopyPixels((void*)data.Scan0, data.Stride, bufferSize, null);
        }
        catch
        {
            bitmap.UnlockBits(data);
            bitmap.Dispose();
            throw;
        }

        bitmap.UnlockBits(data);
        return bitmap;
    }
}
