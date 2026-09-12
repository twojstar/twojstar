using PaintDotNet;
using PaintDotNet.Effects;
using PaintDotNet.Imaging;
using PaintDotNet.PropertySystem;
using PaintDotNet.Rendering;
using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Threading;

namespace Travny.PaintDotNet.AI;

[PluginSupportInfo(typeof(PluginSupportInfo))]
public sealed class AiRestoreEffect : PropertyBasedBitmapEffect
{
    // realesr-general-x4v3 has 34 stride-1 3x3 convolutions, so an output pixel
    // has a strict 34-pixel low-resolution receptive-field radius.
    private const int ContextRadius = 34;
    private const int CoreTileSize = 128;
    private const int MaxCachedTiles = 8;
    private const string ModelFileName = "realesr-general-x4v3.onnx";

    private static readonly Lazy<RealEsrganSession> SharedSession =
        new(() => new RealEsrganSession(FindModelPath()), LazyThreadSafetyMode.ExecutionAndPublication);

    private readonly ConcurrentDictionary<TileKey, Lazy<RestoredTile>> tileCache = new();
    private readonly ConcurrentQueue<KeyValuePair<TileKey, Lazy<RestoredTile>>> tileOrder = new();
    private IBitmapSource<ColorBgra32>? sourceBitmap;
    private int strength;

    public AiRestoreEffect()
        : base(
            "AI Restore",
            "Travny Paint.NET AI",
            BitmapEffectOptions.Create() with { IsConfigurable = true })
    {
    }

    private enum PropertyNames
    {
        Strength
    }

    protected override PropertyCollection OnCreatePropertyCollection()
    {
        return new PropertyCollection(new List<Property>
        {
            new Int32Property(PropertyNames.Strength, 85, 0, 100)
        });
    }

    protected override void OnInitializeRenderInfo(IBitmapEffectRenderInfo renderInfo)
    {
        renderInfo.OutputPixelFormat = PixelFormats.Bgra32;
        sourceBitmap = Environment.GetSourceBitmap<ColorBgra32>();
        tileCache.Clear();
        while (tileOrder.TryDequeue(out _))
        {
        }

        base.OnInitializeRenderInfo(renderInfo);
    }

    protected override void OnSetToken(PropertyBasedEffectConfigToken? newToken)
    {
        strength = newToken!.GetProperty<Int32Property>(PropertyNames.Strength)!.Value;
        base.OnSetToken(newToken);
    }

    protected override void OnRender(IBitmapEffectOutput output)
    {
        using IBitmapLock<ColorBgra32> outputLock = output.Lock<ColorBgra32>();
        RegionPtr<ColorBgra32> outputRegion = outputLock.AsRegionPtr();

        if (strength == 0)
        {
            sourceBitmap!.CopyPixels(outputLock, output.Bounds.Location);
            return;
        }

        if (IsCancelRequested)
        {
            return;
        }

        using IBitmap<ColorBgra32> sourceTile = sourceBitmap!
            .CreateClipper(output.Bounds, BitmapExtendMode.Clamp)
            .ToBitmap();
        using IBitmapLock<ColorBgra32> sourceLock = sourceTile.Lock(BitmapLockOptions.Read);
        RegionPtr<ColorBgra32> sourceRegion = sourceLock.AsRegionPtr();
        float amount = strength / 100f;

        int outputLeft = output.Bounds.X;
        int outputTop = output.Bounds.Y;
        int outputRight = checked(outputLeft + outputRegion.Width);
        int outputBottom = checked(outputTop + outputRegion.Height);
        TileKey firstKey = TileKey.FromPixel(outputLeft, outputTop);

        try
        {
            // Traverse by restoration tile, not by scanline. This guarantees that an
            // output region evaluates each expensive AI tile at most once even when
            // the bounded cross-region cache is smaller than the image width.
            for (int tileY = firstKey.Y; tileY < outputBottom; tileY += CoreTileSize)
            {
                for (int tileX = firstKey.X; tileX < outputRight; tileX += CoreTileSize)
                {
                    if (IsCancelRequested)
                    {
                        return;
                    }

                    TileKey key = new(tileX, tileY);
                    RestoredTile restored = GetRestoredTile(key);
                    int startX = Math.Max(outputLeft, tileX);
                    int endX = Math.Min(outputRight, checked(tileX + CoreTileSize));
                    int startY = Math.Max(outputTop, tileY);
                    int endY = Math.Min(outputBottom, checked(tileY + CoreTileSize));

                    for (int globalY = startY; globalY < endY; globalY++)
                    {
                        if (IsCancelRequested)
                        {
                            return;
                        }

                        int y = globalY - outputTop;
                        int restoredY = globalY - tileY;
                        for (int globalX = startX; globalX < endX; globalX++)
                        {
                            int x = globalX - outputLeft;
                            int restoredX = globalX - tileX;
                            ColorBgra32 original = sourceRegion[x, y];

                            outputRegion[x, y] = ColorBgra32.FromBgra(
                                Blend(original.B, restored.Get(restoredX, restoredY, 2), amount),
                                Blend(original.G, restored.Get(restoredX, restoredY, 1), amount),
                                Blend(original.R, restored.Get(restoredX, restoredY, 0), amount),
                                original.A);
                        }
                    }
                }
            }
        }
        catch (OperationCanceledException) when (IsCancelRequested)
        {
            return;
        }
    }

    private RestoredTile GetRestoredTile(TileKey key)
    {
        Lazy<RestoredTile> actual;
        if (!tileCache.TryGetValue(key, out actual!))
        {
            var candidate = new Lazy<RestoredTile>(
                () => RestoreTile(key),
                LazyThreadSafetyMode.ExecutionAndPublication);
            actual = tileCache.GetOrAdd(key, candidate);

            if (ReferenceEquals(actual, candidate))
            {
                tileOrder.Enqueue(new KeyValuePair<TileKey, Lazy<RestoredTile>>(key, candidate));
                TrimTileCache();
            }
        }

        try
        {
            return actual.Value;
        }
        catch
        {
            RemoveCachedTile(key, actual);
            throw;
        }
    }

    private void TrimTileCache()
    {
        ICollection<KeyValuePair<TileKey, Lazy<RestoredTile>>> cacheEntries = tileCache;
        while (tileCache.Count > MaxCachedTiles &&
               tileOrder.TryDequeue(out KeyValuePair<TileKey, Lazy<RestoredTile>> oldest))
        {
            cacheEntries.Remove(oldest);
        }
    }

    private void RemoveCachedTile(TileKey key, Lazy<RestoredTile> value)
    {
        ICollection<KeyValuePair<TileKey, Lazy<RestoredTile>>> cacheEntries = tileCache;
        cacheEntries.Remove(new KeyValuePair<TileKey, Lazy<RestoredTile>>(key, value));
    }

    private RestoredTile RestoreTile(TileKey key)
    {
        RectInt32 coreRect = new(key.X, key.Y, CoreTileSize, CoreTileSize);
        RectInt32 sourceRect = RectInt32.Inflate(coreRect, ContextRadius, ContextRadius);
        using IBitmap<ColorBgra32> sourceTile = sourceBitmap!
            .CreateClipper(sourceRect, BitmapExtendMode.Clamp)
            .ToBitmap();
        using IBitmapLock<ColorBgra32> sourceLock = sourceTile.Lock(BitmapLockOptions.Read);
        RegionPtr<ColorBgra32> sourceRegion = sourceLock.AsRegionPtr();

        int inputWidth = sourceRegion.Width;
        int inputHeight = sourceRegion.Height;
        float[] input = new float[checked(inputWidth * inputHeight * 3)];
        FillInput(sourceRegion, input, inputWidth, inputHeight);

        if (IsCancelRequested)
        {
            throw new OperationCanceledException();
        }

        float[] modelOutput = SharedSession.Value.Run(input, inputWidth, inputHeight, () => IsCancelRequested);
        if (IsCancelRequested)
        {
            throw new OperationCanceledException();
        }

        return DownsampleCore(modelOutput, inputWidth, inputHeight);
    }

    private void FillInput(RegionPtr<ColorBgra32> source, float[] input, int width, int height)
    {
        int planeSize = checked(width * height);
        for (int y = 0; y < height; y++)
        {
            if (IsCancelRequested)
            {
                return;
            }

            for (int x = 0; x < width; x++)
            {
                ColorBgra32 pixel = source[x, y];
                int offset = y * width + x;
                if (pixel.A == 0)
                {
                    continue;
                }

                input[offset] = pixel.R / 255f;
                input[planeSize + offset] = pixel.G / 255f;
                input[(2 * planeSize) + offset] = pixel.B / 255f;
            }
        }
    }

    private static RestoredTile DownsampleCore(float[] restored, int inputWidth, int inputHeight)
    {
        const int scale = RealEsrganSession.Scale;
        int restoredWidth = checked(inputWidth * scale);
        int restoredHeight = checked(inputHeight * scale);
        int planeSize = checked(restoredWidth * restoredHeight);
        float[] core = new float[checked(CoreTileSize * CoreTileSize * 3)];
        int corePlaneSize = CoreTileSize * CoreTileSize;

        for (int channel = 0; channel < 3; channel++)
        {
            for (int y = 0; y < CoreTileSize; y++)
            {
                for (int x = 0; x < CoreTileSize; x++)
                {
                    core[(channel * corePlaneSize) + (y * CoreTileSize) + x] = AverageBlock(
                        restored,
                        x + ContextRadius,
                        y + ContextRadius,
                        channel,
                        restoredWidth,
                        planeSize);
                }
            }
        }

        return new RestoredTile(core);
    }

    private static float AverageBlock(
        float[] values,
        int sourceX,
        int sourceY,
        int channel,
        int restoredWidth,
        int planeSize)
    {
        const int scale = RealEsrganSession.Scale;
        int startX = sourceX * scale;
        int startY = sourceY * scale;
        int channelOffset = channel * planeSize;
        float sum = 0;

        for (int dy = 0; dy < scale; dy++)
        {
            int row = channelOffset + ((startY + dy) * restoredWidth) + startX;
            for (int dx = 0; dx < scale; dx++)
            {
                sum += values[row + dx];
            }
        }

        return Math.Clamp(sum / (scale * scale), 0f, 1f);
    }

    private static byte Blend(byte original, float restored, float amount)
    {
        float originalFloat = original / 255f;
        float mixed = originalFloat + ((restored - originalFloat) * amount);
        return (byte)Math.Clamp((int)MathF.Round(mixed * 255f), 0, 255);
    }

    private static string FindModelPath()
    {
        string? assemblyPath = typeof(AiRestoreEffect).Assembly.Location;
        string directory = string.IsNullOrEmpty(assemblyPath)
            ? AppContext.BaseDirectory
            : Path.GetDirectoryName(assemblyPath) ?? AppContext.BaseDirectory;
        string modelPath = Path.Combine(directory, "model", ModelFileName);

        if (!File.Exists(modelPath))
        {
            throw new FileNotFoundException(
                "AI Restore model is missing. Install the complete Travny.PaintDotNet.AI plugin folder.",
                modelPath);
        }

        return modelPath;
    }

    private readonly record struct TileKey(int X, int Y)
    {
        public static TileKey FromPixel(int x, int y)
        {
            return new TileKey((x / CoreTileSize) * CoreTileSize, (y / CoreTileSize) * CoreTileSize);
        }
    }

    private sealed class RestoredTile
    {
        private readonly float[] values;

        public RestoredTile(float[] values)
        {
            this.values = values;
        }

        public float Get(int x, int y, int channel)
        {
            int planeSize = CoreTileSize * CoreTileSize;
            return values[(channel * planeSize) + (y * CoreTileSize) + x];
        }
    }
}
