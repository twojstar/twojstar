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
    private readonly ConcurrentQueue<TileKey> tileOrder = new();
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

        try
        {
            for (int y = 0; y < outputRegion.Height; y++)
            {
                if (IsCancelRequested)
                {
                    return;
                }

                int globalY = output.Bounds.Y + y;
                TileKey currentKey = default;
                RestoredTile? currentTile = null;

                for (int x = 0; x < outputRegion.Width; x++)
                {
                    int globalX = output.Bounds.X + x;
                    TileKey key = TileKey.FromPixel(globalX, globalY);
                    if (currentTile is null || key != currentKey)
                    {
                        currentKey = key;
                        currentTile = GetRestoredTile(key);
                    }

                    int tileX = globalX - key.X;
                    int tileY = globalY - key.Y;
                    ColorBgra32 original = sourceRegion[x, y];

                    outputRegion[x, y] = ColorBgra32.FromBgra(
                        Blend(original.B, currentTile.Get(tileX, tileY, 2), amount),
                        Blend(original.G, currentTile.Get(tileX, tileY, 1), amount),
                        Blend(original.R, currentTile.Get(tileX, tileY, 0), amount),
                        original.A);
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
        if (tileCache.TryGetValue(key, out Lazy<RestoredTile>? cached))
        {
            return cached.Value;
        }

        var candidate = new Lazy<RestoredTile>(
            () => RestoreTile(key),
            LazyThreadSafetyMode.ExecutionAndPublication);
        Lazy<RestoredTile> actual = tileCache.GetOrAdd(key, candidate);

        if (ReferenceEquals(actual, candidate))
        {
            tileOrder.Enqueue(key);
            TrimTileCache();
        }

        return actual.Value;
    }

    private void TrimTileCache()
    {
        while (tileCache.Count > MaxCachedTiles && tileOrder.TryDequeue(out TileKey oldest))
        {
            tileCache.TryRemove(oldest, out _);
        }
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
