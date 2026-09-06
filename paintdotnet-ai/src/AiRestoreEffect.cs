using PaintDotNet;
using PaintDotNet.Effects;
using PaintDotNet.Imaging;
using PaintDotNet.PropertySystem;
using PaintDotNet.Rendering;
using System;
using System.Collections.Generic;
using System.IO;
using System.Threading;

namespace Travny.PaintDotNet.AI;

[PluginSupportInfo(typeof(PluginSupportInfo))]
public sealed class AiRestoreEffect : PropertyBasedBitmapEffect
{
    private const int ContextRadius = 16;
    private const string ModelFileName = "realesr-general-x4v3.onnx";

    private static readonly Lazy<RealEsrganSession> SharedSession =
        new(() => new RealEsrganSession(FindModelPath()), LazyThreadSafetyMode.ExecutionAndPublication);

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

        RectInt32 sourceRect = RectInt32.Inflate(output.Bounds, ContextRadius, ContextRadius);
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
            return;
        }

        float[] restored = SharedSession.Value.Run(input, inputWidth, inputHeight);
        if (IsCancelRequested)
        {
            return;
        }

        WriteOutput(sourceRegion, outputRegion, restored, inputWidth, inputHeight);
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
                    input[offset] = 0;
                    input[planeSize + offset] = 0;
                    input[(2 * planeSize) + offset] = 0;
                    continue;
                }

                input[offset] = pixel.R / 255f;
                input[planeSize + offset] = pixel.G / 255f;
                input[(2 * planeSize) + offset] = pixel.B / 255f;
            }
        }
    }

    private void WriteOutput(
        RegionPtr<ColorBgra32> source,
        RegionPtr<ColorBgra32> output,
        float[] restored,
        int inputWidth,
        int inputHeight)
    {
        const int scale = RealEsrganSession.Scale;
        int restoredWidth = checked(inputWidth * scale);
        int restoredHeight = checked(inputHeight * scale);
        int planeSize = checked(restoredWidth * restoredHeight);
        float amount = strength / 100f;

        for (int y = 0; y < output.Height; y++)
        {
            if (IsCancelRequested)
            {
                return;
            }

            for (int x = 0; x < output.Width; x++)
            {
                int localX = x + ContextRadius;
                int localY = y + ContextRadius;
                ColorBgra32 original = source[localX, localY];

                float restoredR = AverageBlock(restored, localX, localY, 0, restoredWidth, planeSize);
                float restoredG = AverageBlock(restored, localX, localY, 1, restoredWidth, planeSize);
                float restoredB = AverageBlock(restored, localX, localY, 2, restoredWidth, planeSize);

                output[x, y] = ColorBgra32.FromBgra(
                    Blend(original.B, restoredB, amount),
                    Blend(original.G, restoredG, amount),
                    Blend(original.R, restoredR, amount),
                    original.A);
            }
        }
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
}
